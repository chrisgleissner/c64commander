/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from '@/lib/logging';

// ── Pipeline state machine ───────────────────────────────────────

export type HvscPipelineState =
    | 'IDLE'
    | 'DOWNLOADING'
    | 'DOWNLOADED'
    | 'EXTRACTING'
    | 'EXTRACTED'
    | 'INGESTING'
    | 'READY';

export type PipelineStateMachine = {
    transition: (next: HvscPipelineState, details?: Record<string, unknown>) => void;
    current: () => HvscPipelineState;
};

const hvscPipelineTransitions: Record<HvscPipelineState, HvscPipelineState[]> = {
    IDLE: ['DOWNLOADING'],
    DOWNLOADING: ['DOWNLOADED'],
    DOWNLOADED: ['EXTRACTING'],
    EXTRACTING: ['EXTRACTED'],
    EXTRACTED: ['INGESTING'],
    INGESTING: ['READY'],
    READY: [],
};

export const createArchivePipelineStateMachine = (params: {
    archiveName: string;
    archiveType: 'baseline' | 'update';
    archiveVersion: number;
}): PipelineStateMachine => {
    let state: HvscPipelineState = 'IDLE';
    const transition = (next: HvscPipelineState, details: Record<string, unknown> = {}) => {
        const allowed = hvscPipelineTransitions[state];
        if (!allowed.includes(next)) {
            const error = new Error(`Illegal HVSC pipeline transition ${state} -> ${next}`);
            addErrorLog('HVSC pipeline transition violation', {
                archiveName: params.archiveName,
                archiveType: params.archiveType,
                archiveVersion: params.archiveVersion,
                fromState: state,
                toState: next,
                details,
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            });
            throw error;
        }
        addLog('info', 'HVSC pipeline transition', {
            archiveName: params.archiveName,
            archiveType: params.archiveType,
            archiveVersion: params.archiveVersion,
            fromState: state,
            toState: next,
            details,
        });
        state = next;
    };
    return {
        transition,
        current: () => state,
    };
};
