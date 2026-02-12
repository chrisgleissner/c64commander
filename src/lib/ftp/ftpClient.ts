/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, buildErrorLogDetails } from '@/lib/logging';
import { decrementFtpInFlight, incrementFtpInFlight } from '@/lib/diagnostics/diagnosticsActivity';
import { FtpClient, type FtpEntry, type FtpListOptions, type FtpReadOptions } from '@/lib/native/ftpClient';
import { resolveNativeTraceContext } from '@/lib/native/nativeTraceContext';
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
  incrementFtpInFlight();
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
      addErrorLog('FTP listing failed', buildErrorLogDetails(err, {
        host: ftpOptions.host,
        path: normalizedPath,
      }));
      recordFtpOperation(action, {
        operation: 'list',
        path: normalizedPath,
        result: 'failure',
        error: err,
      });
      recordTraceError(action, err);
      throw error;
    } finally {
      decrementFtpInFlight();
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
    const optionsWithTrace = { ...ftpOptions, traceContext: resolveNativeTraceContext(activeAction) };
    return executeFtpList(activeAction, optionsWithTrace, normalizedPath, intent);
  }
  // Otherwise create an implicit system action for the FTP call
  return runWithImplicitAction('ftp.list', async (action) => {
    const optionsWithTrace = { ...ftpOptions, traceContext: resolveNativeTraceContext(action) };
    return executeFtpList(action, optionsWithTrace, normalizedPath, intent);
  });
};

const executeFtpRead = async (
  action: TraceActionContext,
  ftpOptions: FtpReadOptions,
  path: string,
  intent: InteractionIntent,
): Promise<{ data: string; sizeBytes?: number }> => {
  incrementFtpInFlight();
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
      addErrorLog('FTP file read failed', buildErrorLogDetails(err, {
        host: ftpOptions.host,
        path,
      }));
      recordFtpOperation(action, {
        operation: 'read',
        path,
        result: 'failure',
        error: err,
      });
      recordTraceError(action, err);
      throw error;
    } finally {
      decrementFtpInFlight();
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
    const optionsWithTrace = { ...ftpOptions, traceContext: resolveNativeTraceContext(activeAction) };
    return executeFtpRead(activeAction, optionsWithTrace, options.path, intent);
  }
  // Otherwise create an implicit system action for the FTP call
  return runWithImplicitAction('ftp.read', async (action) => {
    const optionsWithTrace = { ...ftpOptions, traceContext: resolveNativeTraceContext(action) };
    return executeFtpRead(action, optionsWithTrace, options.path, intent);
  });
};
