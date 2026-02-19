/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from '@/lib/logging';
import { BackgroundExecution } from '@/lib/native/backgroundExecution';
import { getLifecycleState } from '@/lib/appLifecycle';
import { classifyError } from '@/lib/tracing/failureTaxonomy';

type BackgroundExecutionLogContext = {
  source: string;
  reason?: string;
  context?: Record<string, unknown>;
};

let activeCount = 0;

const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

const buildFailureDetails = (
  error: unknown,
  logContext: BackgroundExecutionLogContext,
) => {
  const failure = classifyError(error);
  const normalizedError = toError(error);
  return {
    ...logContext,
    lifecycleState: getLifecycleState(),
    failureClass: failure.failureClass,
    failureCategory: failure.category,
    error: normalizedError.message,
  };
};

const buildOperationError = (operation: 'start' | 'stop', error: unknown) => {
  const normalizedError = toError(error);
  return new Error(`Background execution ${operation} failed: ${normalizedError.message}`);
};

export const startBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  activeCount += 1;
  if (activeCount > 1) return;
  try {
    await BackgroundExecution.start();
  } catch (error) {
    activeCount = Math.max(0, activeCount - 1);
    addLog('error', 'Background execution start failed', buildFailureDetails(error, logContext));
    throw buildOperationError('start', error);
  }
};

export const stopBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  if (activeCount <= 0) return;
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;
  try {
    await BackgroundExecution.stop();
  } catch (error) {
    addLog('error', 'Background execution stop failed', buildFailureDetails(error, logContext));
    throw buildOperationError('stop', error);
  }
};

export const resetBackgroundExecutionState = () => {
  activeCount = 0;
};
