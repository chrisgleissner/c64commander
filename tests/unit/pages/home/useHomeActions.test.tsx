import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const loadMemoryRangesMock = vi.fn();
const selectRamDumpFolderMock = vi.fn();

const createSnapshotMock = vi.fn();
const deleteSnapshotFromStoreMock = vi.fn();
const updateSnapshotLabelMock = vi.fn();
const snapshotEntryToBytesMock = vi.fn();
const decodeSnapshotMock = vi.fn();
const getCurrentPlaybackSnapshotLabelMock = vi.fn();

const resetDiskDevicesMock = vi.fn();
const resetPrinterDeviceMock = vi.fn();

vi.mock("@/lib/c64api", () => ({
  getC64API: () => apiMock,
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: statusState }),
  useC64MachineControl: () => controlsState,
  useC64Drives: () => ({ data: drivesState.value }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: (...args: unknown[]) => reportUserErrorMock(...args),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => {
    const trace = <T extends (...args: never[]) => unknown>(fn: T) => fn;
    trace.scope = async (_name: string, fn: () => Promise<unknown>) => fn();
    return trace;
  },
}));

vi.mock("@/lib/machine/ramOperations", () => ({
  FULL_RAM_SIZE_BYTES: 1024,
  clearRamAndReboot: (...args: unknown[]) => clearRamAndRebootMock(...args),
  loadMemoryRanges: (...args: unknown[]) => loadMemoryRangesMock(...args),
}));

vi.mock("@/lib/machine/ramDumpStorage", () => ({
  selectRamDumpFolder: (...args: unknown[]) => selectRamDumpFolderMock(...args),
}));

vi.mock("@/lib/config/ramDumpFolderStore", () => ({
  loadRamDumpFolderConfig: () => null,
  saveRamDumpFolderConfig: vi.fn(),
}));

vi.mock("@/lib/snapshot/snapshotCreation", () => ({
  createSnapshot: (...args: unknown[]) => createSnapshotMock(...args),
}));

vi.mock("@/lib/snapshot/snapshotStore", () => ({
  useSnapshotStore: () => ({ snapshots: [], snapshotsByType: vi.fn().mockReturnValue([]) }),
  deleteSnapshotFromStore: (...args: unknown[]) => deleteSnapshotFromStoreMock(...args),
  updateSnapshotLabel: (...args: unknown[]) => updateSnapshotLabelMock(...args),
  snapshotEntryToBytes: (...args: unknown[]) => snapshotEntryToBytesMock(...args),
  saveSnapshotToStore: vi.fn(),
  loadSnapshotStore: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/snapshot/snapshotFormat", () => ({
  decodeSnapshot: (...args: unknown[]) => decodeSnapshotMock(...args),
}));

vi.mock("@/lib/disks/resetDrives", () => ({
  resetDiskDevices: (...args: unknown[]) => resetDiskDevicesMock(...args),
  resetPrinterDevice: (...args: unknown[]) => resetPrinterDeviceMock(...args),
}));

vi.mock("@/lib/snapshot/currentPlaybackSnapshotLabel", () => ({
  getCurrentPlaybackSnapshotLabel: (...args: unknown[]) => getCurrentPlaybackSnapshotLabelMock(...args),
}));

import { useHomeActions } from "@/pages/home/hooks/useHomeActions";
import type { SnapshotStorageEntry } from "@/lib/snapshot/snapshotTypes";

describe("useHomeActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusState.isConnected = true;
    drivesState.value = null;
    pauseMutateAsyncMock.mockResolvedValue(undefined);
    resumeMutateAsyncMock.mockResolvedValue(undefined);
    powerOffMutateAsyncMock.mockResolvedValue(undefined);
    clearRamAndRebootMock.mockResolvedValue(undefined);
    createSnapshotMock.mockResolvedValue({ displayTimestamp: "2026-01-01 12:00:00" });
    getCurrentPlaybackSnapshotLabelMock.mockReturnValue(undefined);
    loadMemoryRangesMock.mockResolvedValue(undefined);
    snapshotEntryToBytesMock.mockReturnValue(new Uint8Array(100));
    decodeSnapshotMock.mockReturnValue({
      version: 1,
      snapshotType: "program",
      timestamp: 0,
      ranges: [{ start: 0, length: 100 }],
      blocks: [new Uint8Array(100)],
      metadata: { snapshot_type: "program", display_ranges: [], created_at: "" },
    });
    selectRamDumpFolderMock.mockResolvedValue({
      treeUri: "content://tree/music",
      rootName: "Music",
    });
    resetDiskDevicesMock.mockResolvedValue(undefined);
    resetPrinterDeviceMock.mockResolvedValue(undefined);
  });

  it("pauses and resumes machine execution when connected", async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });
    expect(pauseMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.machineExecutionState).toBe("paused");

    await act(async () => {
      await result.current.handlePauseResume();
    });
    expect(resumeMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.machineExecutionState).toBe("running");
  });

  it("reports pause/resume failures and clears pending state", async () => {
    pauseMutateAsyncMock.mockRejectedValueOnce(new Error("pause failed"));
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });

    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Machine pause/resume failed",
      expect.objectContaining({
        targetState: "paused",
        error: "pause failed",
      }),
    );
    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HOME_MACHINE_PAUSE_RESUME",
        title: "Machine action failed",
      }),
    );
    expect(result.current.pauseResumePending).toBe(false);
  });

  it("saves program snapshot and shows success toast", async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam("program");
    });

    expect(createSnapshotMock).toHaveBeenCalledWith(apiMock, {
      type: "program",
      customRanges: undefined,
      label: undefined,
      contentName: undefined,
    });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Snapshot saved" }));
  });

  it("uses the current playback item as the default snapshot comment", async () => {
    getCurrentPlaybackSnapshotLabelMock.mockReturnValue("Katakis.d64");
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam("program");
    });

    expect(createSnapshotMock).toHaveBeenCalledWith(apiMock, {
      type: "program",
      customRanges: undefined,
      label: "Katakis.d64",
      contentName: "Katakis.d64",
    });
  });

  it("restores snapshot ranges to memory and shows success toast", async () => {
    const snapshot: SnapshotStorageEntry = {
      id: "snap-1",
      filename: "c64-program-20260101-120000.c64snap",
      bytesBase64: "",
      createdAt: "2026-01-01T12:00:00.000Z",
      snapshotType: "program",
      metadata: {
        snapshot_type: "program",
        display_ranges: ["$0000\u2013$00FF", "$0200\u2013$FFFF"],
        created_at: "2026-01-01 12:00:00",
      },
    };

    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleRestoreSnapshot(snapshot);
    });

    expect(snapshotEntryToBytesMock).toHaveBeenCalledWith(snapshot);
    expect(decodeSnapshotMock).toHaveBeenCalled();
    expect(loadMemoryRangesMock).toHaveBeenCalledWith(apiMock, [{ start: 0, bytes: expect.any(Uint8Array) }]);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Snapshot restored" }));
  });

  it("runs power-off confirmation flow through handleAction", async () => {
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
    expect(toastMock).toHaveBeenCalledWith({ title: "Powering off..." });
  });

  it("reports folder selection failures and clears task pending flag", async () => {
    selectRamDumpFolderMock.mockRejectedValueOnce(new Error("picker unavailable"));
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSelectRamDumpFolder();
    });

    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "RAM_DUMP_FOLDER_SELECT",
        title: "Folder selection failed",
      }),
    );
    expect(result.current.folderTaskPending).toBe(false);
  });

  it("resets drives and printer, then refreshes drive data", async () => {
    drivesState.value = { drive_a: { id: 1 } };
    const refreshDrivesFromDevice = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleResetDrives(refreshDrivesFromDevice);
      await result.current.handleResetPrinter(refreshDrivesFromDevice);
    });

    expect(resetDiskDevicesMock).toHaveBeenCalledWith(apiMock, drivesState.value);
    expect(resetPrinterDeviceMock).toHaveBeenCalledWith(apiMock, drivesState.value);
    expect(refreshDrivesFromDevice).toHaveBeenCalledTimes(2);
  });

  it("skips machine tasks when disconnected", async () => {
    statusState.isConnected = false;
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleRebootClearMemory();
    });

    expect(clearRamAndRebootMock).not.toHaveBeenCalled();
  });

  it("handlePauseResume returns early when disconnected (line 130)", async () => {
    statusState.isConnected = false;
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });

    expect(pauseMutateAsyncMock).not.toHaveBeenCalled();
  });

  it("handleSelectRamDumpFolder uses fallback description when rootName is null (line 99)", async () => {
    selectRamDumpFolderMock.mockResolvedValue({ treeUri: "content://tree/", rootName: null });
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSelectRamDumpFolder();
    });

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: "Folder access granted" }));
  });

  it("runMachineTask catch branch fires when action throws (line 65)", async () => {
    createSnapshotMock.mockRejectedValueOnce(new Error("snapshot failed"));
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam("program");
    });

    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HOME_MACHINE_SAVE_RAM",
        title: "Machine action failed",
      }),
    );
  });

  it("handleResetDrives and handleResetPrinter pass null when drivesData is null (lines 213, 225)", async () => {
    const refreshDrivesFromDevice = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleResetDrives(refreshDrivesFromDevice);
      await result.current.handleResetPrinter(refreshDrivesFromDevice);
    });

    expect(resetDiskDevicesMock).toHaveBeenCalledWith(apiMock, null);
    expect(resetPrinterDeviceMock).toHaveBeenCalledWith(apiMock, null);
  });

  it("updates a snapshot comment in the store", () => {
    const { result } = renderHook(() => useHomeActions());
    result.current.handleUpdateSnapshotLabel("snap-1", "Updated note");
    expect(updateSnapshotLabelMock).toHaveBeenCalledWith("snap-1", "Updated note");
  });
});
