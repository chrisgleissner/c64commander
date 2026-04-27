/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { FtpClientPlugin, FtpListOptions, FtpEntry, FtpReadOptions, FtpWriteOptions } from "./ftpClient";
import { getFtpBridgeUrl } from "@/lib/ftp/ftpConfig";

const FTP_BRIDGE_TIMEOUT_MS = 5000;
const FTP_BRIDGE_MAX_ATTEMPTS = 3;

const isRetryableFtpBridgeFailure = (error: unknown, status?: number) => {
  const resolvedStatus = typeof status === "number" ? status : (error as { status?: number } | undefined)?.status;
  if (typeof resolvedStatus === "number" && resolvedStatus >= 500) {
    return true;
  }
  const message = (error as Error | undefined)?.message?.toLowerCase() ?? "";
  return (
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("connection reset") ||
    message.includes("econnreset")
  );
};

const runWithRetry = async <T>(operation: () => Promise<T>) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FTP_BRIDGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= FTP_BRIDGE_MAX_ATTEMPTS || !isRetryableFtpBridgeFailure(error)) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, attempt * 150);
      });
    }
  }
  throw lastError as Error;
};

export class FtpClientWeb implements FtpClientPlugin {
  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const bridgeUrl = getFtpBridgeUrl();
    if (!bridgeUrl) {
      throw new Error("FTP bridge is unavailable: missing FTP bridge URL.");
    }

    return runWithRetry(async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), FTP_BRIDGE_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/v1/ftp/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          throw new Error("FTP bridge request timed out");
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        const message = errorPayload?.error || `FTP bridge error: HTTP ${response.status}`;
        const error = new Error(message) as Error & { status?: number };
        error.status = response.status;
        if (isRetryableFtpBridgeFailure(error, response.status)) {
          throw error;
        }
        throw error;
      }

      return (await response.json()) as T;
    });
  }

  async listDirectory(options: FtpListOptions): Promise<{ entries: FtpEntry[] }> {
    const payload = await this.postJson<{ entries: FtpEntry[] }>("list", {
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      path: options.path,
      traceContext: options.traceContext,
    });
    if (!payload || !Array.isArray(payload.entries)) {
      throw new Error("FTP bridge error: invalid list payload");
    }

    return { entries: payload.entries };
  }

  async readFile(options: FtpReadOptions): Promise<{ data: string; sizeBytes?: number }> {
    const payload = await this.postJson<{
      data?: string;
      sizeBytes?: number;
    } | null>("read", options);
    if (!payload || typeof payload.data !== "string") {
      throw new Error("FTP bridge error: invalid file payload");
    }

    return {
      data: payload.data,
      sizeBytes: typeof payload.sizeBytes === "number" ? payload.sizeBytes : payload.data.length,
    };
  }

  async writeFile(options: FtpWriteOptions): Promise<{ sizeBytes: number }> {
    const payload = await this.postJson<{ sizeBytes?: number } | null>("write", options);
    if (!payload || typeof payload.sizeBytes !== "number") {
      throw new Error("FTP bridge error: invalid write payload");
    }

    return { sizeBytes: payload.sizeBytes };
  }
}
