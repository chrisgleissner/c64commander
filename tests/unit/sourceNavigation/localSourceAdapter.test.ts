import { beforeEach, describe, expect, it, vi } from 'vitest';

const listChildrenMock = vi.fn();

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    listChildren: (...args: unknown[]) => listChildrenMock(...args),
  },
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'android',
}));

import { createLocalSourceLocation } from '@/lib/sourceNavigation/localSourceAdapter';
import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';
import type { LocalSourceRecord } from '@/lib/sourceNavigation/localSourcesStore';

const buildAndroidSource = (): LocalSourceRecord => ({
  id: 'source-1',
  name: 'Android SAF',
  rootName: 'Android SAF',
  rootPath: '/',
  createdAt: new Date().toISOString(),
  entries: undefined,
  android: {
    treeUri: 'content://tree/primary%3AMusic',
    rootName: 'Music',
    permissionGrantedAt: new Date().toISOString(),
  },
});

describe('localSourceAdapter', () => {
  beforeEach(() => {
    listChildrenMock.mockReset();
  });

  it('uses SAF listChildren without touching entries', async () => {
    const source = buildAndroidSource();
    Object.defineProperty(source, 'entries', {
      get: () => {
        throw new Error('entries accessed');
      },
    });
    listChildrenMock.mockResolvedValue({ entries: [] });

    const location = createLocalSourceLocation(source);
    const result = await location.listEntries('/');

    expect(result).toEqual([]);
    expect(listChildrenMock).toHaveBeenCalledWith({ treeUri: source.android?.treeUri, path: '/' });
  });

  it('throws a typed error when SAF listChildren returns invalid entries', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({ entries: { bad: true } });

    const location = createLocalSourceLocation(source);

    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });
});
