import { addErrorLog } from '@/lib/logging';
import { FtpClient, type FtpEntry, type FtpListOptions } from '@/lib/native/ftpClient';
import { runWithImplicitAction } from '@/lib/tracing/actionTrace';
import { recordFtpOperation, recordTraceError } from '@/lib/tracing/traceSession';

export type FtpListResult = {
  path: string;
  entries: FtpEntry[];
};

export const listFtpDirectory = async (options: FtpListOptions): Promise<FtpListResult> => {
  return runWithImplicitAction('ftp.list', async (action) => {
    const normalizedPath = options.path && options.path !== '' ? options.path : '/';
    try {
      const response = await FtpClient.listDirectory({ ...options, path: normalizedPath });
      recordFtpOperation(action, {
        operation: 'list',
        path: normalizedPath,
        result: 'success',
        error: null,
      });
      return { path: normalizedPath, entries: response.entries };
    } catch (error) {
      const err = error as Error;
      addErrorLog('FTP listing failed', {
        host: options.host,
        path: options.path,
        error: err.message,
      });
      recordFtpOperation(action, {
        operation: 'list',
        path: normalizedPath,
        result: 'failure',
        error: err,
      });
      recordTraceError(action, err);
      throw error;
    }
  });
};
