import { describe, expect, it } from 'vitest';
import type { MediaIndexSnapshot, MediaIndexStorage } from '@/lib/media-index';
import { JsonMediaIndex } from '@/lib/media-index';
import type { HvscFolderListing } from '@/lib/hvsc';
import { HvscMediaIndexAdapter } from '@/lib/hvsc';

const createMemoryStorage = (): MediaIndexStorage => {
  let current: MediaIndexSnapshot | null = null;
  return {
    read: async () => current,
    write: async (next) => {
      current = next;
    },
  };
};

describe('HvscMediaIndexAdapter', () => {
  it('scans folder listings and writes entries to the index', async () => {
    const listings: Record<string, HvscFolderListing> = {
      '/': { path: '/', folders: ['/Demos'], songs: [] },
      '/Demos': {
        path: '/Demos',
        folders: [],
        songs: [
          { id: 1, virtualPath: '/Demos/demo.sid', fileName: 'demo.sid', durationSeconds: 45 },
        ],
      },
    };

    const listFolder = async (path: string) => listings[path];
    const storage = createMemoryStorage();
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(storage), listFolder);

    await adapter.scan(['/']);

    const entry = adapter.queryByPath('/Demos/demo.sid');
    expect(entry?.name).toBe('demo.sid');
    expect(adapter.queryByType('sid')).toHaveLength(1);
  });
});
