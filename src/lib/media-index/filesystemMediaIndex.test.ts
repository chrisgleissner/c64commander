/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Capacitor Filesystem
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        readFile: () => mockReadFile(),
        writeFile: (_args: unknown) => mockWriteFile(_args),
        mkdir: (_args: unknown) => mockMkdir(_args),
    },
    Directory: {
        Data: 'Data',
    },
}));

describe('filesystemMediaIndex', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetModules();
    });

    describe('FilesystemMediaIndexStorage', () => {
        it('returns null when file does not exist', async () => {
            mockReadFile.mockRejectedValue(new Error('File not found'));

            const { FilesystemMediaIndexStorage } = await import('./filesystemMediaIndex');
            const storage = new FilesystemMediaIndexStorage();
            const result = await storage.read();

            expect(result).toBeNull();
        });

        it('reads and parses valid snapshot', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song.sid', name: 'song.sid', type: 'sid' as const },
                ],
            };
            // Base64 encode the JSON
            const jsonStr = JSON.stringify(snapshot);
            const base64 = btoa(jsonStr);
            mockReadFile.mockResolvedValue({ data: base64 });

            const { FilesystemMediaIndexStorage } = await import('./filesystemMediaIndex');
            const storage = new FilesystemMediaIndexStorage();
            const result = await storage.read();

            expect(result).toEqual(snapshot);
        });

        it('returns null for invalid JSON', async () => {
            mockReadFile.mockResolvedValue({ data: btoa('invalid json') });

            const { FilesystemMediaIndexStorage } = await import('./filesystemMediaIndex');
            const storage = new FilesystemMediaIndexStorage();
            const result = await storage.read();

            expect(result).toBeNull();
        });

        it('writes snapshot to filesystem', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [],
            };

            const { FilesystemMediaIndexStorage } = await import('./filesystemMediaIndex');
            const storage = new FilesystemMediaIndexStorage();
            await storage.write(snapshot);

            expect(mockMkdir).toHaveBeenCalled();
            expect(mockWriteFile).toHaveBeenCalled();
        });
    });
});
