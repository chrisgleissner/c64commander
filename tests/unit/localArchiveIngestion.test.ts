import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { ingestLocalArchives, isSupportedLocalArchive } from '@/lib/sources/localArchiveIngestion';
import type { LocalSidFile } from '@/lib/sources/LocalFsSongSource';

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
});
