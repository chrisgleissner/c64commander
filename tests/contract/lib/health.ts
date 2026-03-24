/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ProbeResult = {
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs?: number;
};

export type ProbeFn = () => Promise<ProbeResult>;

export type HealthConfig = {
  maxConsecutiveFailures: number;
  maxUnreachableMs: number;
};

export class HealthMonitor {
  private consecutiveFailures = 0;
  private lastSuccessAt = Date.now();

  constructor(
    private readonly probe: ProbeFn,
    private readonly config: HealthConfig,
  ) {}

  async check(): Promise<ProbeResult> {
    const result = await this.probe();
    if (result.ok) {
      this.consecutiveFailures = 0;
      this.lastSuccessAt = Date.now();
    } else {
      this.consecutiveFailures += 1;
    }
    return result;
  }

  shouldAbort(): { abort: boolean; reason?: string } {
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      return {
        abort: true,
        reason: `Health probe failed ${this.consecutiveFailures} times`,
      };
    }
    const unreachableMs = Date.now() - this.lastSuccessAt;
    if (unreachableMs >= this.config.maxUnreachableMs) {
      return {
        abort: true,
        reason: `Health probe unreachable for ${unreachableMs}ms`,
      };
    }
    return { abort: false };
  }
}

import { FtpClient } from "./ftpClient.js";
import type { HarnessConfig } from "./config.js";

export function createFtpHealthProbe(config: HarnessConfig): () => Promise<ProbeResult> {
  return async () => {
    const client = new FtpClient({
      host: new URL(config.baseUrl).hostname,
      port: config.ftpPort ?? 21,
      user: "anonymous",
      password: config.auth === "ON" ? config.password || "" : "",
      mode: config.ftpMode,
      timeoutMs: config.timeouts.ftpTimeoutMs,
    });
    const start = Date.now();
    try {
      await client.connect();
      await client.sendCommand("NOOP");
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, error: String(error), latencyMs: Date.now() - start };
    } finally {
      await client.close().catch((error) => {
        console.warn("FTP health probe close failed", { error: String(error) });
      });
    }
  };
}
