import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHvscSourceLocation } from '@/lib/sourceNavigation/hvscSourceAdapter';
import { getHvscFolderListing } from '@/lib/hvsc';

vi.mock('@/lib/hvsc', () => ({
  getHvscFolderListing: vi.fn(),
}));

describe('hvscSourceAdapter', () => {
  beforeEach(() => {
    vi.mocked(getHvscFolderListing).mockReset();
  });

  it('lists folders and songs sorted by name', async () => {
    vi.mocked(getHvscFolderListing).mockResolvedValue({
      path: '/ROOT',
      folders: ['/ROOT/B', '/ROOT/A'],
      songs: [
        { virtualPath: '/ROOT/z.sid', fileName: 'z.sid' },
        { virtualPath: '/ROOT/a.sid', fileName: 'a.sid' },
      ],
    });

    const source = createHvscSourceLocation('/ROOT');
    const entries = await source.listEntries('/ROOT');

    expect(entries.map((entry) => entry.name)).toEqual(['A', 'a.sid', 'B', 'z.sid']);
    expect(entries[0]).toMatchObject({ type: 'dir', path: '/ROOT/A' });
  });

  it('walks folders recursively and collects songs', async () => {
    vi.mocked(getHvscFolderListing).mockImplementation(async (path: string) => {
      if (path === '/ROOT') {
        return {
          path,
          folders: ['/ROOT/Sub'],
          songs: [{ virtualPath: '/ROOT/root.sid', fileName: 'root.sid' }],
        };
      }
      if (path === '/ROOT/Sub') {
        return {
          path,
          folders: [],
          songs: [{ virtualPath: '/ROOT/Sub/deep.sid', fileName: 'deep.sid' }],
        };
      }
      return { path, folders: [], songs: [] };
    });

    const source = createHvscSourceLocation('/ROOT');
    const entries = await source.listFilesRecursive('/ROOT');

    expect(entries).toEqual([
      { type: 'file', name: 'root.sid', path: '/ROOT/root.sid' },
      { type: 'file', name: 'deep.sid', path: '/ROOT/Sub/deep.sid' },
    ]);
  });

  it('aborts recursive listing when signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = createHvscSourceLocation('/ROOT');

    await expect(source.listFilesRecursive('/ROOT', { signal: controller.signal }))
      .rejects.toThrow('Aborted');
  });
});
