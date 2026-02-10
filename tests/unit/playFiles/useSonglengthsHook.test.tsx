/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import * as toastModule from '@/hooks/use-toast';
import * as loggingModule from '@/lib/logging';
import * as platformModule from '@/lib/native/platform';

vi.mock('@/lib/playback/fileLibraryUtils', () => ({
  buildLocalPlayFileFromUri: vi.fn(),
}));

import { buildLocalPlayFileFromUri } from '@/lib/playback/fileLibraryUtils';

vi.mock('@/lib/sid/sidUtils', () => ({
  computeSidMd5: async () => 'deadbeef',
}));

let toastMock: ReturnType<typeof vi.fn>;
let addErrorLogMock: ReturnType<typeof vi.fn>;
let buildLocalPlayFileFromUriMock: ReturnType<typeof vi.fn>;

const platformState = { platform: 'web', native: false };

import type { PlaylistItem } from '@/pages/playFiles/types';
import type { SonglengthsFileEntry } from '@/pages/playFiles/hooks/useSonglengths';
import { useSonglengths } from '@/pages/playFiles/hooks/useSonglengths';

type HookResult<T> = { current: T | null };

const activeUnmounts = new Set<() => void>();

const renderUseSonglengths = (playlist: PlaylistItem[]) => {
  const resultRef: HookResult<ReturnType<typeof useSonglengths>> = { current: null };
  const Component = ({ items }: { items: PlaylistItem[] }) => {
    resultRef.current = useSonglengths({ playlist: items });
    return null;
  };
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Component items={playlist} />);
  });
  const unmount = () => renderer.unmount();
  activeUnmounts.add(unmount);
  return {
    result: resultRef,
    rerender: (items: PlaylistItem[]) => {
      act(() => {
        renderer.update(<Component items={items} />);
      });
    },
    unmount: () => {
      activeUnmounts.delete(unmount);
      act(() => {
        unmount();
      });
    },
  };
};

const ensureStorage = () => {
  if (typeof localStorage !== 'undefined') return;
  let store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    },
  });
};


const toFileList = (file: File): FileList => ({
  0: file,
  length: 1,
  item: (index: number) => (index === 0 ? file : null),
} as unknown as FileList);

const makeTextFile = (path: string, content: string, lastModified = 123) => {
  const file = {
    name: path.split('/').pop() || path,
    webkitRelativePath: path,
    lastModified,
    size: content.length,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  };
  return file;
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.restoreAllMocks();
  ensureStorage();
  toastMock = vi.spyOn(toastModule, 'toast').mockImplementation(() => {});
  addErrorLogMock = vi.spyOn(loggingModule, 'addErrorLog').mockImplementation(() => {});
  buildLocalPlayFileFromUriMock = vi.mocked(buildLocalPlayFileFromUri);
  vi.spyOn(platformModule, 'getPlatform').mockImplementation(() => platformState.platform);
  vi.spyOn(platformModule, 'isNativePlatform').mockImplementation(() => platformState.native);
  platformState.platform = 'web';
  platformState.native = false;
  localStorage.clear();
});

afterEach(() => {
  activeUnmounts.forEach((unmount) => {
    act(() => {
      unmount();
    });
  });
  activeUnmounts.clear();
});

describe('useSonglengths', () => {
  it('rejects unsupported songlengths input', () => {
    const { result } = renderUseSonglengths([]);
    const unsupported = makeTextFile('/DOCUMENTS/nope.bin', 'x');
    act(() => {
      result.current?.handleSonglengthsInput(toFileList(unsupported as unknown as File));
    });
    expect(toastMock).toHaveBeenCalled();
    expect(result.current?.songlengthsFiles).toHaveLength(0);
  });

  it('accepts supported songlengths input and summarizes it', async () => {
    localStorage.setItem('c64u_songlengths_file:v1', JSON.stringify({
      path: '/DOCUMENTS/Songlengths.md5',
      uri: 'content://demo',
      name: 'Songlengths.md5',
    }));
    const file = makeTextFile('DOCUMENTS/Songlengths.md5', '; /MUSICIANS/demo.sid\nabcdef=0:10\n');

    const { result } = renderUseSonglengths([]);
    act(() => {
      result.current?.handleSonglengthsInput(toFileList(file));
    });

    await act(async () => {
      await flushPromises();
    });
    expect(result.current?.songlengthsSummary.entryCount).toBe(1);
    expect(result.current?.activeSonglengthsPath).toBe('/DOCUMENTS/Songlengths.md5');
    expect(localStorage.getItem('c64u_songlengths_file:v1')).toBeNull();
  });

  it('reports empty songlengths file summary', async () => {
    const file = makeTextFile('DOCUMENTS/Songlengths.md5', '; /demo.sid\n');
    const { result } = renderUseSonglengths([]);

    act(() => {
      result.current?.handleSonglengthsInput(toFileList(file));
    });

    await act(async () => {
      await flushPromises();
    });
    expect(result.current?.songlengthsSummary.error).toMatch(/no entries/i);
  });

  it('loads songlengths for a path with caching and file-cache reuse', async () => {
    const reads = { count: 0 };
    const songlengthsFile = {
      name: 'Songlengths.md5',
      webkitRelativePath: '/DOCUMENTS/Songlengths.md5',
      lastModified: 456,
      arrayBuffer: async () => {
        reads.count += 1;
        return new TextEncoder().encode('; /MUSICIANS/demo.sid\nabc=0:30 0:45\n').buffer;
      },
    };
    const extraFiles: SonglengthsFileEntry[] = [{ path: '/DOCUMENTS/Songlengths.md5', file: songlengthsFile }];
    const { result } = renderUseSonglengths([]);

    const data1 = await result.current?.loadSonglengthsForPath('/MUSICIANS/demo.sid', extraFiles);
    expect(data1?.pathToSeconds.get('/MUSICIANS/demo.sid')).toEqual([30, 45]);
    expect(reads.count).toBe(1);

    const data2 = await result.current?.loadSonglengthsForPath('/MUSICIANS/demo.sid', extraFiles);
    expect(data2?.pathToSeconds.get('/MUSICIANS/demo.sid')).toEqual([30, 45]);
    expect(reads.count).toBe(1);

    const data3 = await result.current?.loadSonglengthsForPath('/DEMOS/demo.sid', extraFiles);
    expect(data3?.pathToSeconds.get('/MUSICIANS/demo.sid')).toEqual([30, 45]);
    expect(reads.count).toBe(1);

    const candidates = result.current?.collectSonglengthsCandidates(['/MUSICIANS/demo.sid']) ?? [];
    expect(candidates.some((path) => path.toLowerCase().includes('songlengths'))).toBe(true);
  });

  it('logs songlengths read/parse failures and returns null when no candidates exist', async () => {
    const failingFile = {
      name: 'Songlengths.md5',
      webkitRelativePath: '/DOCUMENTS/Songlengths.md5',
      lastModified: 1,
      arrayBuffer: async () => {
        throw new Error('boom');
      },
    };
    const extraFiles: SonglengthsFileEntry[] = [{ path: '/DOCUMENTS/Songlengths.md5', file: failingFile }];
    const { result } = renderUseSonglengths([]);

    const loaded = await result.current?.loadSonglengthsForPath('/MUSICIANS/demo.sid', extraFiles);
    expect(loaded?.pathToSeconds.size).toBe(0);
    expect(addErrorLogMock).toHaveBeenCalled();

    const empty = await result.current?.loadSonglengthsForPath('/MUSICIANS/demo.sid', []);
    expect(empty).toBeNull();
  });

  it('applies a manually selected songlengths file globally across folders', async () => {
    const file = makeTextFile('DOCUMENTS/Songlengths.txt', '/MUSICIANS/demo.sid 0:25\n');
    const { result } = renderUseSonglengths([]);

    act(() => {
      result.current?.handleSonglengthsInput(toFileList(file));
    });

    const loaded = await result.current?.loadSonglengthsForPath('/OTHER/demo.sid');
    expect(loaded?.pathToSeconds.get('/MUSICIANS/demo.sid')).toEqual([25]);

    const playlistItem: PlaylistItem = {
      id: 'song',
      category: 'sid',
      label: 'demo.sid',
      path: '/MUSICIANS/demo.sid',
      request: { source: 'local', path: '/MUSICIANS/demo.sid', songNr: 1 },
    };
    const updated = await result.current?.applySonglengthsToItems([playlistItem]);
    expect(updated[0]?.durationMs).toBe(25_000);
  });

  it('reprocesses playlist durations after selecting a new songlengths file', async () => {
    const first = makeTextFile('DOCUMENTS/Songlengths.txt', '/MUSICIANS/demo.sid 0:25\n');
    const second = makeTextFile('DOCUMENTS/Songlengths.md5', '; /MUSICIANS/demo.sid\nabcd=0:45\n');
    const playlistItem: PlaylistItem = {
      id: 'song',
      category: 'sid',
      label: 'demo.sid',
      path: '/MUSICIANS/demo.sid',
      request: { source: 'local', path: '/MUSICIANS/demo.sid', songNr: 1 },
    };

    const { result } = renderUseSonglengths([playlistItem]);
    act(() => {
      result.current?.handleSonglengthsInput(toFileList(first));
    });

    const firstPass = await result.current?.applySonglengthsToItems([playlistItem]);
    expect(firstPass?.[0]?.durationMs).toBe(25_000);

    act(() => {
      result.current?.handleSonglengthsInput(toFileList(second));
    });

    const secondPass = await result.current?.applySonglengthsToItems([playlistItem]);
    expect(secondPass?.[0]?.durationMs).toBe(45_000);
  });

  it('prefers Songlengths.md5 over Songlengths.txt when both exist in the same folder', async () => {
    const txt = makeTextFile('DOCUMENTS/Songlengths.txt', '/MUSICIANS/demo.sid 0:10\n');
    const md5 = makeTextFile('DOCUMENTS/Songlengths.md5', '; /MUSICIANS/demo.sid\nabc=0:20\n');

    const playlist: PlaylistItem[] = [
      {
        id: 'txt',
        category: 'sid',
        label: 'Songlengths.txt',
        path: '/DOCUMENTS/Songlengths.txt',
        request: { source: 'local', path: '/DOCUMENTS/Songlengths.txt', file: txt },
      },
      {
        id: 'md5',
        category: 'sid',
        label: 'Songlengths.md5',
        path: '/DOCUMENTS/Songlengths.md5',
        request: { source: 'local', path: '/DOCUMENTS/Songlengths.md5', file: md5 },
      },
      {
        id: 'song',
        category: 'sid',
        label: 'demo.sid',
        path: '/MUSICIANS/demo.sid',
        request: { source: 'local', path: '/MUSICIANS/demo.sid', songNr: 1 },
      },
    ];

    const { result } = renderUseSonglengths(playlist);
    const updated = await result.current?.applySonglengthsToItems([playlist[2]]);
    expect(updated[0]?.durationMs).toBe(20_000);

    // Ensure the opposite insertion order doesn't replace an existing .md5 with .txt.
    const playlistReversed: PlaylistItem[] = [playlist[1], playlist[0], playlist[2]];
    const { result: result2 } = renderUseSonglengths(playlistReversed);
    const updated2 = await result2.current?.applySonglengthsToItems([playlistReversed[2]]);
    expect(updated2[0]?.durationMs).toBe(20_000);
  });

  it('handles Android persisted selection and manual picker', async () => {
    platformState.platform = 'android';
    platformState.native = true;

    buildLocalPlayFileFromUriMock.mockReturnValue(makeTextFile(
      '/DOCUMENTS/Songlengths.md5',
      '; /MUSICIANS/demo.sid\nabc=0:11\n',
      999,
    ));

    localStorage.setItem('c64u_songlengths_file:v1', JSON.stringify({
      path: '/DOCUMENTS/Songlengths.md5',
      uri: 'content://demo',
      name: 'Songlengths.md5',
      sizeBytes: 42,
      modifiedAt: '2025-01-01T00:00:00.000Z',
    }));

    const { result, rerender } = renderUseSonglengths([]);

    await act(async () => {
      await flushPromises();
    });
    expect(result.current?.songlengthsFiles).toHaveLength(1);

    act(() => {
      result.current?.handleSonglengthsPicked({
        path: '/DOCUMENTS/Songlengths.md5',
        uri: 'content://picked',
        name: 'Songlengths.md5',
        sizeBytes: 55,
        modifiedAt: '2025-02-02T00:00:00.000Z',
      });
    });

    await act(async () => {
      await flushPromises();
    });
    expect(result.current?.songlengthsFiles[0]?.uri).toBe('content://picked');
    expect(localStorage.getItem('c64u_songlengths_file:v1')).toMatch(/content:\/\/picked/);

    // Coverage for cache invalidation effect.
    rerender([{
      id: 'song',
      category: 'sid',
      label: 'demo.sid',
      path: '/MUSICIANS/demo.sid',
      request: { source: 'local', path: '/MUSICIANS/demo.sid', songNr: 1 },
    }]);
  });

  it('reports songlengths summary read failures', async () => {
    platformState.platform = 'android';
    platformState.native = true;

    buildLocalPlayFileFromUriMock.mockReturnValue({
      name: 'Songlengths.md5',
      webkitRelativePath: '/DOCUMENTS/Songlengths.md5',
      lastModified: 1,
      arrayBuffer: async () => {
        throw new Error('read failed');
      },
    });

    const { result } = renderUseSonglengths([]);
    act(() => {
      result.current?.handleSonglengthsPicked({
        path: '/DOCUMENTS/Songlengths.md5',
        uri: 'content://picked',
        name: 'Songlengths.md5',
      });
    });
    await act(async () => {
      await flushPromises();
    });
    expect(result.current?.songlengthsSummary.error).toMatch(/read failed/i);
  });

  it('logs persisted selection JSON parse failures', async () => {
    platformState.platform = 'android';
    platformState.native = true;
    localStorage.setItem('c64u_songlengths_file:v1', '{');

    renderUseSonglengths([]);
    await act(async () => {
      await flushPromises();
    });
    expect(addErrorLogMock).toHaveBeenCalled();
  });

  it('rejects unsupported picked file names and merges songlengths entries without duplicates', () => {
    const { result } = renderUseSonglengths([]);

    act(() => {
      result.current?.handleSonglengthsPicked({ path: '/x', uri: 'content://x', name: 'nope.bin' });
    });
    expect(toastMock).toHaveBeenCalled();

    act(() => {
      // Early return branch coverage.
      result.current?.handleSonglengthsPicked({ path: '/x', uri: '', name: 'Songlengths.md5' } as any);
    });

    const entry: SonglengthsFileEntry = {
      path: '/DOCUMENTS/Songlengths.md5',
      file: makeTextFile('/DOCUMENTS/Songlengths.md5', '; /demo.sid\nabc=0:01\n', 1),
    };
    act(() => {
      result.current?.mergeSonglengthsFiles([entry, entry]);
    });
    expect(result.current?.songlengthsFiles).toHaveLength(1);
  });
});
