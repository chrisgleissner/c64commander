/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as hvscFS from '@/lib/hvsc/hvscFilesystem';
import { Filesystem, Directory } from '@capacitor/filesystem';
import {
  ensureHvscSonglengthsReadyOnColdStart,
  resolveHvscSonglengthDuration,
} from '@/lib/hvsc/hvscSongLengthService';

// Mock dependencies
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    stat: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    deleteFile: vi.fn(),
    mkdir: vi.fn(),
    rmdir: vi.fn(),
  },
  Directory: { Data: 'DATA' },
}));

vi.mock('@/lib/hvsc/hvscSongLengthService', () => ({
  ensureHvscSonglengthsReadyOnColdStart: vi.fn(async () => undefined),
  resolveHvscSonglengthDuration: vi.fn(async () => ({ durationSeconds: null, strategy: 'not-found' })),
  resetHvscSonglengths: vi.fn(),
}));

vi.mock('@/lib/sid/sidUtils', () => ({
  base64ToUint8: vi.fn((str) => {
       // Simple implementation for test env
       try {
           const bin = atob(str);
           const arr = new Uint8Array(bin.length);
           for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
           return arr;
       } catch (e) {
           return new Uint8Array([]);
       }
  }),
}));

vi.mock('@/lib/sourceNavigation/paths', () => ({
  normalizeSourcePath: vi.fn((p) => p),
}));

describe('hvscFilesystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks(); // Ensure no leaking implementations
    hvscFS.resetSonglengthsCache();
  });

  describe('ensureHvscDirs', () => {
    it('creates library and cache directories', async () => {
      // @ts-expect-error - mock typing
      vi.mocked(Filesystem.stat).mockRejectedValue(new Error('Not found'));
      
      await hvscFS.ensureHvscDirs();

      expect(Filesystem.mkdir).toHaveBeenCalledWith(expect.objectContaining({
        path: expect.stringContaining('hvsc/library')
      }));
      expect(Filesystem.mkdir).toHaveBeenCalledWith(expect.objectContaining({
        path: expect.stringContaining('hvsc/cache')
      }));
    });

    it('handles existing directories gracefully', async () => {
      // @ts-expect-error - mock typing
      vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'directory' });
      
      await hvscFS.ensureHvscDirs();

      expect(Filesystem.mkdir).not.toHaveBeenCalled();
    });

    it('deletes conflicting files', async () => {
      // @ts-expect-error - mock typing
      vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'file' });
      
      await hvscFS.ensureHvscDirs();

      expect(Filesystem.deleteFile).toHaveBeenCalled();
      expect(Filesystem.mkdir).toHaveBeenCalled();
    });
  });

  describe('listHvscFolder', () => {
    it('lists folders and songs', async () => {
      // @ts-expect-error - mock typing
      vi.mocked(Filesystem.readdir).mockResolvedValue({
        files: [
          { name: 'SUBDIR', type: 'directory' },
          { name: 'MUSIC.sid', type: 'file' }
        ]
      });

      // @ts-expect-error - mock typing
      vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({ durationSeconds: 123, strategy: 'full-path' } as any);
       
      const result = await hvscFS.listHvscFolder('/ROOT');

      expect(result.path).toBe('/ROOT');
      expect(result.folders).toContain('/ROOT/SUBDIR');
      expect(result.songs).toHaveLength(1);
      expect(result.songs[0].fileName).toBe('MUSIC.sid');
      expect(result.songs[0].durationSeconds).toBe(123);
      expect(ensureHvscSonglengthsReadyOnColdStart).toHaveBeenCalled();
    });
  });

  describe('writeLibraryFile behavior (writeFileWithRetry)', () => {
    it('writes file creating parents', async () => {
        // @ts-expect-error - mock typing
        vi.mocked(Filesystem.stat).mockRejectedValue(new Error('no dir'));
        
        await hvscFS.writeLibraryFile('/DEMO/test.sid', new Uint8Array([65, 66]));
        
        expect(Filesystem.mkdir).toHaveBeenCalled();
        expect(Filesystem.writeFile).toHaveBeenCalled();
    });

    it('retries on exists error (directory conflict)', async () => {
         const failError = new Error('File exists');
         // @ts-expect-error - mock typing
         vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(failError)
                                        .mockResolvedValueOnce({ uri: 'ok' });
         
         // Stat called for parent dir check AND for retry logic
         // @ts-expect-error - mock typing
         vi.mocked(Filesystem.stat).mockImplementation(async ({ path }) => {
            if (path.includes('test.sid')) return { type: 'directory' }; // Conflict is a directory
            return { type: 'directory' }; // Parent
         });

         await hvscFS.writeLibraryFile('/DEMO/test.sid', new Uint8Array([]));

         expect(Filesystem.rmdir).toHaveBeenCalled();
         expect(Filesystem.writeFile).toHaveBeenCalledTimes(2);
    });
    
    it('ignores exists error if it is already a file', async () => {
        const failError = new Error('File exists');
        // @ts-expect-error - mock typing
        vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(failError);
        
        // Stat confirms it is a file
        // @ts-expect-error - mock typing
        vi.mocked(Filesystem.stat).mockImplementation(async ({ path }) => {
            if (path.includes('test.sid')) return { type: 'file' };
            return { type: 'directory' }; // Parent must be directory
        });

        await hvscFS.writeLibraryFile('/DEMO/test.sid', new Uint8Array([]));
        
        expect(Filesystem.deleteFile).not.toHaveBeenCalled();
        expect(Filesystem.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('readCachedArchiveMarker', () => {
      it('reads and parses marker', async () => {
          const marker = { version: 1, type: 'baseline', completedAt: 'now' };
          const json = JSON.stringify(marker);
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.readFile).mockResolvedValue({
              data: btoa(json)
          });

          const result = await hvscFS.readCachedArchiveMarker('test');
          expect(result).toEqual(marker);
      });

      it('returns null on invalid json', async () => {
           // @ts-expect-error - mock typing
           vi.mocked(Filesystem.readFile).mockResolvedValue({
              data: btoa('{ invalid: }')
          });
          const result = await hvscFS.readCachedArchiveMarker('test');
          expect(result).toBeNull();
      });
      
      it('returns null on missing file', async () => {
           // @ts-expect-error - mock typing
           vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('no file'));
          const result = await hvscFS.readCachedArchiveMarker('test');
          expect(result).toBeNull();
      });
  });
  
  describe('resetLibraryRoot', () => {
      it('recreates the library directory', async () => {
           // @ts-expect-error - mock typing
           vi.mocked(Filesystem.stat).mockRejectedValue(new Error('not found'));

           await hvscFS.resetLibraryRoot();
           expect(Filesystem.rmdir).toHaveBeenCalledWith(expect.objectContaining({
               path: expect.stringContaining('hvsc/library'),
               recursive: true
           }));
           expect(Filesystem.mkdir).toHaveBeenCalled();
      });

      it('ignores errors during rmdir', async () => {
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.rmdir).mockRejectedValue(new Error('rmdir fail'));
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.stat).mockRejectedValue(new Error('not found'));
          
          await hvscFS.resetLibraryRoot();
          expect(Filesystem.mkdir).toHaveBeenCalled();
      });
  });
  
  describe('getHvscSongByVirtualPath', () => {
      it('reads song content and returns object', async () => {
           // @ts-expect-error - mock typing
           vi.mocked(Filesystem.readFile).mockResolvedValue({ data: 'BASE64DATA' });
           
           const song = await hvscFS.getHvscSongByVirtualPath('/C64/Music.sid');
           expect(song).not.toBeNull();
           expect(song?.fileName).toBe('Music.sid');
           expect(song?.dataBase64).toBe('BASE64DATA');
      });
      
      it('returns null on error', async () => {
            // @ts-expect-error - mock typing
           vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('fail'));
           const song = await hvscFS.getHvscSongByVirtualPath('/C64/Music.sid');
           expect(song).toBeNull();
      });
  });

  describe('Additional file operations', () => {
      it('deletes library file', async () => {
          await hvscFS.deleteLibraryFile('C64/file.sid');
          expect(Filesystem.deleteFile).toHaveBeenCalledWith(expect.objectContaining({
              path: expect.stringContaining('file.sid')
          }));
      });

      it('writes cached archive', async () => {
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.stat).mockRejectedValue(new Error('no dir'));
          await hvscFS.writeCachedArchive('arch.zip', new Uint8Array([65]));
           expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({
              path: expect.stringContaining('arch.zip')
          }));
      });
      
      it('reads cached archive', async () => {
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.readFile).mockResolvedValue({ data: btoa('bin') });
          const content = await hvscFS.readCachedArchive('arch.zip');
          expect(content).toBeInstanceOf(Uint8Array);
      });

      it('writes cached archive marker', async () => {
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.stat).mockRejectedValue(new Error('no dir'));
          await hvscFS.writeCachedArchiveMarker('arch', { version: 1, type: 'baseline', completedAt: 'now' });
          expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({
              path: expect.stringContaining('arch.complete.json')
          }));
      });

      it('deletes cached archive robustly', async () => {
          // Case 1: Delete file succeeds
           // @ts-expect-error - mock typing
          vi.mocked(Filesystem.deleteFile).mockResolvedValue();
          await hvscFS.deleteCachedArchive('sub/arch.zip');
          
          // Case 2: Delete file fails (it's a dir?), try rmdir
           // @ts-expect-error - mock typing
           vi.mocked(Filesystem.deleteFile).mockRejectedValueOnce(new Error('fail'));
           await hvscFS.deleteCachedArchive('sub/arch.zip');
           expect(Filesystem.rmdir).toHaveBeenCalled();
           
           // Case 3: Marker deletion implicit
           expect(Filesystem.deleteFile).toHaveBeenCalledWith(expect.objectContaining({
               path: expect.stringContaining('complete.json')
           }));
      });

      it('ignores all errors when deleting cached archive', async () => {
          // Mock ALL failures
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.deleteFile).mockRejectedValue(new Error('fail delete'));
          // @ts-expect-error - mock typing
          vi.mocked(Filesystem.rmdir).mockRejectedValue(new Error('fail rmdir'));

          await hvscFS.deleteCachedArchive('sub/arch.zip');
          
          expect(Filesystem.rmdir).toHaveBeenCalled(); // Tried fallback
          // No throw
      });
  });
});
