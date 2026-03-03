/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const pickerMocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  listChildren: vi.fn(),
  getPersistedUris: vi.fn(),
  readFile: vi.fn(),
  readFileFromTree: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    pickDirectory: pickerMocks.pickDirectory,
    listChildren: pickerMocks.listChildren,
    getPersistedUris: pickerMocks.getPersistedUris,
    readFile: pickerMocks.readFile,
    readFileFromTree: pickerMocks.readFileFromTree,
  }),
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
  },
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: vi.fn(() => 'web'),
  isNativePlatform: vi.fn(() => false),
}));

import { FolderPicker } from '@/lib/native/folderPicker';
import { getPlatform } from '@/lib/native/platform';

describe('FolderPicker overrides', () => {
  beforeEach(() => {
    pickerMocks.pickDirectory.mockReset();
    pickerMocks.listChildren.mockReset();
    pickerMocks.getPersistedUris.mockReset();
    pickerMocks.readFile.mockReset();
    pickerMocks.readFileFromTree.mockReset();
    (import.meta as ImportMeta & { env?: Record<string, string> }).env = {
      ...(import.meta as ImportMeta & { env?: Record<string, string> }).env,
      VITE_ENABLE_TEST_PROBES: '1',
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = undefined;
    (window as Window & { __c64uAllowAndroidFolderPickerOverride?: boolean }).__c64uAllowAndroidFolderPickerOverride = undefined;
    vi.mocked(getPlatform).mockReturnValue('web');
  });

  it('uses override when provided on non-android platforms', async () => {
    const override = {
      pickDirectory: vi.fn(async () => ({ files: [{ uri: 'demo', name: 'demo', path: '/demo' }] })),
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    const result = await FolderPicker.pickDirectory({ extensions: ['sid'] });

    expect(override.pickDirectory).toHaveBeenCalledWith({
      extensions: ['sid'],
      traceContext: {
        correlationId: null,
        playlistItemId: null,
        trackInstanceId: null,
      },
    });
    expect(result.files?.[0].name).toBe('demo');
    expect(pickerMocks.pickDirectory).not.toHaveBeenCalled();
  });

  it('falls back to plugin when no override is set', async () => {
    pickerMocks.readFile.mockResolvedValue({ data: 'demo' });
    pickerMocks.readFileFromTree.mockResolvedValue({ data: 'tree-demo' });
    pickerMocks.listChildren.mockResolvedValue({ entries: [] });

    await FolderPicker.readFile({ uri: 'content://demo' });
    await FolderPicker.readFileFromTree({ treeUri: 'content://tree', path: 'demo.sid' });
    await FolderPicker.listChildren({ treeUri: 'content://tree' });

    expect(pickerMocks.readFile).toHaveBeenCalledWith({
      uri: 'content://demo',
      traceContext: {
        correlationId: null,
        playlistItemId: null,
        trackInstanceId: null,
      },
    });
    expect(pickerMocks.readFileFromTree).toHaveBeenCalledWith({
      treeUri: 'content://tree',
      path: 'demo.sid',
      traceContext: {
        correlationId: null,
        playlistItemId: null,
        trackInstanceId: null,
      },
    });
    expect(pickerMocks.listChildren).toHaveBeenCalledWith({
      treeUri: 'content://tree',
      traceContext: {
        correlationId: null,
        playlistItemId: null,
        trackInstanceId: null,
      },
    });
  });

  it('blocks overrides on android unless explicitly allowed', async () => {
    vi.mocked(getPlatform).mockReturnValue('android');
    const override = { listChildren: vi.fn(async () => ({ entries: [] })) };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    expect(() => FolderPicker.listChildren({ treeUri: 'content://demo' })).toThrow(
      'Android SAF picker is required.',
    );
    expect(override.listChildren).not.toHaveBeenCalled();
  });

  it('uses override for pickFile when provided', async () => {
    const override = {
      pickFile: vi.fn(async () => ({ uri: 'content://file.sid', name: 'file.sid', sizeBytes: 0 })),
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    const result = await FolderPicker.pickFile({ extensions: ['sid'] });
    expect(override.pickFile).toHaveBeenCalled();
    expect(result.uri).toBe('content://file.sid');
    expect(pickerMocks.pickDirectory).not.toHaveBeenCalled();
  });

  it('uses override for getPersistedUris when provided', async () => {
    const override = {
      getPersistedUris: vi.fn(async () => ({ uris: ['content://uri1'] })),
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    const result = await FolderPicker.getPersistedUris({});
    expect(override.getPersistedUris).toHaveBeenCalled();
    expect(result.uris).toEqual(['content://uri1']);
  });

  it('uses override for readFile when provided', async () => {
    const override = {
      readFile: vi.fn(async () => ({ data: 'SGVsbG8=' })),
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    const result = await FolderPicker.readFile({ uri: 'content://demo.sid' });
    expect(override.readFile).toHaveBeenCalled();
    expect(result.data).toBe('SGVsbG8=');
    expect(pickerMocks.readFile).not.toHaveBeenCalled();
  });

  it('uses override for readFileFromTree when provided', async () => {
    const override = {
      readFileFromTree: vi.fn(async () => ({ data: 'dHJlZQ==' })),
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    const result = await FolderPicker.readFileFromTree({ treeUri: 'content://tree', path: 'demo.sid' });
    expect(override.readFileFromTree).toHaveBeenCalled();
    expect(result.data).toBe('dHJlZQ==');
    expect(pickerMocks.readFileFromTree).not.toHaveBeenCalled();
  });

  it('uses override for listChildren when provided', async () => {
    const override = {
      listChildren: vi.fn(async () => ({ entries: [{ type: 'file', name: 'a.sid', path: '/a.sid' }] })),
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    const result = await FolderPicker.listChildren({ treeUri: 'content://tree' });
    expect(override.listChildren).toHaveBeenCalled();
    expect(result.entries).toHaveLength(1);
    expect(pickerMocks.listChildren).not.toHaveBeenCalled();
  });

  it('uses override for writeFileToTree when provided', async () => {
    const override = {
      writeFileToTree: vi.fn(async () => ({ uri: 'content://out.bin', sizeBytes: 4 })),
    };
    (window as Window & { __c64uFolderPickerOverride?: unknown }).__c64uFolderPickerOverride = override;

    const result = await FolderPicker.writeFileToTree({ treeUri: 'content://tree', path: '/out.bin', data: 'AAAA', mimeType: 'application/octet-stream', overwrite: true });
    expect(override.writeFileToTree).toHaveBeenCalled();
    expect(result.uri).toBe('content://out.bin');
  });
});
