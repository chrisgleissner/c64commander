/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { FtpClientPlugin, FtpListOptions, FtpEntry, FtpReadOptions } from './ftpClient';
import { getFtpBridgeUrl } from '@/lib/ftp/ftpConfig';

const FTP_BRIDGE_TIMEOUT_MS = 5000;
const FTP_BRIDGE_MAX_ATTEMPTS = 3;

const isRetryableFtpBridgeFailure = (error: unknown, status?: number) => {
  const resolvedStatus = typeof status === 'number'
    ? status
    : (error as { status?: number } | undefined)?.status;
  if (typeof resolvedStatus === 'number' && resolvedStatus >= 500) {
    return true;
  }
  const message = (error as Error | undefined)?.message?.toLowerCase() ?? '';
  return message.includes('timed out')
    || message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('connection reset')
    || message.includes('econnreset');
};

const runWithRetry = async <T,>(operation: () => Promise<T>) => {
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
  async listDirectory(options: FtpListOptions): Promise<{ entries: FtpEntry[] }> {
    const bridgeUrl = getFtpBridgeUrl();
    if (!bridgeUrl) {
      throw new Error('FTP browsing is unavailable: missing FTP bridge URL.');
    }

    return runWithRetry(async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), FTP_BRIDGE_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/v1/ftp/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            host: options.host,
            port: options.port,
            username: options.username,
            password: options.password,
            path: options.path,
            traceContext: options.traceContext,
          }),
        });
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          throw new Error('FTP bridge request timed out');
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

      const payload = (await response.json()) as { entries: FtpEntry[] };
      return { entries: payload.entries || [] };
    });
  }

  async readFile(options: FtpReadOptions): Promise<{ data: string; sizeBytes?: number }> {
    const bridgeUrl = getFtpBridgeUrl();
    if (!bridgeUrl) {
      throw new Error('FTP file download is unavailable: missing FTP bridge URL.');
    }

    return runWithRetry(async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), FTP_BRIDGE_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/v1/ftp/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(options),
        });
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          throw new Error('FTP bridge request timed out');
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

      const payload = (await response.json()) as { data?: string; sizeBytes?: number } | null;
      if (!payload || typeof payload.data !== 'string') {
        throw new Error('FTP bridge error: invalid file payload');
      }

      return {
        data: payload.data,
        sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : payload.data.length,
      };
    });
  }
}
