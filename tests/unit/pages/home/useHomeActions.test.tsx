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

// HARD12-020: Home's pause/resume must read/write the shared machine-execution
// store (written by both Play and Home) instead of page-local state that
// always assumed "running" on mount. This fake models the store's real
// subscribe/getSnapshot/setters contract closely enough for useSyncExternalStore.
type FakeMachineExecutionSnapshot = { state: "running" | "paused"; pauseMutePending: boolean };
let machineExecutionSnapshot: FakeMachineExecutionSnapshot = { state: "running", pauseMutePending: false };
const machineExecutionListeners = new Set<() => void>();
const setMachineExecutionPausedMock = vi.fn((options?: { pauseMutePending?: boolean }) => {
  machineExecutionSnapshot = { state: "paused", pauseMutePending: Boolean(options?.pauseMutePending) };
  machineExecutionListeners.forEach((listener) => listener());
});
const setMachineExecutionRunningMock = vi.fn(() => {
  machineExecutionSnapshot = { state: "running", pauseMutePending: false };
  machineExecutionListeners.forEach((listener) => listener());
});
const restorePauseMuteFromPersistedSnapshotMock = vi.fn(async () => true);

vi.mock("@/lib/deviceInteraction/machineExecutionStore", () => ({
  getMachineExecutionSnapshot: () => machineExecutionSnapshot,
  subscribeMachineExecution: (listener: () => void) => {
    machineExecutionListeners.add(listener);
    return () => machineExecutionListeners.delete(listener);
  },
  setMachineExecutionPaused: (options?: { pauseMutePending?: boolean }) => setMachineExecutionPausedMock(options),
  setMachineExecutionRunning: () => setMachineExecutionRunningMock(),
  restorePauseMuteFromPersistedSnapshot: (...args: unknown[]) => restorePauseMuteFromPersistedSnapshotMock(...args),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  getSelectedSavedDevice: () => ({ id: "device-a" }),
}));

const publishMachineTakeoverMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/deviceInteraction/machineTakeoverEvent", () => ({
  publishMachineTakeover: (...args: unknown[]) => publishMachineTakeoverMock(...args),
}));

const capturePauseMuteToPersistedSnapshotMock = vi.fn(async () => false);
vi.mock("@/lib/deviceInteraction/pauseMuteCapture", () => ({
  capturePauseMuteToPersistedSnapshot: (...args: unknown[]) => capturePauseMuteToPersistedSnapshotMock(...args),
}));

import { useHomeActions } from "@/pages/home/hooks/useHomeActions";
import type { SnapshotStorageEntry } from "@/lib/snapshot/snapshotTypes";
import { CpuRestoreUnsupportedError } from "@/lib/snapshot/cpu/restoreCart";

describe("useHomeActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    machineExecutionSnapshot = { state: "running", pauseMutePending: false };
    restorePauseMuteFromPersistedSnapshotMock.mockResolvedValue(true);
    capturePauseMuteToPersistedSnapshotMock.mockResolvedValue(false);
    statusState.isConnected = true;
    drivesState.value = null;
    pauseMutateAsyncMock.mockResolvedValue(undefined);
    resumeMutateAsyncMock.mockResolvedValue(undefined);
    powerOffMutateAsyncMock.mockResolvedValue(undefined);
    clearRamAndRebootMock.mockResolvedValue(undefined);
    createSnapshotMock.mockResolvedValue({ displayTimestamp: "2026-01-01 12:00:00", evictedSnapshotLabel: null });
    createCpuSnapshotMock.mockResolvedValue({
      displayTimestamp: "2026-01-01 12:00:00",
      cpu: { pc: 0xc000, a: 0, x: 0, y: 0, sp: 0xf6, p: 0x30 },
      captureMethod: "rli",
      resumeError: null,
      evictedSnapshotLabel: null,
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

  it("mutes the SID mixer before pausing and records pauseMutePending (HARD19-010)", async () => {
    capturePauseMuteToPersistedSnapshotMock.mockResolvedValue(true);
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });

    expect(capturePauseMuteToPersistedSnapshotMock).toHaveBeenCalledTimes(1);
    expect(pauseMutateAsyncMock).toHaveBeenCalledTimes(1);
    // Mute happened before the machine pause.
    const captureOrder = capturePauseMuteToPersistedSnapshotMock.mock.invocationCallOrder[0];
    const pauseOrder = pauseMutateAsyncMock.mock.invocationCallOrder[0];
    expect(captureOrder).toBeLessThan(pauseOrder);
    expect(setMachineExecutionPausedMock).toHaveBeenCalledWith({ pauseMutePending: true });
  });

  it("rolls back the SID mute when the machine pause fails (HARD19-010)", async () => {
    capturePauseMuteToPersistedSnapshotMock.mockResolvedValue(true);
    pauseMutateAsyncMock.mockRejectedValueOnce(new Error("pause failed"));
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });

    // A failed pause must not leave a running machine silent: unmute is restored.
    expect(restorePauseMuteFromPersistedSnapshotMock).toHaveBeenCalledTimes(1);
    expect(setMachineExecutionPausedMock).not.toHaveBeenCalled();
    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "HOME_MACHINE_PAUSE_RESUME" }),
    );
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
      alreadyPaused: false,
    });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Snapshot saved" }));
  });

  it("warns when saving evicts the oldest snapshot to stay within the library cap (HARD9-069)", async () => {
    createSnapshotMock.mockResolvedValueOnce({
      displayTimestamp: "2026-01-01 12:00:00",
      evictedSnapshotLabel: "Boss fight",
    });
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam("program");
    });

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Snapshot saved" }));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Oldest snapshot removed",
        description: expect.stringContaining("Boss fight"),
        variant: "destructive",
      }),
    );
  });

  it("does not warn about eviction when the library is under the cap", async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam("program");
    });

    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Oldest snapshot removed" }));
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
      alreadyPaused: false,
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
    expect(loadMemoryRangesMock).toHaveBeenCalledWith(apiMock, [{ start: 0, bytes: expect.any(Uint8Array) }], {
      alreadyPaused: false,
    });
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

  it("publishes the machine takeover after a successful power off (HARD19-031)", async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.confirmPowerOff();
      await Promise.resolve();
    });

    expect(powerOffMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(publishMachineTakeoverMock).toHaveBeenCalledWith({ reason: "home-reset", label: "Power off" });
  });

  it("does not publish the machine takeover when the power off fails (HARD19-031 success-gated)", async () => {
    powerOffMutateAsyncMock.mockRejectedValueOnce(new Error("power off failed"));
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.confirmPowerOff();
      await Promise.resolve();
    });

    expect(publishMachineTakeoverMock).not.toHaveBeenCalled();
  });

  it("publishes the machine takeover after a successful snapshot restore (HARD19-011)", async () => {
    const snapshot: SnapshotStorageEntry = {
      id: "snap-restore",
      filename: "c64-program-20260101-120000.c64snap",
      bytesBase64: "",
      createdAt: "2026-01-01T12:00:00.000Z",
      snapshotType: "program",
      metadata: {
        snapshot_type: "program",
        display_ranges: ["$0000–$00FF"],
        created_at: "2026-01-01 12:00:00",
        label: "Boulder Dash",
      },
    };
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleRestoreSnapshot(snapshot);
      await Promise.resolve();
    });

    expect(publishMachineTakeoverMock).toHaveBeenCalledWith({ reason: "home-reset", label: "Boulder Dash" });
  });

  it("restores a pending pause-mute on a reset-family reboot so a reboot-while-paused is not left muted (HARD19-032)", async () => {
    // The user paused SID playback from Play (muting the mixer, pauseMutePending)
    // then reboots from Home instead of resuming.
    machineExecutionSnapshot = { state: "paused", pauseMutePending: true };
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleRebootClearMemory();
      await Promise.resolve();
    });

    // A reboot always ends running, so the muted mixer must be restored rather
    // than stranded silent; the takeover still fires.
    expect(restorePauseMuteFromPersistedSnapshotMock).toHaveBeenCalledTimes(1);
    expect(publishMachineTakeoverMock).toHaveBeenCalledWith({ reason: "home-reset", label: "Reboot (Clr Mem)" });
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

  // HARD18-022 (M3): a Home reset-class action must publish a machine
  // takeover so an armed Play session stops in place instead of later
  // auto-advancing onto the freshly reset machine.
  it("HARD18-022: handleRebootClearMemory publishes a machine takeover on success", async () => {
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleRebootClearMemory();
    });

    expect(publishMachineTakeoverMock).toHaveBeenCalledWith(expect.objectContaining({ reason: "home-reset" }));
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

    it("warns when saving a CPU+RAM snapshot evicts the oldest to stay within the library cap (HARD9-069)", async () => {
      createCpuSnapshotMock.mockResolvedValueOnce({
        displayTimestamp: "2026-01-01 12:00:00",
        cpu: { pc: 0xc000, a: 0, x: 0, y: 0, sp: 0xf6, p: 0x30 },
        captureMethod: "rli",
        resumeError: null,
        evictedSnapshotLabel: "Old boss save",
      });
      const { result } = renderHook(() => useHomeActions());

      await act(async () => {
        await result.current.handleSaveCpuSnapshot();
      });

      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "CPU + RAM snapshot saved" }));
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Oldest snapshot removed",
          description: expect.stringContaining("Old boss save"),
          variant: "destructive",
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

  it("falls back to a RAM-only restore when CPU restore is unsupported (HARD9-036)", async () => {
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
    restoreCpuSnapshotFromDecodedMock.mockRejectedValueOnce(
      new CpuRestoreUnsupportedError("stack pointer $05 is below the safe minimum"),
    );
    const snapshot: SnapshotStorageEntry = {
      id: "snap-cpu-unsupported",
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

    // CpuRestoreUnsupportedError is thrown before any cartridge upload -
    // nothing on the device was touched, so RAM-only restore is safe.
    expect(loadMemoryRangesMock).toHaveBeenCalledWith(apiMock, [{ start: 0, bytes: expect.any(Uint8Array) }], {
      alreadyPaused: false,
    });
    expect(reportUserErrorMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("RAM only"),
        description: expect.stringContaining("stack pointer $05"),
        variant: "destructive",
      }),
    );
  });

  it("reports a post-upload CPU restore failure as an error instead of silently falling back (HARD9-036)", async () => {
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
    // restoreCpuSnapshotFromDecoded itself already attempts a recovery reset
    // and augments the message before rejecting (see restoreCart.ts) - this
    // is a plain Error, not CpuRestoreUnsupportedError, since the cartridge
    // was already uploaded by this point.
    restoreCpuSnapshotFromDecodedMock.mockRejectedValueOnce(
      new Error("CPU restore: cartridge did not reach its handshake (the machine was automatically reset)"),
    );
    const snapshot: SnapshotStorageEntry = {
      id: "snap-cpu-post-upload-fail",
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

    expect(loadMemoryRangesMock).not.toHaveBeenCalled();
    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HOME_MACHINE_LOAD_RAM",
        description: expect.stringContaining("automatically reset"),
      }),
    );
  });

  // HARD12-020: Home previously assumed "running" on every mount via
  // page-local useState, desyncing from a pause applied via Play (which may
  // now be an unmounted placeholder). Home must read its initial pause label
  // from the shared machine-execution store instead.
  it("reads the initial pause state from the shared machine-execution store (HARD12-020)", () => {
    machineExecutionSnapshot = { state: "paused", pauseMutePending: false };

    const { result } = renderHook(() => useHomeActions());

    expect(result.current.machineExecutionState).toBe("paused");
  });

  // HARD12-020: Play's pause path may capture a SID pause-mute snapshot that
  // only Home's resume can restore (Play may be an unmounted placeholder when
  // the user resumes from Home). Resuming from Home must restore that
  // snapshot when the shared store reports one is pending, and must not do
  // so when no mute is pending.
  it("restores the pause-mute snapshot when resuming with a pending pause-mute flag (HARD12-020)", async () => {
    machineExecutionSnapshot = { state: "paused", pauseMutePending: true };
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });

    expect(resumeMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(restorePauseMuteFromPersistedSnapshotMock).toHaveBeenCalledWith(apiMock, "device-a");
    expect(setMachineExecutionRunningMock).toHaveBeenCalledTimes(1);
    expect(result.current.machineExecutionState).toBe("running");
  });

  it("does not attempt a pause-mute restore when resuming with no pending pause-mute flag (HARD12-020)", async () => {
    machineExecutionSnapshot = { state: "paused", pauseMutePending: false };
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handlePauseResume();
    });

    expect(resumeMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(restorePauseMuteFromPersistedSnapshotMock).not.toHaveBeenCalled();
  });

  // HARD18-015: saving a snapshot while the machine is user-paused (e.g. a
  // pause taken in Play, which mutes the SID mixer and sets pauseMutePending)
  // must not silently resume the machine nor clear the pending-mute-restore
  // marker - the only trigger left for the mixer to ever unmute again.
  it("HARD18-015: saving a RAM snapshot while paused does not resume the machine or clear pauseMutePending", async () => {
    machineExecutionSnapshot = { state: "paused", pauseMutePending: true };
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam("program");
    });

    expect(createSnapshotMock).toHaveBeenCalledWith(apiMock, expect.objectContaining({ alreadyPaused: true }));
    expect(setMachineExecutionRunningMock).not.toHaveBeenCalled();
    expect(result.current.machineExecutionState).toBe("paused");
    expect(machineExecutionSnapshot.pauseMutePending).toBe(true);
  });

  it("HARD18-015: a failed RAM snapshot save never marks the machine running", async () => {
    createSnapshotMock.mockRejectedValueOnce(new Error("save failed"));
    machineExecutionSnapshot = { state: "running", pauseMutePending: false };
    const { result } = renderHook(() => useHomeActions());

    await act(async () => {
      await result.current.handleSaveRam("program");
    });

    expect(reportUserErrorMock).toHaveBeenCalled();
    expect(setMachineExecutionRunningMock).not.toHaveBeenCalled();
  });

  it("HARD18-015: restoring a snapshot while paused keeps the machine paused", async () => {
    machineExecutionSnapshot = { state: "paused", pauseMutePending: true };
    const snapshot: SnapshotStorageEntry = {
      id: "snap-paused-restore",
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

    expect(loadMemoryRangesMock).toHaveBeenCalledWith(apiMock, expect.any(Array), { alreadyPaused: true });
    expect(setMachineExecutionRunningMock).not.toHaveBeenCalled();
    expect(result.current.machineExecutionState).toBe("paused");
  });
});
