import { useMemo } from 'react';
import { useC64ConfigItems, useC64Drives } from '@/hooks/useC64Connection';
import { normalizeDriveDevices } from '@/lib/drives/driveDevices';
import { DRIVE_A_HOME_ITEMS, DRIVE_B_HOME_ITEMS } from '../constants';

export function useDriveData(isConnected: boolean) {
    const { data: drivesData, refetch: refetchDrives } = useC64Drives();

    const { data: driveASettingsCategory } = useC64ConfigItems(
        'Drive A Settings',
        [...DRIVE_A_HOME_ITEMS],
        isConnected
    );

    const { data: driveBSettingsCategory } = useC64ConfigItems(
        'Drive B Settings',
        [...DRIVE_B_HOME_ITEMS],
        isConnected
    );

    const { data: softIecConfig } = useC64ConfigItems(
        'SoftIEC Drive Settings',
        ['IEC Drive', 'Soft Drive Bus ID', 'Default Path'],
        isConnected
    );

    const normalizedDriveModel = useMemo(
        () => normalizeDriveDevices(drivesData ?? null),
        [drivesData],
    );

    const drivesByClass = useMemo(
        () => new Map(normalizedDriveModel.devices.map((entry) => [entry.class, entry])),
        [normalizedDriveModel.devices],
    );

    const driveSummaryItems = useMemo(() => {
        const entries = [
            { key: 'a', label: 'Drive A', device: drivesByClass.get('PHYSICAL_DRIVE_A') ?? null },
            { key: 'b', label: 'Drive B', device: drivesByClass.get('PHYSICAL_DRIVE_B') ?? null },
            { key: 'softiec', label: 'Soft IEC', device: drivesByClass.get('SOFT_IEC_DRIVE') ?? null },
        ];
        return entries.map((entry) => ({
            ...entry,
            mountedLabel: entry.device?.imageFile || 'No disk mounted',
            isMounted: Boolean(entry.device?.imageFile),
        }));
    }, [drivesByClass]);

    return {
        drivesData,
        refetchDrives,
        driveASettingsCategory,
        driveBSettingsCategory,
        softIecConfig,
        normalizedDriveModel,
        drivesByClass,
        driveSummaryItems,
    };
}
