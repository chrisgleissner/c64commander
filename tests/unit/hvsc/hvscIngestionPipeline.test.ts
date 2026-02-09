/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHvscUpdateArchiveBuffer, loadHvscUpdateMockArchiveBuffer } from '../../fixtures/hvsc/ensureHvscUpdateArchive';
import { ingestArchiveBuffer, type IngestArchiveBufferOptions } from '@/lib/hvsc/hvscIngestionRuntime';
import type { PipelineStateMachine } from '@/lib/hvsc/hvscIngestionPipeline';

vi.mock('@/lib/hvsc/hvscFilesystem', () => ({
    writeLibraryFile: vi.fn(async () => undefined),
    deleteLibraryFile: vi.fn(async () => undefined),
    resetLibraryRoot: vi.fn(async () => undefined),
    resetSonglengthsCache: vi.fn(),
}));

vi.mock('@/lib/hvsc/hvscStateStore', () => ({
    markUpdateApplied: vi.fn(),
    updateHvscState: vi.fn(),
}));

vi.mock('@/lib/hvsc/hvscSongLengthService', () => ({
    reloadHvscSonglengthsOnConfigChange: vi.fn(async () => undefined),
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

import { writeLibraryFile, deleteLibraryFile, resetLibraryRoot, resetSonglengthsCache } from '@/lib/hvsc/hvscFilesystem';
import { markUpdateApplied, updateHvscState } from '@/lib/hvsc/hvscStateStore';
import { reloadHvscSonglengthsOnConfigChange } from '@/lib/hvsc/hvscSongLengthService';

const makePipeline = (): PipelineStateMachine & { transitions: string[] } => {
    const transitions: string[] = [];
    return {
        transitions,
        transition: (next: string) => {
            transitions.push(next);
        },
        current: () => transitions[transitions.length - 1] ?? 'DOWNLOADED',
    } as PipelineStateMachine & { transitions: string[] };
};

const makeOptions = (overrides: Partial<IngestArchiveBufferOptions> = {}): IngestArchiveBufferOptions => ({
    plan: { type: 'update', version: 84 },
    archiveName: 'HVSC_Update_84.7z',
    archiveBuffer: new Uint8Array(),
    cancelToken: 'token-1',
    cancelTokens: new Map([['token-1', { cancelled: false }]]),
    emitProgress: vi.fn(),
    pipeline: makePipeline(),
    baselineInstalled: 83,
    ...overrides,
});

describe('hvscIngestionPipeline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it(
        'ingests a real update archive end-to-end',
        async () => {
            const buffer = await loadHvscUpdateArchiveBuffer();
            const options = makeOptions({ archiveBuffer: buffer });
            const result = await ingestArchiveBuffer(options);

            expect(result.baselineInstalled).toBe(83);
            expect(resetSonglengthsCache).toHaveBeenCalled();
            expect(reloadHvscSonglengthsOnConfigChange).toHaveBeenCalled();
            expect(updateHvscState).toHaveBeenCalledWith(expect.objectContaining({
                installedVersion: 84,
                ingestionState: 'ready',
            }));
            expect(markUpdateApplied).toHaveBeenCalledWith(84, 'success');
            expect((options.pipeline as ReturnType<typeof makePipeline>).transitions).toEqual([
                'EXTRACTING',
                'EXTRACTED',
                'INGESTING',
                'READY',
            ]);
            expect(writeLibraryFile).toHaveBeenCalled();
        },
        120000,
    );

    it(
        'classifies songlengths and deletion lists from mock archive',
        async () => {
            const buffer = await loadHvscUpdateMockArchiveBuffer();
            const options = makeOptions({ archiveName: 'HVSC_Update_mock.7z', archiveBuffer: buffer });
            await ingestArchiveBuffer(options);

            expect(writeLibraryFile).toHaveBeenCalledWith(
                '/DOCUMENTS/Songlengths.txt',
                expect.any(Uint8Array),
            );
            expect(deleteLibraryFile).toHaveBeenCalledWith('/MUSICIANS/B/Bjerregaard_Johannes/Old_Tune.sid');
            expect(deleteLibraryFile).toHaveBeenCalledWith('/MUSICIANS/B/Bjerregaard_Johannes/Gone.sid');
        },
        60000,
    );

    it(
        'normalizes update paths for library writes',
        async () => {
            const buffer = await loadHvscUpdateMockArchiveBuffer();
            const options = makeOptions({ archiveName: 'HVSC_Update_mock.7z', archiveBuffer: buffer });
            await ingestArchiveBuffer(options);

            const calls = vi.mocked(writeLibraryFile).mock.calls.map((call) => call[0]);
            expect(calls).toContain('/fix/MUSICIANS/A/Adrock_and_Deadeye/James_Bond.sid');
            expect(calls).toContain('/fix/MUSICIANS/B/Bjerregaard_Johannes/Cute_Tune.sid');
        },
        60000,
    );

    it(
        'resets library root for baseline plans',
        async () => {
            const buffer = await loadHvscUpdateMockArchiveBuffer();
            const options = makeOptions({
                plan: { type: 'baseline', version: 84 },
                baselineInstalled: null,
                archiveName: 'HVSC_Update_mock.7z',
                archiveBuffer: buffer,
            });
            await ingestArchiveBuffer(options);

            expect(resetLibraryRoot).toHaveBeenCalled();
            expect(updateHvscState).toHaveBeenCalledWith(expect.objectContaining({
                installedBaselineVersion: 84,
                installedVersion: 84,
            }));
        },
        60000,
    );

    it(
        'cancels mid-extraction when token flips',
        async () => {
            const buffer = await loadHvscUpdateArchiveBuffer();
            const cancelTokens = new Map([['token-1', { cancelled: false }]]);
            let progressEvents = 0;
            const emitProgress = vi.fn(() => {
                progressEvents += 1;
                if (progressEvents > 3) {
                    cancelTokens.get('token-1')!.cancelled = true;
                }
            });
            const options = makeOptions({ archiveBuffer: buffer, cancelTokens, emitProgress });

            await expect(ingestArchiveBuffer(options)).rejects.toThrow('HVSC update cancelled');
        },
        120000,
    );

    it(
        'fails with corrupt archive buffers',
        async () => {
            const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
            const options = makeOptions({ archiveBuffer: buffer });
            // Error depends on 7z implementation, might contain 'Call to main failed' or '7zip exited with'.
            // The module wrapper usually throws.
            await expect(ingestArchiveBuffer(options)).rejects.toThrow();
        },
        60000,
    );
});
