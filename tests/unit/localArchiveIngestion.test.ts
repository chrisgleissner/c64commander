/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { ingestLocalArchives, isSupportedLocalArchive } from '@/lib/sources/localArchiveIngestion';
import type { LocalSidFile } from '@/lib/sources/LocalFsSongSource';

vi.mock('7z-wasm', () => {
  const moduleFactory = () => {
    const FS = {
      mkdir: vi.fn(),
      rmdir: vi.fn(),
      open: vi.fn(() => ({ fd: 1 })),
      write: vi.fn(),
      close: vi.fn(),
      unlink: vi.fn(),
      readdir: (dir: string) => {
        if (dir.endsWith('/out')) return ['.', '..', 'music'];
        if (dir.endsWith('/out/music')) return ['.', '..', 'track.sid', 'ignore.txt'];
        return ['.', '..'];
      },
      stat: (path: string) => ({ mode: path.endsWith('/out') || path.endsWith('/out/music') ? 'dir' : 'file' }),
      isDir: (mode: string) => mode === 'dir',
      readFile: (path: string) => {
        if (path.endsWith('track.sid')) {
          return new Uint8Array(Buffer.from('SIDDATA'));
        }
        return new Uint8Array();
      },
    };

    return { FS, callMain: vi.fn() };
  };

  return { default: moduleFactory };
});

describe('localArchiveIngestion', () => {
  it('detects supported archive extensions', () => {
    expect(isSupportedLocalArchive('collection.zip')).toBe(true);
    expect(isSupportedLocalArchive('collection.7z')).toBe(true);
    expect(isSupportedLocalArchive('track.sid')).toBe(false);
  });

  it('extracts SID files from zip archives', async () => {
    const archiveData = zipSync({
      'C64Music/track.sid': new Uint8Array(Buffer.from('SIDDATA')),
      'C64Music/ignore.txt': new Uint8Array(Buffer.from('IGNORE')),
    });
    const archiveFile: LocalSidFile = {
      name: 'collection.zip',
      lastModified: Date.now(),
      arrayBuffer: async () =>
        archiveData.buffer.slice(archiveData.byteOffset, archiveData.byteOffset + archiveData.byteLength),
    };
    const result = await ingestLocalArchives([archiveFile]);
    expect(result.archiveCount).toBe(1);
    expect(result.extractedCount).toBe(1);
    expect(result.files).toHaveLength(1);
    const entry = result.files[0];
    expect(entry.name).toBe('track.sid');
    expect(entry.webkitRelativePath).toContain('collection.zip');
    const buffer = await entry.arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe('SIDDATA');
  });

  it('keeps direct SID files and ignores unsupported files', async () => {
    const sidFile: LocalSidFile = {
      name: 'track.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array(Buffer.from('SID')).buffer,
    };
    const otherFile: LocalSidFile = {
      name: 'readme.txt',
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array(Buffer.from('TXT')).buffer,
    };

    const result = await ingestLocalArchives([sidFile, otherFile]);
    expect(result.archiveCount).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('track.sid');
  });

  it('extracts SID files from 7z archives using wasm module', async () => {
    const archiveFile: LocalSidFile = {
      name: 'collection.7z',
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array(Buffer.from('SEVENZ')).buffer,
    };

    const result = await ingestLocalArchives([archiveFile]);
    expect(result.archiveCount).toBe(1);
    expect(result.extractedCount).toBe(1);
    expect(result.files[0].name).toBe('track.sid');
    const buffer = await result.files[0].arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe('SIDDATA');
  });
});
