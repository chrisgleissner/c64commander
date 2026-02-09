/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HvscProgressEvent } from './hvscTypes';
import { updateHvscStatusSummaryFromEvent } from './hvscStatusStore';

const listeners = new Set<(event: HvscProgressEvent) => void>();
let summaryLastStage: string | null = null;

const emit = (event: HvscProgressEvent) => {
    const lastStage = summaryLastStage;
    if (event.stage && event.stage !== 'error') {
        summaryLastStage = event.stage;
    }
    updateHvscStatusSummaryFromEvent(event, lastStage);
    listeners.forEach((listener) => listener(event));
};

export const resetHvscProgressSummaryStage = () => {
    summaryLastStage = null;
};

export const createProgressEmitter = (ingestionId: string) => {
    const startedAt = Date.now();
    return (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => {
        emit({
            ...event,
            ingestionId,
            elapsedTimeMs: Date.now() - startedAt,
        });
    };
};

export const addHvscProgressListener = async (listener: (event: HvscProgressEvent) => void) => {
    listeners.add(listener);
    return {
        remove: async () => {
            listeners.delete(listener);
        },
    };
};
