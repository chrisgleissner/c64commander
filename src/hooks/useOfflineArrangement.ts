/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { OFFLINE_SETTLE_MS, resolveOfflineArrangement } from "@/lib/home/offlineArrangement";

/**
 * Whether Home draws its offline arrangement right now (spec.md section 7.2).
 *
 * Only the SELECTED device is consulted, because only the selected device is routinely probed. No
 * new polling is introduced, and no extra traffic reaches hardware this repo already treats as
 * fragile.
 *
 * `pinned` is passed in by Home: an open dialog, sheet or search overlay, or a running tour, freezes
 * the arrangement so the page cannot reorder under whatever is on top of it.
 */
export const useOfflineArrangement = (pinned: boolean): boolean => {
  const { status } = useC64Connection();
  const savedDevices = useSavedDevices();
  const selectedDevice = savedDevices.devices.find((device) => device.id === savedDevices.selectedDeviceId) ?? null;

  const unreachableSinceRef = useRef<number | null>(status.isConnected ? null : Date.now());
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (status.isConnected) {
      unreachableSinceRef.current = null;
    } else if (unreachableSinceRef.current === null) {
      unreachableSinceRef.current = Date.now();
    }

    const evaluate = () =>
      setOffline((current) =>
        resolveOfflineArrangement({
          isConnected: status.isConnected,
          selectedDevice,
          unreachableSinceMs: unreachableSinceRef.current,
          nowMs: Date.now(),
          pinned,
          current,
        }),
      );

    evaluate();
    if (status.isConnected) return undefined;
    // One timer, fired when the run would first qualify. Re-evaluating on an interval would either
    // rearrange late or spend a wake-up a second for as long as the machine stays away.
    const elapsed = Date.now() - (unreachableSinceRef.current ?? Date.now());
    const timer = setTimeout(evaluate, Math.max(0, OFFLINE_SETTLE_MS - elapsed) + 1);
    return () => clearTimeout(timer);
  }, [status.isConnected, selectedDevice, pinned]);

  return offline;
};
