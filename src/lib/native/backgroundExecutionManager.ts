/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from '@/lib/logging';
import { BackgroundExecution } from '@/lib/native/backgroundExecution';

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
    addLog('warn', 'Background execution start failed', {
      ...logContext,
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
    addLog('warn', 'Background execution stop failed', {
      ...logContext,
      error: (error as Error).message,
    });
  }
};

export const resetBackgroundExecutionState = () => {
  activeCount = 0;
};
