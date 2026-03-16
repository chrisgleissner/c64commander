import { useEffect, useState, useRef } from "react";
import { getC64API } from "@/lib/c64api";
import {
  useC64Connection,
  useC64MachineControl,
  useC64Drives,
} from "@/hooks/useC64Connection";
import { toast } from "@/hooks/use-toast";
import { reportUserError } from "@/lib/uiErrors";
import { addErrorLog } from "@/lib/logging";
import { useActionTrace } from "@/hooks/useActionTrace";
import { clearRamAndReboot, loadMemoryRanges } from "@/lib/machine/ramOperations";
import { selectRamDumpFolder } from "@/lib/machine/ramDumpStorage";
import { loadRamDumpFolderConfig, type RamDumpFolderConfig } from "@/lib/config/ramDumpFolderStore";
import { resetDiskDevices, resetPrinterDevice } from "@/lib/disks/resetDrives";
import { createSnapshot } from "@/lib/snapshot/snapshotCreation";
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
  const [machineExecutionState, setMachineExecutionState] = useState<"running" | "paused" | "unknown">("running");
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
    setMachineExecutionState("running");
  });

  const handlePauseResume = trace(async function handlePauseResume() {
    if (!status.isConnected || machineTaskId !== null || pauseResumePending) return;
    const targetState = machineExecutionState === "running" ? "paused" : "running";
    setPauseResumePending(true);
    try {
      if (targetState === "paused") {
        await controls.pause.mutateAsync();
      } else {
        await controls.resume.mutateAsync();
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
    await runMachineTask(
      "save-ram",
      async () => {
        const currentPlaybackLabel = getCurrentPlaybackSnapshotLabel();
        const result = await createSnapshot(api, {
          type,
          customRanges,
          label: currentPlaybackLabel,
          contentName: currentPlaybackLabel,
        });
        toast({
          title: "Snapshot saved",
          description: result.displayTimestamp,
        });
      },
      // runMachineTask also toasts success — we suppress that and toast inside
      // the action to include the timestamp.  Pass empty strings to avoid a
      // double toast; the inner toast already ran.
      "",
    );
    setMachineExecutionState("running");
  });

  const handleRestoreSnapshot = trace(async function handleRestoreSnapshot(snapshot: SnapshotStorageEntry) {
    await runMachineTask(
      "load-ram",
      async () => {
        const bytes = snapshotEntryToBytes(snapshot);
        const decoded = decodeSnapshot(bytes);
        const ranges = decoded.ranges.map((r, i) => ({
          start: r.start,
          bytes: decoded.blocks[i],
        }));
        await loadMemoryRanges(api, ranges);
      },
      "Snapshot restored",
      snapshot.metadata.label ?? snapshot.metadata.created_at,
    );
    setMachineExecutionState("running");
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
    await handleAction(() => controls.powerOff.mutateAsync(), "Powering off...");
  });

  const handleResetDrives = trace(async function handleResetDrives(refreshDrivesFromDevice: () => Promise<void>) {
    await runMachineTask(
      "reset-drives",
      async () => {
        await resetDiskDevices(api, drivesData ?? null);
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
        await resetPrinterDevice(api, drivesData ?? null);
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
