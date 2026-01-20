import type { FtpClientPlugin, FtpListOptions, FtpEntry } from './ftpClient';
import { getFtpBridgeUrl } from '@/lib/ftp/ftpConfig';

export class FtpClientWeb implements FtpClientPlugin {
  async listDirectory(options: FtpListOptions): Promise<{ entries: FtpEntry[] }> {
    const bridgeUrl = getFtpBridgeUrl();
    if (!bridgeUrl) {
      throw new Error('FTP browsing is unavailable: missing FTP bridge URL.');
    }

    const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/v1/ftp/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        path: options.path,
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message = errorPayload?.error || `FTP bridge error: HTTP ${response.status}`;
      throw new Error(message);
    }

    const payload = (await response.json()) as { entries: FtpEntry[] };
    return { entries: payload.entries || [] };
  }
}
