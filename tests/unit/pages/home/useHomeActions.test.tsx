import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusState = { isConnected: true };
const drivesState: { value: unknown } = { value: null };

const apiMock = {};
const pauseMutateAsyncMock = vi.fn();
const resumeMutateAsyncMock = vi.fn();
const powerOffMutateAsyncMock = vi.fn();
const controlsState = {
  pause: { mutateAsync: pauseMutateAsyncMock },
  resume: { mutateAsync: resumeMutateAsyncMock },
  powerOff: { mutateAsync: powerOffMutateAsyncMock },
};

const toastMock = vi.fn();
const reportUserErrorMock = vi.fn();
const addErrorLogMock = vi.fn();

const clearRamAndRebootMock = vi.fn();
const dumpFullRamImageMock = vi.fn();
const loadFullRamImageMock = vi.fn();

const buildRamDumpFileNameMock = vi.fn(() => 'ram-dump.bin');
const pickRamDumpFileMock = vi.fn();
const selectRamDumpFolderMock = vi.fn();
const writeRamDumpToFolderMock = vi.fn();

const loadRamDumpFolderConfigMock = vi.fn(() => null);
const saveRamDumpFolderConfigMock = vi.fn();

const resetDiskDevicesMock = vi.fn();
const resetPrinterDeviceMock = vi.fn();

vi.mock('@/lib/c64api', () => ({
  getC64API: () => apiMock,
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({ status: statusState }),
  useC64MachineControl: () => controlsState,
  useC64Drives: () => ({ data: drivesState.value }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: (...args: unknown[]) => reportUserErrorMock(...args),
}));

vi.mock('@/lib/logging', () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
}));

vi.mock('@/hooks/useActionTrace', () => ({
  useActionTrace: () => {
    const trace = <T extends (...args: never[]) => unknown>(fn: T) => fn;
    trace.scope = async (_name: string, fn: () => Promise<unknown>) => fn();
    return trace;
  },
}));

vi.mock('@/lib/machine/ramOperations', () => ({
  FULL_RAM_SIZE_BYTES: 1024,
  clearRamAndReboot: (...args: unknown[]) => clearRamAndRebootMock(...args),
  dumpFullRamImage: (...args: unknown[]) => dumpFullRamImageMock(...args),
  loadFullRamImage: (...args: unknown[]) => loadFullRamImageMock(...args),
}));

vi.mock('@/lib/machine/ramDumpStorage', () => ({
  buildRamDumpFileName: (...args: unknown[]) =>
    buildRamDumpFileNameMock(...args),
  pickRamDumpFile: (...args: unknown[]) => pickRamDumpFileMock(...args),
  selectRamDumpFolder: (...args: unknown[]) => selectRamDumpFolderMock(...args),
  writeRamDumpToFolder: (...args: unknown[]) =>
    writeRamDumpToFolderMock(...args),
}));

vi.mock('@/lib/config/ramDumpFolderStore', () => ({
  loadRamDumpFolderConfig: () => loadRamDumpFolderConfigMock(),
  saveRamDumpFolderConfig: (...args: unknown[]) =>
    saveRamDumpFolderConfigMock(...args),
}));

vi.mock('@/lib/disks/resetDrives', () => ({
  resetDiskDevices: (...args: unknown[]) => resetDiskDevicesMock(...args),
  resetPrinterDevice: (...args: unknown[]) => resetPrinterDeviceMock(...args),
}));

import { useHomeActions } from '@/pages/home/hooks/useHomeActions';

describe('useHomeActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusState.isConnected = true;
    drivesState.value = null;
    pauseMutateAsyncMock.mockResolvedValue(undefined);
    resumeMutateAsyncMock.mockResolvedValue(undefined);
    powerOffMutateAsyncMock.mockResolvedValue(undefined);
    clearRamAndRebootMock.mockResolvedValue(undefined);
    dumpFullRamImageMock.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    loadFullRamImageMock.mockResolvedValue(undefined);
    selectRamDumpFolderMock.mockResolvedValue({
      treeUri: 'content://tree/music',
      rootName: 'Music',
    });
    pickRamDumpFileMock.mockResolvedValue({
      bytes: new Uint8Array(1024),
      parentFolder: { treeUri: 'content://tree/music', rootName: 'Music' },
    });
    writeRamDumpToFolderMock.mockResolvedValue(undefined);
    resetDiskDevicesMock.mockResolvedValue(undefined);
    resetPrinterDeviceMock.mockResolvedValue(undefined);
  });

  it('pauses and resumes machine execution when connected', async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });
    expect(pauseMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.machineExecutionState).toBe('paused');

    await act(async () => {
      await result.current.handlePauseResume();
    });
    expect(resumeMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.machineExecutionState).toBe('running');
  });

  it('reports pause/resume failures and clears pending state', async () => {
    pauseMutateAsyncMock.mockRejectedValueOnce(new Error('pause failed'));
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });

    expect(addErrorLogMock).toHaveBeenCalledWith(
      'Machine pause/resume failed',
      expect.objectContaining({
        targetState: 'paused',
        error: 'pause failed',
      }),
    );
    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'HOME_MACHINE_PAUSE_RESUME',
        title: 'Machine action failed',
      }),
    );
    expect(result.current.pauseResumePending).toBe(false);
  });

  it('saves RAM by selecting folder, dumping image, and writing file', async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam();
    });

    expect(selectRamDumpFolderMock).toHaveBeenCalledTimes(1);
    expect(dumpFullRamImageMock).toHaveBeenCalledWith(apiMock);
    expect(buildRamDumpFileNameMock).toHaveBeenCalledTimes(1);
    expect(writeRamDumpToFolderMock).toHaveBeenCalledWith(
      expect.objectContaining({ rootName: 'Music' }),
      'ram-dump.bin',
      expect.any(Uint8Array),
    );
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'RAM dump saved' }),
    );
  });

  it('validates RAM dump size and reports load errors', async () => {
    pickRamDumpFileMock.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      parentFolder: { treeUri: 'content://tree/music', rootName: 'Music' },
    });
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleLoadRam();
    });

    expect(saveRamDumpFolderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ rootName: 'Music' }),
    );
    expect(loadFullRamImageMock).not.toHaveBeenCalled();
    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'HOME_MACHINE_LOAD_RAM',
        title: 'Machine action failed',
      }),
    );
  });

  it('runs power-off confirmation flow through handleAction', async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePowerOff();
    });
    expect(result.current.powerOffDialogOpen).toBe(true);

    await act(async () => {
      await result.current.confirmPowerOff();
    });

    expect(result.current.powerOffDialogOpen).toBe(false);
    expect(powerOffMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({ title: 'Powering off...' });
  });

  it('reports folder selection failures and clears task pending flag', async () => {
    selectRamDumpFolderMock.mockRejectedValueOnce(
      new Error('picker unavailable'),
    );
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSelectRamDumpFolder();
    });

    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'RAM_DUMP_FOLDER_SELECT',
        title: 'Folder selection failed',
      }),
    );
    expect(result.current.folderTaskPending).toBe(false);
  });

  it('resets drives and printer, then refreshes drive data', async () => {
    drivesState.value = { drive_a: { id: 1 } };
    const refreshDrivesFromDevice = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleResetDrives(refreshDrivesFromDevice);
      await result.current.handleResetPrinter(refreshDrivesFromDevice);
    });

    expect(resetDiskDevicesMock).toHaveBeenCalledWith(
      apiMock,
      drivesState.value,
    );
    expect(resetPrinterDeviceMock).toHaveBeenCalledWith(
      apiMock,
      drivesState.value,
    );
    expect(refreshDrivesFromDevice).toHaveBeenCalledTimes(2);
  });

  it('skips machine tasks when disconnected', async () => {
    statusState.isConnected = false;
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleRebootClearMemory();
    });

    expect(clearRamAndRebootMock).not.toHaveBeenCalled();
  });
});
