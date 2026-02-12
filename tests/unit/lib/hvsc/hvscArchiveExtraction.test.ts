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
import SevenZip from '7z-wasm';

// Mock dependencies
vi.mock('fflate', () => ({
  unzipSync: vi.fn(),
  UnzipInflate: class UnzipInflate {},
  Unzip: class MockUnzip {
    private readonly onFile: (entry: { name: string; ondata?: (error: Error | null, chunk: Uint8Array, final: boolean) => void; start: () => void }) => void;

    constructor(onFile: (entry: { name: string; ondata?: (error: Error | null, chunk: Uint8Array, final: boolean) => void; start: () => void }) => void) {
      this.onFile = onFile;
    }

    register() {}

    push(chunk: Uint8Array, final: boolean) {
      if (!final) return;
      const files = vi.mocked(unzipSync).mock.results.at(-1)?.value ?? vi.mocked(unzipSync)(chunk as any);
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

// Setup sophisticated mock for 7z-wasm
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

// The module factory returns the module promise
vi.mock('7z-wasm', () => ({
  default: vi.fn().mockImplementation(() => Promise.resolve(mockModule)),
}));

describe('hvscArchiveExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default behaviors for simple successful 7z run
    mockFS.readdir.mockReturnValue(['.','..']); // Default empty dir
    mockFS.stat.mockReturnValue({ mode: 33188 }); // Regular file
    mockFS.isDir.mockReturnValue(false);

    // Mock successful 7z Main call
    mockModule.callMain.mockReturnValue(0);
  });

  describe('ZIP extraction', () => {
    it('extracts zip files using fflate', async () => {
      // Mock unzipSync to return some files
      const mockFiles = {
        'folder/file1.txt': new Uint8Array([1, 2, 3]),
        'file2.bin': new Uint8Array([4, 5]),
        'ignore_me': 'not a uint8array', // Should be filtered out
      };
      // @ts-expect-error - simplified mock
      vi.mocked(unzipSync).mockReturnValue(mockFiles);

      const onEntry = vi.fn();
      const onProgress = vi.fn();
      const onEnumerate = vi.fn();

      await extractArchiveEntries({
        archiveName: 'test.zip',
        buffer: new Uint8Array([0xFF]),
        onEntry,
        onProgress,
        onEnumerate,
      });

      expect(unzipSync).toHaveBeenCalledWith(new Uint8Array([0xFF]));

      // Check callbacks
      expect(onEnumerate).toHaveBeenCalledWith(2); // 2 valid files
      expect(onEntry).toHaveBeenCalledTimes(2);
      expect(onEntry).toHaveBeenCalledWith('folder/file1.txt', new Uint8Array([1, 2, 3]));
      expect(onEntry).toHaveBeenCalledWith('file2.bin', new Uint8Array([4, 5]));

      expect(onProgress).toHaveBeenCalledTimes(2);
    });

    it('normalizes paths in zip', async () => {
      const mockFiles = {
        '\\windows\\path\\file.txt': new Uint8Array([]),
        '//leading/slash/file.txt': new Uint8Array([]),
      };
      // @ts-expect-error - mock return shape
      vi.mocked(unzipSync).mockReturnValue(mockFiles);

      const onEntry = vi.fn();
      await extractArchiveEntries({
        archiveName: 'test.zip',
        buffer: new Uint8Array([]),
        onEntry,
      });

      expect(onEntry).toHaveBeenCalledWith('windows/path/file.txt', expect.anything());
      expect(onEntry).toHaveBeenCalledWith('leading/slash/file.txt', expect.anything());
    });
  });

  describe('7z extraction', () => {
    it('initializes 7z module and extracts files', async () => {
        // Setup file structure mock for 7z
        // readdir is called for cleanup (twice) and for walking (recursively)
        // We need to valid mock responses.

        // Scenario: Root output dir contains 'folder' (dir) and 'file1.txt' (file)
        // 'folder' contains 'file2.txt'

        mockFS.readdir.mockImplementation((path) => {
            if (path.endsWith('/out')) return ['.', '..', 'folder', 'file1.txt'];
            if (path.endsWith('/folder')) return ['.', '..', 'file2.txt'];
            return ['.', '..'];
        });

        mockFS.stat.mockImplementation((path) => {
             // 16877 is dir, 33188 is file
             if (path.endsWith('folder')) return { mode: 16877 };
             return { mode: 33188 };
        });

        mockFS.isDir.mockImplementation((mode) => mode === 16877);

        mockFS.readFile.mockReturnValue(new Uint8Array([1, 2, 3])); // content for all files

        const onEntry = vi.fn();
        const onEnumerate = vi.fn();

        await extractArchiveEntries({
            archiveName: 'test.7z',
            buffer: new Uint8Array([0xAA]), // The 7z content
            onEntry,
            onEnumerate
        });

        // 1. Check initialization
        expect(SevenZip).toHaveBeenCalled();

        // 2. Check Input Write
        expect(mockFS.mkdir).toHaveBeenCalled(); // work dir and out dir
        expect(mockFS.open).toHaveBeenCalledWith(expect.stringMatching(/test.7z$/), 'w+');
        expect(mockFS.write).toHaveBeenCalled();

        // 3. Check Extraction Command
        expect(mockModule.callMain).toHaveBeenCalledWith([
            'x',
            expect.stringMatching(/test.7z$/),
            expect.stringMatching(/-o.*\/out/),
            '-y'
        ]);

        // 4. Check Traversal and entry processing
        // Should find file1.txt and file2.txt
        expect(onEnumerate).toHaveBeenCalledWith(2);

        // The mock logic normalizes paths.
        // walkDir('out', '') -> 'file1.txt'
        // walkDir('folder', 'folder/') -> 'folder/file2.txt'
        expect(onEntry).toHaveBeenCalledWith('file1.txt', expect.any(Uint8Array));
        expect(onEntry).toHaveBeenCalledWith('folder/file2.txt', expect.any(Uint8Array));

        // 5. Check Cleanup
        // Cleanup should remove dir structure
        expect(mockFS.unlink).toHaveBeenCalled();
        expect(mockFS.rmdir).toHaveBeenCalled();
    });

    it('falls back to zip if 7z fails', async () => {
        // Mock 7z failure
        mockModule.callMain.mockImplementation(() => { throw new Error('7z broken'); });

        // Mock Zip success
        // @ts-expect-error - mock return shape
        vi.mocked(unzipSync).mockReturnValue({'fallback.txt': new Uint8Array([1])});

        const onEntry = vi.fn();
        await extractArchiveEntries({
            archiveName: 'test.7z',
            buffer: new Uint8Array([]),
            onEntry,
        });

        expect(mockModule.callMain).toHaveBeenCalled();
        expect(unzipSync).toHaveBeenCalled(); // Fallback triggered
        expect(onEntry).toHaveBeenCalledWith('fallback.txt', expect.anything());
    });

    it('throws if 7z fails and fallback fails', async () => {
        // Mock 7z failure
        const originalError = new Error('7z broken');
        mockModule.callMain.mockImplementation(() => { throw originalError; });

        // Mock Zip failure
        vi.mocked(unzipSync).mockImplementation(() => { throw new Error('Zip also broken'); });

        await expect(extractArchiveEntries({
            archiveName: 'test.7z',
            buffer: new Uint8Array([]),
            onEntry: vi.fn(),
        })).rejects.toThrow('Failed to extract test.7z: 7z broken');
    });

    it('handles cleanup errors gracefully', async () => {
        mockModule.callMain.mockReturnValue(0);

        // Make multiple cleanup steps fail
        mockFS.rmdir.mockImplementation(() => { throw new Error('FS Locked'); });
        mockFS.unlink.mockImplementation(() => { throw new Error('File Locked'); });

        await extractArchiveEntries({
            archiveName: 'test.7z',
            buffer: new Uint8Array([]),
            onEntry: vi.fn(),
        });

        // Should have logged multiple errors
        expect(addErrorLog).toHaveBeenCalledWith('SevenZip cleanup failed', expect.objectContaining({ step: 'rmdir-output' }));
        expect(addErrorLog).toHaveBeenCalledWith('SevenZip cleanup failed', expect.objectContaining({ step: 'unlink-archive' }));
        expect(addErrorLog).toHaveBeenCalledWith('SevenZip cleanup failed', expect.objectContaining({ step: 'rmdir-workdir' }));
    });
  });

  describe('Format detection', () => {
    it('throws on unsupported format', async () => {
      await expect(extractArchiveEntries({
        archiveName: 'test.rar',
        buffer: new Uint8Array([]),
        onEntry: vi.fn(),
      })).rejects.toThrow('Unsupported archive format: test.rar');
    });
  });
});
