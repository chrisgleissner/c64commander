import type { FtpClientPlugin, FtpListOptions, FtpEntry } from './ftpClient';
import { getFtpBridgeUrl } from '@/lib/ftp/ftpConfig';

export class FtpClientWeb implements FtpClientPlugin {
  async listDirectory(options: FtpListOptions): Promise<{ entries: FtpEntry[] }> {
    const bridgeUrl = getFtpBridgeUrl();
    if (!bridgeUrl) {
      throw new Error('FTP browsing is unavailable: missing FTP bridge URL.');
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 3000);

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
      throw new Error(message);
    }

    const payload = (await response.json()) as { entries: FtpEntry[] };
    return { entries: payload.entries || [] };
  }
}
