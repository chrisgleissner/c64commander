/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { useC64ConfigItems, useC64Drives } from "@/hooks/useC64Connection";
import { PRINTER_HOME_ITEMS } from "../constants";
import { normalizeDriveDevices } from "@/lib/drives/driveDevices";

const visibleQueryOptions = { intent: "user" as const, refetchOnMount: "always" as const };

export function usePrinterData(isConnected: boolean) {
  const { data: drivesData, refetch: refetchDrives } = useC64Drives(visibleQueryOptions);

  const { data: printerConfig } = useC64ConfigItems(
    "Printer Settings",
    [...PRINTER_HOME_ITEMS],
    isConnected,
    visibleQueryOptions,
  );

  const normalizedDriveModel = useMemo(() => normalizeDriveDevices(drivesData ?? null), [drivesData]);

  const drivesByClass = useMemo(
    () => new Map(normalizedDriveModel.devices.map((entry) => [entry.class, entry])),
    [normalizedDriveModel.devices],
  );

  const printerDevice = drivesByClass.get("PRINTER") ?? null;

  return {
    refetchDrives,
    printerConfig,
    printerDevice,
  };
}
