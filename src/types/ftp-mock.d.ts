import type { FtpListOptions, FtpEntry } from '@/lib/native/ftpClient';

declare global {
  interface Window {
    __ftpMock__?: {
      listDirectory: (options: FtpListOptions) => Promise<FtpEntry[]> | FtpEntry[];
    };
  }
}

export {};
