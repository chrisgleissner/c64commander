/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { listLocalFiles, listLocalFolders, getParentPath } from '@/lib/playback/localFileBrowser';

const makeFile = (path: string, size = 100, lastModified = 1000) => {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  const file = new File(['x'.repeat(size)], name, { lastModified });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

// Fallback for files without webkitRelativePath
const makeSimpleFile = (name: string) => {
    const file = new File([''], name);
    // Ensure no webkitRelativePath or empty
    Object.defineProperty(file, 'webkitRelativePath', { value: '' });
    return file;
};

describe('localFileBrowser', () => {
  const files = [
    makeFile('Root.txt'),
    makeFile('Music/Song.sid'),
    makeFile('Music/Album/Track.sid'),
    makeFile('Docs/Readme.md'),
    makeFile('Music/Other.sid'),
  ];

  describe('listLocalFolders', () => {
    it('lists top level folders', () => {
      const folders = listLocalFolders(files, '/');
      expect(folders).toEqual(['/Docs/', '/Music/']);
    });

    it('lists nested folders', () => {
      const folders = listLocalFolders(files, '/Music/');
      expect(folders).toEqual(['/Music/Album/']);
    });

    it('returns empty array if no folders', () => {
      const folders = listLocalFolders(files, '/Music/Album/');
      expect(folders).toEqual([]);
    });
    
    it('handles empty path as root', () => {
        const folders = listLocalFolders(files, '');
        expect(folders).toEqual(['/Docs/', '/Music/']);
    });

    it('ignores files that do not match prefix', () => {
        // Files in specific path only
        const f = [makeFile('A/B/C.txt')];
        expect(listLocalFolders(f, '/Z/')).toEqual([]);
    });
  });

  describe('listLocalFiles', () => {
    it('includes size and modified timestamp for listed files', () => {
      const file = new File(['data'], 'song.sid', { lastModified: 123456 });
      Object.defineProperty(file, 'webkitRelativePath', { value: 'Music/song.sid' });
      
      const results = listLocalFiles([file], '/Music/');
      expect(results[0]?.sizeBytes).toBe(4);
      expect(results[0]?.modifiedAt).toBe(new Date(123456).toISOString());
    });

    it('lists files in root', () => {
        const results = listLocalFiles(files, '/');
        expect(results.map(f => f.name)).toEqual(['Root.txt']);
    });

    it('lists files in subfolder', () => {
        const results = listLocalFiles(files, '/Music/');
        expect(results.map(f => f.name)).toEqual(['Other.sid', 'Song.sid']); 
    });

    it('falls back to name if relative path missing', () => {
        const f = makeSimpleFile('simple.txt');
        const results = listLocalFiles([f], '/');
        expect(results).toHaveLength(1);
        expect(results[0].path).toBe('/simple.txt');
    });

    it('handles weird paths', () => {
        // Path normalization logic in getLocalPath
        const f = { name: 'foo.txt', webkitRelativePath: 'foo.txt' } as any; // manually mock structure
        const results = listLocalFiles([f], '/');
        expect(results[0].path).toBe('/foo.txt');
    });
  });

  describe('getParentPath', () => {
    it('returns root for root', () => {
        expect(getParentPath('/')).toBe('/');
        expect(getParentPath('')).toBe('/');
    });

    it('returns root for top level folders', () => {
        expect(getParentPath('/Music/')).toBe('/');
    });

    it('returns parent for nested folders', () => {
        expect(getParentPath('/Music/Album/')).toBe('/Music/');
    });
    
    it('handles paths without trailing slash', () => {
        expect(getParentPath('/Music')).toBe('/'); 
    });
    
    it('handles various depths', () => {
        expect(getParentPath('/A/B/C/')).toBe('/A/B/');
    });
  });
});