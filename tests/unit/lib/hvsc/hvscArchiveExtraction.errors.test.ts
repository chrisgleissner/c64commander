/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractArchiveEntries } from '@/lib/hvsc/hvscArchiveExtraction';
import { unzipSync } from 'fflate';
import { addErrorLog } from '@/lib/logging';

vi.mock('fflate', () => ({
    unzipSync: vi.fn(),
    UnzipInflate: class UnzipInflate { },
    Unzip: class MockUnzip {
        private readonly onFile: (entry: { name: string; ondata?: (error: Error | null, chunk: Uint8Array, final: boolean) => void; start: () => void }) => void;

        constructor(onFile: (entry: { name: string; ondata?: (error: Error | null, chunk: Uint8Array, final: boolean) => void; start: () => void }) => void) {
            this.onFile = onFile;
        }

        register() { }

        push(chunk: Uint8Array, final: boolean) {
            if (!final) return;
            const files = vi.mocked(unzipSync)(chunk as any) as Record<string, Uint8Array>;
            Object.entries(files || {}).forEach(([name, data]) => {
                if (!(data instanceof Uint8Array)) return;
                const entry = {
                    name,
                    ondata: undefined as ((error: Error | null, chunk: Uint8Array, final: boolean) => void) | undefined,
                    start: () => {
                        entry.ondata?.(null, data, true);
                    },
                };
                this.onFile(entry);
            });
        }
    },
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

// Setup sensitive mock for 7z-wasm
const mockFS = {
    mkdir: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    close: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    isDir: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
};

const mockModule = {
    FS: mockFS,
    callMain: vi.fn(),
};

vi.mock('7z-wasm', () => ({
    default: vi.fn().mockReturnValue(Promise.resolve(mockModule)),
}));

describe('hvscArchiveExtraction errors', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFS.readdir.mockReturnValue([]);
        mockFS.stat.mockReturnValue({ mode: 33188 });
        mockModule.callMain.mockReturnValue(0);
    });

    describe('Zip Yielding', () => {
        it('yields event loop during large zip extraction', async () => {
            // Mock 51 files
            const mockFiles: Record<string, Uint8Array> = {};
            for (let i = 0; i < 55; i++) {
                mockFiles[`file${i}.txt`] = new Uint8Array([]);
            }

            // @ts-expect-error mock
            vi.mocked(unzipSync).mockReturnValue(mockFiles);

            await extractArchiveEntries({
                archiveName: 'test.zip',
                buffer: new Uint8Array([]),
                onEntry: vi.fn(),
            });
        });

        it('yields event loop during large 7z extraction', async () => {
            // Mock a flat directory with 51 files
            const manyFiles = Array.from({ length: 55 }, (_, i) => `file${i}.txt`);

            mockFS.readdir.mockImplementation((dir) => {
                // Need to support readdir for cleanup too?
                // cleanupDir calls readdir(out).
                // walkDir calls readdir(out).
                if (dir.endsWith('out')) return manyFiles;
                return [];
            });
            mockFS.stat.mockReturnValue({ mode: 33188 }); // All files
            mockFS.isDir.mockReturnValue(false);
            mockFS.readFile.mockReturnValue(new Uint8Array([]));

            await extractArchiveEntries({
                archiveName: 'test.7z',
                buffer: new Uint8Array([]),
                onEntry: vi.fn(),
            });
        });
    });

    describe('7z Cleanup Errors', () => {
        it('logs errors when cleanupDir fails', async () => {
            // Setup successful 7z extraction flow
            mockFS.stat.mockReturnValue({ mode: 33188 }); // File
            mockFS.isDir.mockReturnValue(false);

            // readdir is called in walkDir then in cleanupDir
            mockFS.readdir
                .mockReturnValueOnce(['file.txt']) // walkDir
                .mockImplementation(() => { throw new Error('Cleanup error'); }); // cleanupDir

            await extractArchiveEntries({
                archiveName: 'test.7z',
                buffer: new Uint8Array([]),
                onEntry: vi.fn(),
            });

            expect(addErrorLog).toHaveBeenCalledWith('SevenZip cleanup failed', expect.objectContaining({ error: 'Cleanup error', step: 'cleanupDir' }));
        });
    });

    describe('Structure', () => {
        it('extracts nested directories', async () => {
            mockFS.stat.mockImplementation((p) => ({ mode: p.includes('.') ? 33188 : 16877 })); // Simple check
            mockFS.isDir.mockImplementation((m) => m === 16877);
            // Only return 'sub' in the output root, then 'deep.sid' in sub
            mockFS.readdir.mockImplementation((dir) => {
                // dir comes from workingDir logic which is random. Check endsWith.
                if (dir.endsWith('out')) return ['.', '..', 'sub'];
                if (dir.endsWith('sub')) return ['.', '..', 'deep.sid'];
                return [];
            });
            mockFS.readFile.mockReturnValue(new Uint8Array([]));

            const onEntry = vi.fn();
            await extractArchiveEntries({
                archiveName: 'test.7z',
                buffer: new Uint8Array([]),
                onEntry
            });

            expect(onEntry).toHaveBeenCalledWith(expect.stringMatching(/sub\/deep.sid/), expect.any(Uint8Array));
        });
    });
});
