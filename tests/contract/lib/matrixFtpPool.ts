/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FtpClient } from "./ftpClient.js";
import type { FtpSessionMode, HarnessConfig } from "./config.js";
import type { TraceCollector } from "./traceCollector.js";

export type FtpSessionPool = {
  acquire(clientId: string): Promise<FtpClient>;
  release(client: FtpClient): Promise<void>;
  teardown(): Promise<void>;
};

export async function createFtpSessionPool(input: {
  config: HarnessConfig;
  mode: FtpSessionMode;
  concurrency: number;
  traceCollector?: TraceCollector;
}): Promise<FtpSessionPool> {
  if (input.mode === "per-request") {
    return {
      async acquire(clientId: string): Promise<FtpClient> {
        const client = createClient(input.config, clientId, input.traceCollector);
        await client.connect();
        return client;
      },
      async release(client: FtpClient): Promise<void> {
        await client.close().catch((error) => {
          console.warn("Matrix FTP per-request close failed", { error: String(error) });
        });
      },
      async teardown(): Promise<void> {
        return Promise.resolve();
      },
    };
  }

  const clients = await Promise.all(
    Array.from({ length: input.concurrency }, (_value, index) => {
      const clientId = `client-${index + 1}`;
      const client = createClient(input.config, clientId, input.traceCollector);
      return client.connect().then(() => client);
    }),
  );
  const byClientId = new Map(clients.map((client, index) => [`client-${index + 1}`, client]));

  return {
    async acquire(clientId: string): Promise<FtpClient> {
      const client = byClientId.get(clientId) ?? clients[0];
      if (!client) {
        throw new Error(`No FTP client available for ${clientId}`);
      }
      client.setTraceClientId(clientId);
      return client;
    },
    async release(_client: FtpClient): Promise<void> {
      return Promise.resolve();
    },
    async teardown(): Promise<void> {
      await Promise.all(
        clients.map((client) =>
          client.close().catch((error) => {
            console.warn("Matrix FTP shared close failed", { error: String(error) });
          }),
        ),
      );
    },
  };
}

function createClient(config: HarnessConfig, clientId: string, traceCollector?: TraceCollector): FtpClient {
  return new FtpClient({
    host: new URL(config.baseUrl).hostname,
    port: config.ftpPort ?? 21,
    user: "anonymous",
    password: config.auth === "ON" ? config.password || "" : "",
    mode: config.ftpMode,
    timeoutMs: config.timeouts.ftpTimeoutMs,
    traceCollector,
    clientId,
  });
}
