import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '@/pages/HomePage';

const {
  toastSpy,
  reportUserErrorSpy,
  clearRamAndRebootSpy,
  dumpFullRamImageSpy,
  loadFullRamImageSpy,
  pickRamDumpFileSpy,
  writeRamDumpToFolderSpy,
  buildRamDumpFileNameSpy,
  selectRamDumpFolderSpy,
  saveRamDumpFolderConfigSpy,
  ramDumpFolderConfigRef,
} = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  reportUserErrorSpy: vi.fn(),
  clearRamAndRebootSpy: vi.fn(),
  dumpFullRamImageSpy: vi.fn(),
  loadFullRamImageSpy: vi.fn(),
  pickRamDumpFileSpy: vi.fn(),
  writeRamDumpToFolderSpy: vi.fn(),
  buildRamDumpFileNameSpy: vi.fn(),
  selectRamDumpFolderSpy: vi.fn(),
  saveRamDumpFolderConfigSpy: vi.fn(),
  ramDumpFolderConfigRef: {
    current: null as null | {
      treeUri: string;
      rootName?: string | null;
      selectedAt?: string | null;
    },
  },
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: {
      isConnected: true,
      isConnecting: false,
      deviceInfo: null,
    },
  }),
  useC64Drives: () => ({
    data: {
      drives: [{ a: { enabled: true } }, { b: { enabled: true } }],
    },
  }),
  useC64ConfigItems: () => ({ data: undefined }),
  useC64MachineControl: () => ({
    reset: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    reboot: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    pause: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    resume: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    powerOff: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    menuButton: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    saveConfig: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    loadConfig: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    resetConfig: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  }),
}));

vi.mock('@/hooks/useAppConfigState', () => ({
  useAppConfigState: () => ({
    appConfigs: [],
    hasChanges: false,
    isApplying: false,
    isSaving: false,
    revertToInitial: vi.fn(),
    saveCurrentConfig: vi.fn(),
    loadAppConfig: vi.fn(),
    renameAppConfig: vi.fn(),
    deleteAppConfig: vi.fn(),
  }),
}));

vi.mock('@/hooks/useActionTrace', () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: toastSpy,
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: reportUserErrorSpy,
}));

vi.mock('@/lib/c64api', () => ({
  getC64API: () => ({}),
}));

vi.mock('@/lib/machine/ramOperations', () => ({
  FULL_RAM_SIZE_BYTES: 0x10000,
  clearRamAndReboot: clearRamAndRebootSpy,
  dumpFullRamImage: dumpFullRamImageSpy,
  loadFullRamImage: loadFullRamImageSpy,
}));

vi.mock('@/lib/machine/ramDumpStorage', () => ({
  pickRamDumpFile: pickRamDumpFileSpy,
  writeRamDumpToFolder: writeRamDumpToFolderSpy,
  selectRamDumpFolder: selectRamDumpFolderSpy,
  buildRamDumpFileName: buildRamDumpFileNameSpy,
}));

vi.mock('@/lib/config/ramDumpFolderStore', () => ({
  loadRamDumpFolderConfig: () => ramDumpFolderConfigRef.current,
  saveRamDumpFolderConfig: saveRamDumpFolderConfigSpy,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('HomePage RAM actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__APP_VERSION__ = 'test';
    (globalThis as any).__GIT_SHA__ = 'deadbeef';
    (globalThis as any).__BUILD_TIME__ = '';
    clearRamAndRebootSpy.mockResolvedValue(undefined);
    dumpFullRamImageSpy.mockResolvedValue(new Uint8Array(0x10000));
    loadFullRamImageSpy.mockResolvedValue(undefined);
    ramDumpFolderConfigRef.current = null;
    selectRamDumpFolderSpy.mockResolvedValue({
      treeUri: 'content://ram-folder',
      rootName: 'RAM',
      selectedAt: '2026-02-07T00:00:00.000Z',
    });
    pickRamDumpFileSpy.mockResolvedValue({
      name: 'ram.bin',
      sizeBytes: 0x10000,
      modifiedAt: '2026-02-07T00:00:00.000Z',
      bytes: new Uint8Array(0x10000),
      parentFolder: null,
    });
    writeRamDumpToFolderSpy.mockResolvedValue(undefined);
    buildRamDumpFileNameSpy.mockReturnValue('c64u-ram-01-02-03.bin');
  });

  it('runs reboot clear memory action', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /reboot \(Clear RAM\)/i }));

    await waitFor(() => expect(clearRamAndRebootSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith({
      title: 'Machine rebooting',
      description: 'RAM cleared (excluding I/O region).',
    });
  });

  it('runs save RAM directly when RAM dump folder is already configured', async () => {
    ramDumpFolderConfigRef.current = {
      treeUri: 'content://existing-folder',
      rootName: 'Existing',
      selectedAt: '2026-02-07T00:00:00.000Z',
    };

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /save ram/i }));

    await waitFor(() => expect(dumpFullRamImageSpy).toHaveBeenCalledTimes(1));
    expect(selectRamDumpFolderSpy).not.toHaveBeenCalled();
    expect(writeRamDumpToFolderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ treeUri: 'content://existing-folder' }),
      'c64u-ram-01-02-03.bin',
      expect.any(Uint8Array),
    );
  });

  it('prompts for folder and then saves RAM when no RAM dump folder is configured', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /save ram/i }));

    await waitFor(() => expect(selectRamDumpFolderSpy).toHaveBeenCalledTimes(1));
    expect(writeRamDumpToFolderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ treeUri: 'content://ram-folder' }),
      'c64u-ram-01-02-03.bin',
      expect.any(Uint8Array),
    );
  });

  it('runs load RAM from configured folder with .bin picker', async () => {
    ramDumpFolderConfigRef.current = {
      treeUri: 'content://existing-folder',
      rootName: 'Existing',
      selectedAt: '2026-02-07T00:00:00.000Z',
    };

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /load ram/i }));

    await waitFor(() => expect(pickRamDumpFileSpy).toHaveBeenCalledTimes(1));
    expect(pickRamDumpFileSpy).toHaveBeenCalledWith({
      preferredFolder: expect.objectContaining({ treeUri: 'content://existing-folder' }),
    });
    expect(saveRamDumpFolderConfigSpy).not.toHaveBeenCalled();
    expect(loadFullRamImageSpy).toHaveBeenCalledWith({}, expect.any(Uint8Array));
  });

  it('bootstraps RAM dump folder from selected .bin parent when folder is not configured', async () => {
    pickRamDumpFileSpy.mockResolvedValue({
      name: 'ram.bin',
      sizeBytes: 0x10000,
      modifiedAt: '2026-02-07T00:00:00.000Z',
      bytes: new Uint8Array(0x10000),
      parentFolder: {
        treeUri: 'content://picked-parent',
        rootName: 'Picked Parent',
        selectedAt: '2026-02-07T00:00:00.000Z',
      },
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /load ram/i }));

    await waitFor(() => expect(pickRamDumpFileSpy).toHaveBeenCalledTimes(1));
    expect(pickRamDumpFileSpy).toHaveBeenCalledWith({ preferredFolder: undefined });
    expect(saveRamDumpFolderConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ treeUri: 'content://picked-parent' }),
    );
    expect(loadFullRamImageSpy).toHaveBeenCalledWith({}, expect.any(Uint8Array));
  });
});
