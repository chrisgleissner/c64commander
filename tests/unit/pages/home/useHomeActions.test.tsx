import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const statusState = { isConnected: true };
const drivesState: { value: unknown } = { value: null };

const getDrivesMock = vi.fn();
const apiMock = { getDrives: getDrivesMock };
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
const createCpuSnapshotMock = vi.fn();
const restoreCpuSnapshotFromDecodedMock = vi.fn();
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
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
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
  createCpuSnapshot: (...args: unknown[]) => createCpuSnapshotMock(...args),
  CpuSnapshotUnsupportedError: class CpuSnapshotUnsupportedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CpuSnapshotUnsupportedError";
    }
  },
}));

vi.mock("@/lib/snapshot/cpu/cpuSnapshot", () => ({
  restoreCpuSnapshotFromDecoded: (...args: unknown[]) => restoreCpuSnapshotFromDecodedMock(...args),
}));

vi.mock("@/lib/snapshot/cpu/captureEngine", () => ({
  CpuCaptureFailedError: class CpuCaptureFailedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CpuCaptureFailedError";
    }
  },
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
    createCpuSnapshotMock.mockResolvedValue({
      displayTimestamp: "2026-01-01 12:00:00",
      cpu: { pc: 0xc000, a: 0, x: 0, y: 0, sp: 0xf6, p: 0x30 },
      captureMethod: "rli",
      resumeError: null,
    });
    restoreCpuSnapshotFromDecodedMock.mockResolvedValue({ ok: true, rtiFrameAddress: 0x01f4 });
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
    getDrivesMock.mockResolvedValue({ drives: [] });
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

  it("resets drives and printer from cached drive data, then refreshes drive data", async () => {
    drivesState.value = { drives: [{ a: { enabled: true } }] };
    const refreshDrivesFromDevice = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleResetDrives(refreshDrivesFromDevice);
      await result.current.handleResetPrinter(refreshDrivesFromDevice);
    });

    // Drive data is already cached, so reset must not issue an extra /v1/drives fetch.
    expect(getDrivesMock).not.toHaveBeenCalled();
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

  it("fetches fresh drive data before reset when the cache has not populated yet", async () => {
    // Reproduces the race fixed on fix/reset-drives: the reset button is enabled on
    // connection, before the /v1/drives poll resolves, so drivesData is still empty.
    drivesState.value = null;
    const freshDrives = { drives: [{ a: { enabled: true } }] };
    // The cache is empty, so handleResetDrives must fetch fresh device state via
    // api.getDrives() before resetting. Without this mock, getDrives() resolves to
    // undefined and resetDiskDevices is never reached (regression introduced by an
    // overzealous autofix that dropped this line).
    getDrivesMock.mockResolvedValue(freshDrives);
    const refreshDrivesFromDevice = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleResetDrives(refreshDrivesFromDevice);
      await result.current.handleResetPrinter(refreshDrivesFromDevice);
    });

    expect(getDrivesMock).toHaveBeenCalledWith({ __c64uIntent: "user" });
    expect(resetDiskDevicesMock).toHaveBeenCalledWith(apiMock, freshDrives);
    expect(resetPrinterDeviceMock).toHaveBeenCalledWith(apiMock, freshDrives);
    expect(reportUserErrorMock).not.toHaveBeenCalled();
  });

  it("updates a snapshot comment in the store", () => {
    const { result } = renderHook(() => useHomeActions());
    result.current.handleUpdateSnapshotLabel("snap-1", "Updated note");
    expect(updateSnapshotLabelMock).toHaveBeenCalledWith("snap-1", "Updated note");
  });

  describe("handleSaveCpuSnapshot", () => {
    it("captures a CPU+RAM snapshot and toasts the resume PC", async () => {
      getCurrentPlaybackSnapshotLabelMock.mockReturnValue("Boss.prg");
      const { result } = renderHook(() => useHomeActions());

      await act(async () => {
        await result.current.handleSaveCpuSnapshot();
      });

      expect(createCpuSnapshotMock).toHaveBeenCalledWith(apiMock, {
        label: "Boss.prg",
        contentName: "Boss.prg",
      });
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "CPU + RAM snapshot saved",
          description: expect.stringContaining("PC $C000"),
        }),
      );
    });

    it("warns the user the machine may still be frozen when resume fails after a clean capture (HARD9-035)", async () => {
      createCpuSnapshotMock.mockResolvedValueOnce({
        displayTimestamp: "2026-01-01 12:00:00",
        cpu: { pc: 0xc000, a: 0, x: 0, y: 0, sp: 0xf6, p: 0x30 },
        captureMethod: "rli",
        resumeError: new Error("machine resume write failed"),
      });
      const { result } = renderHook(() => useHomeActions());

      await act(async () => {
        await result.current.handleSaveCpuSnapshot();
      });

      // The snapshot still saved (createCpuSnapshot resolved) - this must
      // not be reported as an operation failure, but the user still needs
      // to know the machine likely needs a manual Restore/reset.
      expect(reportUserErrorMock).not.toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("may still be frozen"),
          description: expect.stringContaining("machine resume write failed"),
          variant: "destructive",
        }),
      );
    });

    it("degrades with an actionable message when the program protects its interrupts", async () => {
      const { CpuCaptureFailedError } = await import("@/lib/snapshot/cpu/captureEngine");
      createCpuSnapshotMock.mockRejectedValueOnce(new CpuCaptureFailedError("no rideable interrupt"));
      const { result } = renderHook(() => useHomeActions());

      await act(async () => {
        await result.current.handleSaveCpuSnapshot();
      });

      expect(reportUserErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "HOME_MACHINE_SAVE_CPU",
          description: expect.stringContaining("Use a Program or Basic RAM snapshot instead"),
        }),
      );
    });

    it("degrades the same way when the device does not support CPU snapshots", async () => {
      const { CpuSnapshotUnsupportedError } = await import("@/lib/snapshot/snapshotCreation");
      createCpuSnapshotMock.mockRejectedValueOnce(new CpuSnapshotUnsupportedError("firmware too old"));
      const { result } = renderHook(() => useHomeActions());

      await act(async () => {
        await result.current.handleSaveCpuSnapshot();
      });

      expect(reportUserErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "HOME_MACHINE_SAVE_CPU",
          description: expect.stringContaining("Use a Program or Basic RAM snapshot instead"),
        }),
      );
    });

    it("rethrows an unexpected (non-capture) error unchanged", async () => {
      createCpuSnapshotMock.mockRejectedValueOnce(new Error("disk full"));
      const { result } = renderHook(() => useHomeActions());

      await act(async () => {
        await result.current.handleSaveCpuSnapshot();
      });

      expect(reportUserErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "HOME_MACHINE_SAVE_CPU", description: "disk full" }),
      );
    });
  });

  it("routes a CPU-state snapshot restore through the uploaded-cartridge path", async () => {
    decodeSnapshotMock.mockReturnValue({
      version: 2,
      snapshotType: "program",
      timestamp: 0,
      ranges: [{ start: 0, length: 100 }],
      blocks: [new Uint8Array(100)],
      metadata: {
        snapshot_type: "program",
        display_ranges: [],
        created_at: "",
        cpu_state_captured: true,
        cpu: { pc: 0xc000, a: 0, x: 0, y: 0, sp: 0xf6, p: 0x30, flags: {} },
      },
    });
    const snapshot: SnapshotStorageEntry = {
      id: "snap-cpu",
      filename: "c64-program.c64snap",
      bytesBase64: "",
      createdAt: "2026-01-01T12:00:00.000Z",
      snapshotType: "program",
      metadata: { snapshot_type: "program", display_ranges: [], created_at: "2026-01-01 12:00:00" },
    };

    const { result } = renderHook(() => useHomeActions());
    await act(async () => {
      await result.current.handleRestoreSnapshot(snapshot);
    });

    expect(restoreCpuSnapshotFromDecodedMock).toHaveBeenCalledWith(apiMock, expect.objectContaining({ version: 2 }));
    // The CPU path returns early — the RAM-range loader must not run.
    expect(loadMemoryRangesMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Snapshot restored" }));
  });
});
