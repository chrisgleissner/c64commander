import { useEffect, useState, useRef } from 'react';
import { getC64API } from '@/lib/c64api';
import { useC64Connection, useC64MachineControl, useC64Drives } from '@/hooks/useC64Connection';
import { toast } from '@/hooks/use-toast';
import { reportUserError } from '@/lib/uiErrors';
import { addErrorLog } from '@/lib/logging';
import { useActionTrace } from '@/hooks/useActionTrace';
import {
    FULL_RAM_SIZE_BYTES,
    clearRamAndReboot,
    dumpFullRamImage,
    loadFullRamImage,
} from '@/lib/machine/ramOperations';
import {
    buildRamDumpFileName,
    pickRamDumpFile,
    selectRamDumpFolder,
    writeRamDumpToFolder,
} from '@/lib/machine/ramDumpStorage';
import {
    loadRamDumpFolderConfig,
    saveRamDumpFolderConfig,
    type RamDumpFolderConfig,
} from '@/lib/config/ramDumpFolderStore';
import { resetDiskDevices, resetPrinterDevice } from '@/lib/disks/resetDrives';

export function useHomeActions() {
    const api = getC64API();
    const { status } = useC64Connection();
    const controls = useC64MachineControl();
    const { data: drivesData } = useC64Drives();
    const trace = useActionTrace();
    const machineTaskInFlightRef = useRef<string | null>(null);
    const [machineTaskId, setMachineTaskId] = useState<string | null>(null);
    const [powerOffDialogOpen, setPowerOffDialogOpen] = useState(false);
    const [machineExecutionState, setMachineExecutionState] = useState<'running' | 'paused' | 'unknown'>('running');
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
        window.addEventListener('c64u-ram-dump-folder-updated', handler as EventListener);
        return () => window.removeEventListener('c64u-ram-dump-folder-updated', handler as EventListener);
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
            toast({
                title: successTitle,
                description: successDescription,
            });
        } catch (error) {
            reportUserError({
                operation: `HOME_MACHINE_${taskId.toUpperCase().replace(/-/g, '_')}`,
                title: 'Machine action failed',
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
                operation: 'HOME_ACTION',
                title: 'Error',
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
                title: 'RAM dump folder set',
                description: folder.rootName ?? 'Folder access granted',
            });
        } catch (error) {
            reportUserError({
                operation: 'RAM_DUMP_FOLDER_SELECT',
                title: 'Folder selection failed',
                description: (error as Error).message,
                error,
            });
        } finally {
            setFolderTaskPending(false);
        }
    });

    const handleRebootClearMemory = trace(async function handleRebootClearMemory() {
        await runMachineTask(
            'reboot-clear-memory',
            async () => {
                await clearRamAndReboot(api);
            },
            'Machine rebooting',
            'RAM cleared (excluding I/O region).',
        );
        setMachineExecutionState('running');
    });

    const handlePauseResume = trace(async function handlePauseResume() {
        if (!status.isConnected || machineTaskId !== null || pauseResumePending) return;
        const targetState = machineExecutionState === 'running' ? 'paused' : 'running';
        setPauseResumePending(true);
        try {
            if (targetState === 'paused') {
                await controls.pause.mutateAsync();
            } else {
                await controls.resume.mutateAsync();
            }
            setMachineExecutionState(targetState);
            toast({ title: targetState === 'paused' ? 'Machine paused' : 'Machine resumed' });
        } catch (error) {
            addErrorLog('Machine pause/resume failed', {
                targetState,
                error: (error as Error).message,
            });
            reportUserError({
                operation: 'HOME_MACHINE_PAUSE_RESUME',
                title: 'Machine action failed',
                description: (error as Error).message,
                error,
                context: { targetState },
            });
        } finally {
            setPauseResumePending(false);
        }
    });

    const handleSaveRam = trace(async function handleSaveRam() {
        await runMachineTask(
            'save-ram',
            async () => {
                const folder = ramDumpFolder ?? await selectRamDumpFolder();
                if (!ramDumpFolder) {
                    setRamDumpFolder(folder);
                }
                const image = await dumpFullRamImage(api);
                const fileName = buildRamDumpFileName();
                await writeRamDumpToFolder(folder, fileName, image);
            },
            'RAM dump saved',
            'Saved to selected folder.',
        );
        setMachineExecutionState('running');
    });

    const handleLoadRam = trace(async function handleLoadRam() {
        await runMachineTask(
            'load-ram',
            async () => {
                const pickedFile = await pickRamDumpFile({ preferredFolder: ramDumpFolder ?? undefined });
                if (!ramDumpFolder && pickedFile.parentFolder) {
                    saveRamDumpFolderConfig(pickedFile.parentFolder);
                    setRamDumpFolder(pickedFile.parentFolder);
                }
                if (pickedFile.bytes.length !== FULL_RAM_SIZE_BYTES) {
                    throw new Error(
                        `Invalid RAM dump size: expected ${FULL_RAM_SIZE_BYTES} bytes, got ${pickedFile.bytes.length} bytes`,
                    );
                }
                await loadFullRamImage(api, pickedFile.bytes);
            },
            'RAM loaded',
            'Memory image applied successfully.',
        );
        setMachineExecutionState('running');
    });

    const handlePowerOff = trace(async function handlePowerOff() {
        setPowerOffDialogOpen(true);
    });

    const confirmPowerOff = trace(async function confirmPowerOff() {
        setPowerOffDialogOpen(false);
        await handleAction(() => controls.powerOff.mutateAsync(), 'Powering off...');
    });

    const handleResetDrives = trace(async function handleResetDrives(refreshDrivesFromDevice: () => Promise<void>) {
        await runMachineTask(
            'reset-drives',
            async () => {
                await resetDiskDevices(api, drivesData ?? null);
                await refreshDrivesFromDevice();
            },
            'Drives reset',
            'Drive A, Drive B, and Soft IEC Drive were reset.',
        );
    });

    const handleResetPrinter = trace(async function handleResetPrinter(refreshDrivesFromDevice: () => Promise<void>) {
        await runMachineTask(
            'reset-printer',
            async () => {
                await resetPrinterDevice(api, drivesData ?? null);
                await refreshDrivesFromDevice();
            },
            'Printer reset',
            'Printer emulation was reset.',
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
        handleLoadRam,
        handleRebootClearMemory,
        handlePowerOff,
        confirmPowerOff,
        handleSelectRamDumpFolder,
        handleResetDrives,
        handleResetPrinter
    };
}
