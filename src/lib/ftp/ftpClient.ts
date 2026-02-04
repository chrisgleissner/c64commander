import { addErrorLog } from '@/lib/logging';
import { FtpClient, type FtpEntry, type FtpListOptions, type FtpReadOptions } from '@/lib/native/ftpClient';
import { getActiveAction, runWithImplicitAction } from '@/lib/tracing/actionTrace';
import { recordFtpOperation, recordTraceError } from '@/lib/tracing/traceSession';
import { withFtpInteraction, type InteractionIntent } from '@/lib/deviceInteraction/deviceInteractionManager';
import type { TraceActionContext } from '@/lib/tracing/types';

export type FtpListResult = {
  path: string;
  entries: FtpEntry[];
};

const executeFtpList = async (
  action: TraceActionContext,
  ftpOptions: FtpListOptions,
  normalizedPath: string,
  intent: InteractionIntent,
): Promise<FtpListResult> => {
  return withFtpInteraction({
    action,
    operation: 'list',
    path: normalizedPath,
    intent,
  }, async () => {
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
        host: ftpOptions.host,
        path: normalizedPath,
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

export const listFtpDirectory = async (
  options: FtpListOptions & { __c64uIntent?: InteractionIntent },
): Promise<FtpListResult> => {
  const { __c64uIntent, ...ftpOptions } = options;
  const normalizedPath = options.path && options.path !== '' ? options.path : '/';
  const intent = __c64uIntent ?? 'user';

  // If there's an active user action, record FTP within that context
  const activeAction = getActiveAction();
  if (activeAction) {
    return executeFtpList(activeAction, ftpOptions, normalizedPath, intent);
  }
  // Otherwise create an implicit system action for the FTP call
  return runWithImplicitAction('ftp.list', async (action) => {
    return executeFtpList(action, ftpOptions, normalizedPath, intent);
  });
};

const executeFtpRead = async (
  action: TraceActionContext,
  ftpOptions: FtpReadOptions,
  path: string,
  intent: InteractionIntent,
): Promise<{ data: string; sizeBytes?: number }> => {
  return withFtpInteraction({
    action,
    operation: 'read',
    path,
    intent,
  }, async () => {
    try {
      const response = await FtpClient.readFile({ ...ftpOptions, path });
      recordFtpOperation(action, {
        operation: 'read',
        path,
        result: 'success',
        error: null,
      });
      return response;
    } catch (error) {
      const err = error as Error;
      addErrorLog('FTP file read failed', {
        host: ftpOptions.host,
        path,
        error: err.message,
      });
      recordFtpOperation(action, {
        operation: 'read',
        path,
        result: 'failure',
        error: err,
      });
      recordTraceError(action, err);
      throw error;
    }
  });
};

export const readFtpFile = async (
  options: FtpReadOptions & { __c64uIntent?: InteractionIntent },
): Promise<{ data: string; sizeBytes?: number }> => {
  const { __c64uIntent, ...ftpOptions } = options;
  const intent = __c64uIntent ?? 'user';

  // If there's an active user action, record FTP within that context
  const activeAction = getActiveAction();
  if (activeAction) {
    return executeFtpRead(activeAction, ftpOptions, options.path, intent);
  }
  // Otherwise create an implicit system action for the FTP call
  return runWithImplicitAction('ftp.read', async (action) => {
    return executeFtpRead(action, ftpOptions, options.path, intent);
  });
};
