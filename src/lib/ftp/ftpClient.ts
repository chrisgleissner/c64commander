import { addErrorLog } from '@/lib/logging';
import { FtpClient, type FtpEntry, type FtpListOptions } from '@/lib/native/ftpClient';

export type FtpListResult = {
  path: string;
  entries: FtpEntry[];
};

export const listFtpDirectory = async (options: FtpListOptions): Promise<FtpListResult> => {
  try {
    const normalizedPath = options.path && options.path !== '' ? options.path : '/';
    const response = await FtpClient.listDirectory({ ...options, path: normalizedPath });
    return { path: normalizedPath, entries: response.entries };
  } catch (error) {
    addErrorLog('FTP listing failed', {
      host: options.host,
      path: options.path,
      error: (error as Error).message,
    });
    throw error;
  }
};
