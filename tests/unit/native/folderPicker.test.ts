/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
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

    expect(override.pickDirectory).toHaveBeenCalledWith({ extensions: ['sid'] });
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

    expect(pickerMocks.readFile).toHaveBeenCalledWith({ uri: 'content://demo' });
    expect(pickerMocks.readFileFromTree).toHaveBeenCalledWith({ treeUri: 'content://tree', path: 'demo.sid' });
    expect(pickerMocks.listChildren).toHaveBeenCalledWith({ treeUri: 'content://tree' });
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
});
