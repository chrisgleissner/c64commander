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

export const startBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  activeCount += 1;
  if (activeCount > 1) return;
  try {
    await BackgroundExecution.start();
  } catch (error) {
    activeCount = Math.max(0, activeCount - 1);
    const failure = classifyError(error);
    addLog('warn', 'Background execution start failed', {
      ...logContext,
      lifecycleState: getLifecycleState(),
      failureClass: failure.failureClass,
      failureCategory: failure.category,
      error: (error as Error).message,
    });
  }
};

export const stopBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  if (activeCount <= 0) return;
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;
  try {
    await BackgroundExecution.stop();
  } catch (error) {
    const failure = classifyError(error);
    addLog('warn', 'Background execution stop failed', {
      ...logContext,
      lifecycleState: getLifecycleState(),
      failureClass: failure.failureClass,
      failureCategory: failure.category,
      error: (error as Error).message,
    });
  }
};

export const resetBackgroundExecutionState = () => {
  activeCount = 0;
};
