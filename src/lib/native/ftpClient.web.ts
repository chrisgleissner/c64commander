import type { FtpClientPlugin, FtpListOptions, FtpEntry } from './ftpClient';

declare global {
  interface Window {
    __ftpMock__?: {
      listDirectory: (options: FtpListOptions) => Promise<FtpEntry[]> | FtpEntry[];
    };
  }
}

export class FtpClientWeb implements FtpClientPlugin {
  async listDirectory(options: FtpListOptions): Promise<{ entries: FtpEntry[] }> {
    if (window.__ftpMock__) {
      const result = await window.__ftpMock__.listDirectory(options);
      return { entries: result };
    }
    throw new Error('FTP browsing is only available on native devices.');
  }
}
