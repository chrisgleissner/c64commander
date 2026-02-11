import { useMemo } from 'react';
import { useC64ConfigItems, useC64Drives } from '@/hooks/useC64Connection';
import { PRINTER_HOME_ITEMS } from '../constants';
import { normalizeDriveDevices } from '@/lib/drives/driveDevices';

export function usePrinterData(isConnected: boolean) {
    const { data: drivesData, refetch: refetchDrives } = useC64Drives();

    const { data: printerConfig } = useC64ConfigItems(
        'Printer Settings',
        [...PRINTER_HOME_ITEMS],
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

    const printerDevice = drivesByClass.get('PRINTER') ?? null;

    return {
        refetchDrives,
        printerConfig,
        printerDevice,
    };
}
