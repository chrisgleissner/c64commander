/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState, useRef, useSyncExternalStore } from "react";
import { getC64API } from "@/lib/c64api";
import { useC64Connection, useC64MachineControl, useC64Drives } from "@/hooks/useC64Connection";
import { toast } from "@/hooks/use-toast";
import { reportUserError } from "@/lib/uiErrors";
import { addErrorLog } from "@/lib/logging";
import { useActionTrace } from "@/hooks/useActionTrace";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import {
  getMachineExecutionSnapshot,
  restorePauseMuteFromPersistedSnapshot,
  setMachineExecutionPaused,
  setMachineExecutionRunning,
  subscribeMachineExecution,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { publishMachineInterrupt } from "@/lib/deviceInteraction/machineInterrupt";
import { clearRamAndReboot, loadMemoryRanges } from "@/lib/machine/ramOperations";
import { selectRamDumpFolder } from "@/lib/machine/ramDumpStorage";
import { loadRamDumpFolderConfig, type RamDumpFolderConfig } from "@/lib/config/ramDumpFolderStore";
import { resetDiskDevices, resetPrinterDevice } from "@/lib/disks/resetDrives";
import { createCpuSnapshot, createSnapshot, CpuSnapshotUnsupportedError } from "@/lib/snapshot/snapshotCreation";
import { restoreCpuSnapshotFromDecoded } from "@/lib/snapshot/cpu/cpuSnapshot";
import { CpuRestoreUnsupportedError } from "@/lib/snapshot/cpu/restoreCart";
import { CpuCaptureFailedError } from "@/lib/snapshot/cpu/captureEngine";
import { deleteSnapshotFromStore, snapshotEntryToBytes, updateSnapshotLabel } from "@/lib/snapshot/snapshotStore";
import { decodeSnapshot } from "@/lib/snapshot/snapshotFormat";
import { getCurrentPlaybackSnapshotLabel } from "@/lib/snapshot/currentPlaybackSnapshotLabel";
import type { MemoryRange, SnapshotStorageEntry, SnapshotType } from "@/lib/snapshot/snapshotTypes";

const visibleQueryOptions = { intent: "user" as const, refetchOnMount: "always" as const };

export function useHomeActions() {
  const api = getC64API();
  const { status } = useC64Connection();
  const controls = useC64MachineControl();
  const { data: drivesData } = useC64Drives(visibleQueryOptions);
  const trace = useActionTrace();
  const machineTaskInFlightRef = useRef<string | null>(null);
  const [machineTaskId, setMachineTaskId] = useState<string | null>(null);
  const [powerOffDialogOpen, setPowerOffDialogOpen] = useState(false);
  // HARD12-020: read from the shared machine-execution store (written by both
  // Play and Home) instead of page-local state that always reset to "running"
  // on mount and desynced from a pause applied via Play.
  const machineExecutionState = useSyncExternalStore(
    subscribeMachineExecution,
    getMachineExecutionSnapshot,
    getMachineExecutionSnapshot,
  ).state;
  const setMachineExecutionState = useCallback((next: "running" | "paused" | "unknown") => {
    if (next === "paused") {
      setMachineExecutionPaused();
    } else {
      setMachineExecutionRunning();
    }
  }, []);
  const [pauseResumePending, setPauseResumePending] = useState(false);

  const [ramDumpFolder, setRamDumpFolder] = useState<RamDumpFolderConfig | null>(() => loadRamDumpFolderConfig());
  const [folderTaskPending, setFolderTaskPending] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as RamDumpFolderConfig | null;
      if (!detail) {
        setRamDumpFolder(null);
        return;
      }
      setRamDumpFolder(detail);
    };
    window.addEventListener("c64u-ram-dump-folder-updated", handler as EventListener);
    return () => window.removeEventListener("c64u-ram-dump-folder-updated", handler as EventListener);
  }, []);

  const runMachineTask = trace(async function runMachineTask(
    taskId: string,
    action: () => Promise<void>,
    successTitle: string,
    successDescription?: string,
  ) {
    if (!status.isConnected) return;
    const machineTaskBusy = machineTaskId !== null && machineTaskId !== taskId;

    if (machineTaskInFlightRef.current !== null || machineTaskBusy) return;
    machineTaskInFlightRef.current = taskId;
    setMachineTaskId(taskId);
    try {
      await action();
      if (successTitle) {
        toast({
          title: successTitle,
          description: successDescription,
        });
      }
    } catch (error) {
      reportUserError({
        operation: `HOME_MACHINE_${taskId.toUpperCase().replace(/-/g, "_")}`,
        title: "Machine action failed",
        description: (error as Error).message,
        error,
        context: { taskId },
      });
    } finally {
      if (machineTaskInFlightRef.current === taskId) {
        machineTaskInFlightRef.current = null;
      }
      setMachineTaskId(null);
    }
  });

  const handleAction = trace(async function handleAction(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      toast({ title: successMessage });
    } catch (error) {
      reportUserError({
        operation: "HOME_ACTION",
        title: "Error",
        description: (error as Error).message,
        error,
        context: { action: successMessage },
      });
    }
  });

  const handleSelectRamDumpFolder = trace(async function handleSelectRamDumpFolder() {
    setFolderTaskPending(true);
    try {
      const folder = await selectRamDumpFolder();
      setRamDumpFolder(folder);
      toast({
        title: "RAM dump folder set",
        description: folder.rootName ?? "Folder access granted",
      });
    } catch (error) {
      reportUserError({
        operation: "RAM_DUMP_FOLDER_SELECT",
        title: "Folder selection failed",
        description: (error as Error).message,
        error,
      });
    } finally {
      setFolderTaskPending(false);
    }
  });

  const handleRebootClearMemory = trace(async function handleRebootClearMemory() {
    await runMachineTask(
      "reboot-clear-memory",
      async () => {
        await clearRamAndReboot(api);
      },
      "Machine rebooting",
      "RAM cleared (excluding I/O region).",
    );
    // HARD18-022 (M3): stop any armed Play session in place instead of letting
    // auto-advance relaunch content on the freshly reset machine. HARD19-032:
    // also restore a pending pause-mute so a reboot-while-paused does not strand
    // the SID mixer muted. publishMachineInterrupt sets "running" synchronously.
    void publishMachineInterrupt({ reason: "home-reset", label: "Reboot (Clr Mem)" });
  });

  const handlePauseResume = trace(async function handlePauseResume() {
    if (!status.isConnected || machineTaskId !== null || pauseResumePending) return;
    const targetState = machineExecutionState === "running" ? "paused" : "running";
    // Read before setMachineExecutionState clears it below — a pause taken in
    // Play (possibly now an unmounted placeholder) may have muted the SID
    // mixer and left a snapshot only Home's resume can now restore.
    const pauseMutePending = getMachineExecutionSnapshot().pauseMutePending;
    setPauseResumePending(true);
    try {
      if (targetState === "paused") {
        await controls.pause.mutateAsync();
      } else {
        await controls.resume.mutateAsync();
        if (pauseMutePending) {
          await restorePauseMuteFromPersistedSnapshot(api, getSelectedSavedDevice()?.id ?? null);
        }
      }
      setMachineExecutionState(targetState);
      toast({
        title: targetState === "paused" ? "Machine paused" : "Machine resumed",
      });
    } catch (error) {
      addErrorLog("Machine pause/resume failed", {
        targetState,
        error: (error as Error).message,
      });
      reportUserError({
        operation: "HOME_MACHINE_PAUSE_RESUME",
        title: "Machine action failed",
        description: (error as Error).message,
        error,
        context: { targetState },
      });
    } finally {
      setPauseResumePending(false);
    }
  });

  const handleSaveRam = trace(async function handleSaveRam(type: SnapshotType, customRanges?: MemoryRange[]) {
    // HARD18-015: a snapshot save must never silently resume a machine the
    // user deliberately paused (e.g. from Play), and must never mark the
    // machine "running" when the underlying task failed.
    const wasPaused = getMachineExecutionSnapshot().state === "paused";
    let succeeded = false;
    await runMachineTask(
      "save-ram",
      async () => {
        const currentPlaybackLabel = getCurrentPlaybackSnapshotLabel();
        const result = await createSnapshot(api, {
          type,
          customRanges,
          label: currentPlaybackLabel,
          contentName: currentPlaybackLabel,
          alreadyPaused: wasPaused,
        });
        succeeded = true;
        toast({
          title: "Snapshot saved",
          description: result.displayTimestamp,
        });
        // The store silently drops the oldest snapshot at the MAX_SNAPSHOTS
        // cap - warn so the user knows a saved game state just disappeared
        // instead of finding out only when they go looking for it later.
        // See HARD9-069.
        if (result.evictedSnapshotLabel) {
          toast({
            title: "Oldest snapshot removed",
            description: `The library is full - "${result.evictedSnapshotLabel}" was deleted to make room.`,
            variant: "destructive",
          });
        }
      },
      // runMachineTask also toasts success — we suppress that and toast inside
      // the action to include the timestamp.  Pass empty strings to avoid a
      // double toast; the inner toast already ran.
      "",
    );
    if (succeeded && !wasPaused) {
      setMachineExecutionState("running");
    }
  });

  const handleSaveCpuSnapshot = trace(async function handleSaveCpuSnapshot() {
    // HARD18-015: same caller-level bug as handleSaveRam above - preserve the
    // prior execution state and never mark "running" on failure. The CPU
    // capture engine's own cartridge-driven pause/resume choreography is left
    // untouched (it rides a live interrupt, a different mechanism entirely).
    const wasPaused = getMachineExecutionSnapshot().state === "paused";
    let succeeded = false;
    await runMachineTask(
      "save-cpu",
      async () => {
        const currentPlaybackLabel = getCurrentPlaybackSnapshotLabel();
        let result;
        try {
          result = await createCpuSnapshot(api, {
            label: currentPlaybackLabel,
            contentName: currentPlaybackLabel,
          });
        } catch (error) {
          // CPU capture can't serve every program — SEI tight loops and
          // vector-protected demos have no rideable interrupt. Degrade with a
          // clear, actionable message; a plain RAM snapshot always works.
          if (error instanceof CpuCaptureFailedError || error instanceof CpuSnapshotUnsupportedError) {
            throw new Error(
              "Couldn't capture CPU state for this program (it disables or protects its interrupts). " +
                "Use a Program or Basic RAM snapshot instead.",
            );
          }
          throw error;
        }
        succeeded = true;
        // The snapshot itself is valid even when resumeError is set - only
        // the post-capture resume failed, which can leave the C64 frozen
        // with the IRQ vector still pointed at the capture handler. Surface
        // that (not just log it) so the user knows to Restore or reset
        // instead of assuming playback is live again. See HARD9-035.
        if (result.resumeError) {
          toast({
            title: "CPU + RAM snapshot saved — program may still be frozen",
            description: `${result.displayTimestamp} — the machine could not resume automatically (${result.resumeError.message}). Use Restore or reset the machine.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "CPU + RAM snapshot saved",
            description: `${result.displayTimestamp} — PC $${result.cpu.pc.toString(16).toUpperCase().padStart(4, "0")}`,
          });
        }
        // See HARD9-069 (handleSaveRam above has the same warning).
        if (result.evictedSnapshotLabel) {
          toast({
            title: "Oldest snapshot removed",
            description: `The library is full - "${result.evictedSnapshotLabel}" was deleted to make room.`,
            variant: "destructive",
          });
        }
      },
      "",
    );
    if (succeeded && !wasPaused) {
      setMachineExecutionState("running");
    }
  });

  const handleRestoreSnapshot = trace(async function handleRestoreSnapshot(snapshot: SnapshotStorageEntry) {
    // HARD18-015: a snapshot restore must not silently resume a machine the
    // user deliberately paused, and must never mark "running" on failure.
    const wasPaused = getMachineExecutionSnapshot().state === "paused";
    let succeeded = false;
    // CPU-state restores always launch the captured PC via the uploaded
    // cartridge, which inherently runs the machine - only a RAM-only restore
    // that honored an existing pause should keep the machine "paused".
    let endsPaused = false;
    await runMachineTask(
      "load-ram",
      async () => {
        const bytes = snapshotEntryToBytes(snapshot);
        const decoded = decodeSnapshot(bytes);
        const successLabel = snapshot.metadata.label ?? snapshot.metadata.created_at;
        const loadRamOnly = async () => {
          const ranges = decoded.ranges.map((r, i) => ({
            start: r.start,
            bytes: decoded.blocks[i],
          }));
          await loadMemoryRanges(api, ranges, { alreadyPaused: wasPaused });
          endsPaused = wasPaused;
        };
        // CPU+RAM snapshots resume at the exact PC via the uploaded-cartridge
        // path; only when the snapshot actually carries verified CPU state.
        if (decoded.metadata?.cpu_state_captured && decoded.metadata.cpu) {
          try {
            await restoreCpuSnapshotFromDecoded(api, decoded);
          } catch (error) {
            // CpuRestoreUnsupportedError is thrown before any cartridge
            // upload (stack pointer too low, missing the $01 banking byte) -
            // nothing on the device has been touched yet, so a RAM-only
            // restore is always a safe fallback instead of just failing
            // outright. Any other error means the cartridge was already
            // uploaded and restoreCpuSnapshotFromDecoded has already
            // attempted a recovery reset - let it propagate to the normal
            // error-toast path below (its message already explains the
            // recovery outcome). See HARD9-036.
            if (!(error instanceof CpuRestoreUnsupportedError)) throw error;
            addErrorLog("CPU restore unsupported, falling back to RAM-only restore", {
              error: error.message,
            });
            await loadRamOnly();
            succeeded = true;
            toast({
              title: "Snapshot restored (RAM only)",
              description: `${successLabel} — exact CPU state could not be restored (${error.message})`,
              variant: "destructive",
            });
            return;
          }
          succeeded = true;
          toast({ title: "Snapshot restored", description: successLabel });
          return;
        }
        await loadRamOnly();
        succeeded = true;
        toast({ title: "Snapshot restored", description: successLabel });
      },
      "",
    );
    if (succeeded) {
      // HARD19-011: publish the machine takeover so an armed Play session stops
      // in place instead of auto-advancing over the just-restored session.
      // HARD19-032: restore any pending pause-mute so a restore-while-paused does
      // not strand the SID mixer muted. `endsPaused` (a RAM-only restore that
      // honoured an existing pause) keeps the machine paused and skips the mixer
      // restore, but still stops the armed session.
      void publishMachineInterrupt({
        reason: "home-reset",
        label: snapshot.metadata.label ?? "Snapshot restore",
        endsPaused,
      });
    }
  });

  const handleDeleteSnapshot = (id: string) => {
    deleteSnapshotFromStore(id);
  };

  const handleUpdateSnapshotLabel = (id: string, label: string) => {
    updateSnapshotLabel(id, label);
  };

  const handlePowerOff = trace(async function handlePowerOff() {
    setPowerOffDialogOpen(true);
  });

  const confirmPowerOff = trace(async function confirmPowerOff() {
    setPowerOffDialogOpen(false);
    let succeeded = false;
    await handleAction(async () => {
      await controls.powerOff.mutateAsync();
      succeeded = true;
    }, "Powering off...");
    if (succeeded) {
      // HARD19-031: Power Off never published a takeover, so an armed playlist
      // kept firing auto-advance launch calls at a now-dead device (doomed REST
      // traffic + failure evidence). Publish it (success-gated) so the Play
      // session stops; also mark execution state + restore any pending pause-mute.
      void publishMachineInterrupt({ reason: "home-reset", label: "Power off" });
    }
  });

  // The drives poll resolves independently of the connection badge, so a reset can be
  // triggered (button enabled on `isConnected`) before `drivesData` is populated. Computing
  // reset targets from an empty payload throws "No resettable disk devices found."; fetch
  // fresh device state in that window instead of relying on the possibly-undefined cache.
  const resolveDrivesPayload = async () => {
    if (drivesData?.drives?.length) {
      return drivesData;
    }
    return api.getDrives({ __c64uIntent: "user" });
  };

  const handleResetDrives = trace(async function handleResetDrives(refreshDrivesFromDevice: () => Promise<void>) {
    await runMachineTask(
      "reset-drives",
      async () => {
        await resetDiskDevices(api, await resolveDrivesPayload());
        await refreshDrivesFromDevice();
      },
      "Drives reset",
      "Drive A, Drive B, and Soft IEC Drive were reset.",
    );
  });

  const handleResetPrinter = trace(async function handleResetPrinter(refreshDrivesFromDevice: () => Promise<void>) {
    await runMachineTask(
      "reset-printer",
      async () => {
        await resetPrinterDevice(api, await resolveDrivesPayload());
        await refreshDrivesFromDevice();
      },
      "Printer reset",
      "Printer emulation was reset.",
    );
  });

  return {
    controls,
    machineTaskId,
    machineExecutionState,
    setMachineExecutionState,
    pauseResumePending,
    powerOffDialogOpen,
    setPowerOffDialogOpen,
    ramDumpFolder,
    setRamDumpFolder, // Exported in case needed (e.g. initial load? but useEffect handles it)
    folderTaskPending,
    runMachineTask,
    handleAction,
    handlePauseResume,
    handleSaveRam,
    handleSaveCpuSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    handleUpdateSnapshotLabel,
    handleRebootClearMemory,
    handlePowerOff,
    confirmPowerOff,
    handleSelectRamDumpFolder,
    handleResetDrives,
    handleResetPrinter,
  };
}
