import { motion } from 'framer-motion';
import {
    RotateCcw,
    Power,
    PowerOff,
    Pause,
    Menu,
    Upload,
    Play,
    Download,
} from 'lucide-react';
import { SectionHeader } from '@/components/SectionHeader';
import { QuickActionCard } from '@/components/QuickActionCard';
import { ResponsivePathText } from '@/components/ResponsivePathText';

export interface MachineControlsProps {
    status: { isConnected: boolean; isConnecting: boolean };
    machineTaskBusy: boolean;
    machineExecutionState: 'running' | 'paused' | 'unknown';
    setMachineExecutionState: (s: 'running' | 'paused' | 'unknown') => void;
    controls: {
        reset: { mutateAsync: () => Promise<unknown>; isPending: boolean };
        reboot: { mutateAsync: () => Promise<unknown>; isPending: boolean };
        powerOff: { mutateAsync: () => Promise<unknown>; isPending: boolean };
        menuButton: { mutateAsync: () => Promise<unknown>; isPending: boolean };
    };
    pauseResumePending: boolean;
    machineTaskId: string | null;
    onPauseResume: () => void;
    onSaveRam: () => void;
    onLoadRam: () => void;
    onRebootClearMemory: () => void;
    onPowerOff: () => void;
    onAction: (fn: () => Promise<void>, label: string) => void;
    driveSummaryItems: Array<{
        key: string;
        label: string;
        mountedLabel: string;
        isMounted: boolean;
    }>;
}

export function MachineControls({
    status,
    machineTaskBusy,
    machineExecutionState,
    setMachineExecutionState,
    controls,
    pauseResumePending,
    machineTaskId,
    onPauseResume,
    onSaveRam,
    onLoadRam,
    onRebootClearMemory,
    onPowerOff,
    onAction,
    driveSummaryItems,
}: MachineControlsProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-2"
            data-section-label="Machine"
        >
            <SectionHeader title="Machine">
                {machineTaskBusy && (
                    <span className="ml-2 text-xs text-muted-foreground">Working…</span>
                )}
            </SectionHeader>
            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" data-testid="home-drive-summary">
                    {driveSummaryItems.map((entry) => (
                        <span key={entry.key} className="flex min-w-0 items-center gap-1">
                            <span className="font-semibold text-foreground whitespace-nowrap">{entry.label}:</span>
                            <ResponsivePathText
                                path={entry.mountedLabel}
                                mode="filename-fallback"
                                className={entry.isMounted ? 'text-foreground truncate' : 'text-muted-foreground truncate'}
                                dataTestId={`home-drive-summary-label-${entry.key}`}
                            />
                        </span>
                    ))}
                </div>
                <div className="grid grid-cols-4 gap-2" data-testid="home-machine-controls">
                    <QuickActionCard
                        icon={RotateCcw}
                        label="Reset"
                        compact
                        variant="danger"
                        className="border-destructive/40 bg-destructive/[0.04]"
                        onClick={() =>
                            onAction(async () => {
                                await controls.reset.mutateAsync();
                                setMachineExecutionState('running');
                            }, 'Machine reset')}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={controls.reset.isPending}
                    />
                    <QuickActionCard
                        icon={Power}
                        label="Reboot"
                        compact
                        variant="danger"
                        className="border-destructive/40 bg-destructive/[0.04]"
                        onClick={() =>
                            onAction(async () => {
                                await controls.reboot.mutateAsync();
                                setMachineExecutionState('running');
                            }, 'Machine rebooting...')}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={controls.reboot.isPending}
                    />
                    <QuickActionCard
                        icon={machineExecutionState === 'paused' ? Play : Pause}
                        label={machineExecutionState === 'paused' ? 'Resume' : 'Pause'}
                        compact
                        className={machineExecutionState === 'paused' ? 'border-primary/60 bg-primary/10' : undefined}
                        onClick={() => void onPauseResume()}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={pauseResumePending}
                    />
                    <QuickActionCard
                        icon={Menu}
                        label="Menu"
                        compact
                        onClick={() => onAction(() => controls.menuButton.mutateAsync() as Promise<void>, 'Menu toggled')}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={controls.menuButton.isPending}
                    />
                    <QuickActionCard
                        icon={Download}
                        label="Save RAM"
                        compact
                        onClick={() => void onSaveRam()}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={machineTaskId === 'save-ram'}
                    />
                    <QuickActionCard
                        icon={Upload}
                        label="Load RAM"
                        compact
                        onClick={() => void onLoadRam()}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={machineTaskId === 'load-ram'}
                    />
                    <QuickActionCard
                        icon={RotateCcw}
                        label="Reboot (Clear RAM)"
                        compact
                        onClick={() => void onRebootClearMemory()}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={machineTaskId === 'reboot-clear-memory'}
                    />
                    <QuickActionCard
                        icon={PowerOff}
                        label="Power Off"
                        compact
                        variant="danger"
                        className="border-destructive/30 bg-destructive/[0.03] opacity-80"
                        onClick={() => void onPowerOff()}
                        disabled={!status.isConnected || machineTaskBusy}
                        loading={controls.powerOff.isPending}
                    />
                </div>
            </div>
        </motion.div>
    );
}
