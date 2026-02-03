import { addErrorLog } from '@/lib/logging';
import { FtpClient, type FtpEntry, type FtpListOptions, type FtpReadOptions } from '@/lib/native/ftpClient';
import { runWithImplicitAction } from '@/lib/tracing/actionTrace';
import { recordFtpOperation, recordTraceError } from '@/lib/tracing/traceSession';
import { withFtpInteraction, type InteractionIntent } from '@/lib/deviceInteraction/deviceInteractionManager';

export type FtpListResult = {
  path: string;
  entries: FtpEntry[];
};

export const listFtpDirectory = async (
  options: FtpListOptions & { __c64uIntent?: InteractionIntent },
): Promise<FtpListResult> => {
  const { __c64uIntent, ...ftpOptions } = options;
  return runWithImplicitAction('ftp.list', async (action) => withFtpInteraction({
    action,
    operation: 'list',
    path: options.path && options.path !== '' ? options.path : '/',
    intent: __c64uIntent ?? 'user',
  }, async () => {
    const normalizedPath = options.path && options.path !== '' ? options.path : '/';
    try {
      const response = await FtpClient.listDirectory({ ...ftpOptions, path: normalizedPath });
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
  }));
};

  export const readFtpFile = async (
    options: FtpReadOptions & { __c64uIntent?: InteractionIntent },
  ): Promise<{ data: string; sizeBytes?: number }> => {
    const { __c64uIntent, ...ftpOptions } = options;
    return runWithImplicitAction('ftp.read', async (action) => withFtpInteraction({
      action,
      operation: 'read',
      path: options.path,
      intent: __c64uIntent ?? 'user',
    }, async () => {
      try {
        const response = await FtpClient.readFile({ ...ftpOptions, path: options.path });
        recordFtpOperation(action, {
          operation: 'read',
          path: options.path,
          result: 'success',
          error: null,
        });
        return response;
      } catch (error) {
        const err = error as Error;
        addErrorLog('FTP file read failed', {
          host: options.host,
          path: options.path,
          error: err.message,
        });
        recordFtpOperation(action, {
          operation: 'read',
          path: options.path,
          result: 'failure',
          error: err,
        });
        recordTraceError(action, err);
        throw error;
      }
    }));
  };
