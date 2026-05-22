/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as path from "node:path";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import type { Server } from "node:net";

type FtpConnection = {
  on: (event: "command:user" | "command:pass", handler: (...args: any[]) => void) => void;
};

type FtpServerInstance = {
  on: (event: "client:connected" | "error", handler: (...args: any[]) => void) => void;
  listen: (port: number) => void;
  close: (callback?: (error?: Error | null) => void) => void;
  server: Server;
};

type FtpdModule = {
  FtpServer: new (host: string, options: Record<string, unknown>) => FtpServerInstance;
};

const require = createRequire(import.meta.url);
const { FtpServer } = require("ftpd") as FtpdModule;

export type MockFtpServer = {
  host: string;
  port: number;
  rootDir: string;
  close: () => Promise<void>;
};

type MockFtpServerOptions = {
  rootDir: string;
  password?: string;
  port?: number;
  host?: string;
  pasvMin?: number;
  pasvMax?: number;
};

export async function createMockFtpServer(options: MockFtpServerOptions): Promise<MockFtpServer> {
  const host = options.host ?? "127.0.0.1";
  const rootDir = path.resolve(options.rootDir);
  const port = options.port ?? 0;
  const password = options.password ?? "";
  const pasvMin = options.pasvMin ?? 40100;
  const pasvMax = options.pasvMax ?? 40200;
  const server = new FtpServer(host, {
    getInitialCwd: () => "/",
    getRoot: () => rootDir,
    pasvPortRangeStart: pasvMin,
    pasvPortRangeEnd: pasvMax,
    useReadFile: false,
    useWriteFile: false,
  });

  server.on("client:connected", (connection: FtpConnection) => {
    let username = "anonymous";

    connection.on("command:user", (suppliedUser: string, success: () => void, failure: () => void) => {
      if (!suppliedUser) {
        failure();
        return;
      }
      username = suppliedUser;
      success();
    });

    connection.on(
      "command:pass",
      (suppliedPassword: string | undefined, success: (value: string) => void, failure: (error: Error) => void) => {
        const ok = !password || suppliedPassword === password;
        if (!ok) {
          failure(new Error("FTP login failed"));
          return;
        }
        success(username);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.server.once("error", reject);
    server.server.once("listening", () => resolve());
    server.listen(port);
  });

  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start FTP server");
  }

  return {
    host,
    port: address.port,
    rootDir,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
