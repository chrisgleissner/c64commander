import { useState, useMemo } from 'react';
import { getC64API } from '@/lib/c64api';
import { useActionTrace } from '@/hooks/useActionTrace';
import { useSharedConfigActions } from '../hooks/ConfigActionsContext';
import { useDriveData } from '../hooks/useDriveData';
import { DriveCard } from '../DriveCard';
import { SectionHeader } from '@/components/SectionHeader';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { SOURCE_LABELS } from '@/lib/sourceNavigation/sourceTerms';
import { DRIVE_CONTROL_SPECS, DriveControlSpec } from '../constants';
import { formatDiskDosStatus, type DiskDosStatus } from '@/lib/disks/dosStatusFormatter';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import {
    buildBusIdOptions,
    buildTypeOptions,
} from '@/lib/drives/driveDevices';
import {
    readItemOptions,
    buildConfigKey,
} from '../utils/HomeConfigUtils';
import {
    DISK_BUS_ID_DEFAULTS,
    PHYSICAL_DRIVE_TYPE_DEFAULTS,
} from '../constants';

const resolveDriveStatusRaw = (value?: string | null) => {
    const message = value?.trim() ?? '';
    if (!message) return '';
    if (/^service error reported\.?$/i.test(message)) return '';
    return message;
};

const toStatusSummary = (status: DiskDosStatus) => {
    if (status.message) {
        return status.message.replace(/\s+\(.+\)$/, '');
    }
    if (status.code !== null) {
        return `DOS STATUS ${status.code}`;
    }
    return 'Status reported';
};

interface DriveManagerProps {
    isConnected: boolean;
    handleAction: (action: () => Promise<void>, description: string) => Promise<void>;
    machineTaskBusy: boolean;
    machineTaskId: string | null;
    onResetDrives: (callback: () => Promise<void>) => Promise<void>;
}

export function DriveManager({
    isConnected,
    handleAction,
    machineTaskBusy,
    machineTaskId,
    onResetDrives
}: DriveManagerProps) {
    const api = getC64API();
    const trace = useActionTrace('DriveManager');
    const { updateConfigValue, resolveConfigValue, configWritePending } = useSharedConfigActions();

    const {
        refetchDrives,
        driveASettingsCategory,
        driveBSettingsCategory,
        softIecConfig,
        driveSummaryItems,
        drivesByClass,
    } = useDriveData(isConnected);

    const [mountTarget, setMountTarget] = useState<{
        spec: DriveControlSpec;
        currentPath?: string;
    } | null>(null);
    const [statusDetailsDialog, setStatusDetailsDialog] = useState<{
        driveLabel: string;
        status: DiskDosStatus;
    } | null>(null);

    const sourceGroups = useMemo(() => {
        const groups: SourceGroup[] = [];
        if (isConnected) {
            groups.push({
                label: SOURCE_LABELS.c64u,
                sources: [createUltimateSourceLocation()],
            });
        }
        return groups;
    }, [isConnected]);

    const handleMountClick = (spec: DriveControlSpec, currentPath?: string) => {
        setMountTarget({ spec, currentPath });
    };

    const handleMountSelection = async (source: unknown, selections: { path: string }[]) => {
        if (!mountTarget || selections.length === 0) return false;
        const selected = selections[0];
        const { spec } = mountTarget;

        if (spec.class === 'SOFT_IEC_DRIVE') {
            await updateConfigValue(
                'SoftIEC Drive Settings',
                'Default Path',
                selected.path,
                'HOME_SOFT_IEC_PATH',
                'Soft IEC path updated'
            );
        } else if (spec.class === 'PHYSICAL_DRIVE_A' || spec.class === 'PHYSICAL_DRIVE_B') {
            const driveId = spec.class === 'PHYSICAL_DRIVE_A' ? 'a' : 'b';
            await handleAction(async () => {
                await api.mountDrive(driveId, selected.path);
                await refetchDrives();
            }, `Mounted to Drive ${driveId.toUpperCase()}`);
        }
        setMountTarget(null);
        return true;
    };

    const handleEnabledToggle = trace(async function handleEnabledToggle(
        label: string,
        spec: DriveControlSpec,
        enabled: boolean,
    ) {
        const nextValue = enabled ? 'Disabled' : 'Enabled';
        await updateConfigValue(
            spec.category,
            spec.enabledItem,
            nextValue,
            'HOME_DRIVE_ENABLED',
            `${label} ${enabled ? 'disabled' : 'enabled'}`,
            { refreshDrives: true },
        );
    });

    return (
        <div className="space-y-3" data-section-label="Drives">
            <SectionHeader
                title="Drives"
                resetAction={async () => await onResetDrives(async () => { await refetchDrives(); })}
                resetDisabled={!isConnected || machineTaskBusy}
                isResetting={machineTaskId === 'reset-drives'}
                resetTestId="home-drives-reset"
            />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="home-drives-group">

                {DRIVE_CONTROL_SPECS.map((spec) => {
                    let category: Record<string, unknown> | undefined;
                    let summary: { mountedLabel: string; isMounted: boolean } | undefined;

                    if (spec.class === 'PHYSICAL_DRIVE_A') {
                        category = driveASettingsCategory as Record<string, unknown> | undefined;
                        summary = driveSummaryItems.find((s) => s.key === 'a');
                    } else if (spec.class === 'PHYSICAL_DRIVE_B') {
                        category = driveBSettingsCategory as Record<string, unknown> | undefined;
                        summary = driveSummaryItems.find((s) => s.key === 'b');
                    } else if (spec.class === 'SOFT_IEC_DRIVE') {
                        category = softIecConfig as Record<string, unknown> | undefined;
                        summary = driveSummaryItems.find((s) => s.key === 'softiec');
                    }

                    const device = drivesByClass.get(spec.class) ?? null;
                    const label = device?.label ?? spec.label;
                    const payload = category;
                    const enabledValue = String(
                        resolveConfigValue(payload, spec.category, spec.enabledItem, device?.enabled ? 'Enabled' : 'Disabled'),
                    );
                    const enabled = enabledValue.trim().toLowerCase() === 'enabled';
                    const busFallback = device?.busId ?? (spec.class === 'PHYSICAL_DRIVE_A' ? 8 : spec.class === 'PHYSICAL_DRIVE_B' ? 9 : 11);
                    const busValue = Number(resolveConfigValue(payload, spec.category, spec.busItem, busFallback));
                    const busOptions = buildBusIdOptions(DISK_BUS_ID_DEFAULTS, Number.isFinite(busValue) ? busValue : null);

                    const typeValue = spec.typeItem
                        ? String(resolveConfigValue(payload, spec.category, spec.typeItem, device?.type ?? '1541'))
                        : (device?.type ?? 'DOS emulation');

                    const rawTypeOptions = spec.typeItem
                        ? readItemOptions(payload, spec.category, spec.typeItem).map((value) => String(value))
                        : [];

                    const typeOptions = spec.typeItem
                        ? buildTypeOptions(
                            rawTypeOptions.length ? rawTypeOptions : PHYSICAL_DRIVE_TYPE_DEFAULTS,
                            typeValue,
                        )
                        : [typeValue];

                    const isSoftIec = spec.class === 'SOFT_IEC_DRIVE';
                    const pendingEnabled = Boolean(configWritePending[buildConfigKey(spec.category, spec.enabledItem)]);
                    const pendingBus = Boolean(configWritePending[buildConfigKey(spec.category, spec.busItem)]);
                    const pendingType = spec.typeItem ? Boolean(configWritePending[buildConfigKey(spec.category, spec.typeItem)]) : false;

                    let mountedPath = summary?.mountedLabel;
                    if (isSoftIec) {
                        mountedPath = String(resolveConfigValue(
                            softIecConfig as Record<string, unknown> | undefined,
                            'SoftIEC Drive Settings',
                            'Default Path',
                            '/USB0/'
                        ));
                    }
                    const mountedPathLabel = isSoftIec ? 'Path' : 'Disk';
                    const pathPending = isSoftIec
                        ? Boolean(configWritePending[buildConfigKey('SoftIEC Drive Settings', 'Default Path')])
                        : false;
                    const statusRaw = resolveDriveStatusRaw(device?.lastError);
                    const formattedStatus = statusRaw ? formatDiskDosStatus(statusRaw) : null;


                    const testIdSuffix = spec.testIdSuffix;

                    return (
                        <DriveCard
                            key={spec.class}
                            name={label}
                            enabled={enabled}
                            onToggle={() => void handleEnabledToggle(label, spec, enabled)}
                            togglePending={pendingEnabled}
                            busIdValue={String(busValue)}
                            busIdOptions={busOptions.map(String)}
                            onBusIdChange={(value) =>
                                void updateConfigValue(
                                    spec.category,
                                    spec.busItem,
                                    Number(value),
                                    'HOME_DRIVE_BUS',
                                    `${label} bus ID updated`,
                                    { refreshDrives: true },
                                )}
                            busIdPending={pendingBus}
                            typeValue={!isSoftIec ? typeValue : undefined}
                            typeOptions={!isSoftIec ? typeOptions : undefined}
                            onTypeChange={!isSoftIec ? (value) => {
                                if (!spec.typeItem) return;
                                void updateConfigValue(
                                    spec.category,
                                    spec.typeItem,
                                    value,
                                    'HOME_DRIVE_TYPE',
                                    `${label} type updated`,
                                    { refreshDrives: true },
                                );
                            } : undefined}
                            typePending={!isSoftIec ? pendingType : undefined}
                            mountedPath={mountedPath}
                            mountedPathLabel={mountedPathLabel}
                            onMountedPathClick={() => handleMountClick(spec, summary?.mountedLabel)}
                            statusSummary={formattedStatus ? toStatusSummary(formattedStatus) : undefined}
                            statusSeverity={formattedStatus?.severity}
                            onStatusClick={formattedStatus
                                ? () => setStatusDetailsDialog({ driveLabel: label, status: formattedStatus })
                                : undefined}
                            pathPending={pathPending}
                            isConnected={isConnected}
                            testIdSuffix={testIdSuffix}
                        />
                    );
                })}
            </div>

            <ItemSelectionDialog
                open={mountTarget !== null}
                onOpenChange={(open) => !open && setMountTarget(null)}
                title={mountTarget?.spec.class === 'SOFT_IEC_DRIVE' ? 'Mount Path' : 'Mount Disk'}
                confirmLabel="Mount"
                sourceGroups={mountTarget?.spec.class === 'SOFT_IEC_DRIVE'
                    ? sourceGroups.filter((g) => g.sources.some((s) => s.type === 'ultimate'))
                    : sourceGroups}
                onConfirm={handleMountSelection}
                onAddLocalSource={async () => null}
                allowFolderSelection={mountTarget?.spec.class === 'SOFT_IEC_DRIVE'}
            />

            <Dialog open={Boolean(statusDetailsDialog)} onOpenChange={(open) => !open && setStatusDetailsDialog(null)}>
                <DialogContent className="max-w-lg" data-testid="home-drive-status-details-dialog">
                    <DialogHeader>
                        <DialogTitle>
                            {statusDetailsDialog
                                ? `${statusDetailsDialog.driveLabel}: ${statusDetailsDialog.status.message ?? 'DOS Status'}`
                                : 'DOS Status'}
                        </DialogTitle>
                        <DialogDescription>
                            {statusDetailsDialog && statusDetailsDialog.status.code !== null
                                ? `Code ${statusDetailsDialog.status.code} • ${statusDetailsDialog.status.severity}`
                                : `Severity ${statusDetailsDialog?.status.severity ?? 'INFO'}`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {statusDetailsDialog?.status.details ? (
                            <p className="text-sm leading-relaxed" data-testid="home-drive-status-details-text">
                                {statusDetailsDialog.status.details}
                            </p>
                        ) : null}
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Raw status line</p>
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-all" data-testid="home-drive-status-details-raw">
                                {statusDetailsDialog?.status.raw}
                            </p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
