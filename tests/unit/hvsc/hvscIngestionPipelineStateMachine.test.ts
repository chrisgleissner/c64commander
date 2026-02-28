/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createArchivePipelineStateMachine,
    type HvscPipelineState,
} from '@/lib/hvsc/hvscIngestionPipeline';

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

describe('hvscIngestionPipeline state machine', () => {
    const params = {
        archiveName: 'HVSC_84.7z',
        archiveType: 'baseline' as const,
        archiveVersion: 84,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('starts in IDLE state', () => {
        const sm = createArchivePipelineStateMachine(params);
        expect(sm.current()).toBe('IDLE');
    });

    it('allows valid sequential transitions through the full pipeline', () => {
        const sm = createArchivePipelineStateMachine(params);
        const sequence: HvscPipelineState[] = [
            'DOWNLOADING', 'DOWNLOADED', 'EXTRACTING', 'EXTRACTED', 'INGESTING', 'READY',
        ];
        for (const state of sequence) {
            sm.transition(state);
            expect(sm.current()).toBe(state);
        }
    });

    it('throws on illegal transition from IDLE to EXTRACTING', () => {
        const sm = createArchivePipelineStateMachine(params);
        expect(() => sm.transition('EXTRACTING')).toThrow('Illegal HVSC pipeline transition IDLE -> EXTRACTING');
    });

    it('throws on backward transition', () => {
        const sm = createArchivePipelineStateMachine(params);
        sm.transition('DOWNLOADING');
        expect(() => sm.transition('IDLE' as HvscPipelineState)).toThrow('Illegal HVSC pipeline transition');
    });

    it('throws on repeated transition to same state', () => {
        const sm = createArchivePipelineStateMachine(params);
        sm.transition('DOWNLOADING');
        expect(() => sm.transition('DOWNLOADING')).toThrow('Illegal HVSC pipeline transition');
    });

    it('throws from terminal READY state', () => {
        const sm = createArchivePipelineStateMachine(params);
        sm.transition('DOWNLOADING');
        sm.transition('DOWNLOADED');
        sm.transition('EXTRACTING');
        sm.transition('EXTRACTED');
        sm.transition('INGESTING');
        sm.transition('READY');
        expect(() => sm.transition('IDLE' as HvscPipelineState)).toThrow('Illegal HVSC pipeline transition');
    });

    it('accepts optional details on transition', () => {
        const sm = createArchivePipelineStateMachine(params);
        sm.transition('DOWNLOADING', { speed: '2MB/s' });
        expect(sm.current()).toBe('DOWNLOADING');
    });
});
