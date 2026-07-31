/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";

import { getC64API } from "@/lib/c64api";
import { syncDeviceSidModel } from "@/lib/playback/deviceSidModel";
import { useLocalSidModelFromDevice } from "@/lib/playback/useLocalSidModel";
import { useConnectionRoutingEpoch } from "@/hooks/useC64Connection";
import { useConnectionState } from "@/hooks/useConnectionState";

/**
 * Reads the connected Ultimate's SID revision once per connection and remembers it, so on-device
 * playback can fall back to the same chip the listener's own machine has.
 *
 * Mounted at the app root rather than on the Settings or Play screen, because the value has to be
 * learned whether or not the listener ever visits either — the whole point is that it is already
 * known by the time they play a tune away from the machine.
 *
 * Keyed on the connection routing epoch, so swapping devices re-reads against the machine that is
 * now connected instead of keeping the previous one's chip. Renders nothing, awaits nothing that
 * playback depends on, and cannot fail: {@link syncDeviceSidModel} swallows an unreachable device.
 *
 * Subscribes to the connection store directly rather than through `useC64Connection`, whose
 * `c64-info` query refetches on mount — a second consumer of it at the app root would add a device
 * request on every launch to answer a question that is not urgent.
 */
export function LocalSidModelDriver() {
  const connection = useConnectionState();
  const routingEpoch = useConnectionRoutingEpoch();
  const fromDevice = useLocalSidModelFromDevice();
  const connected = connection.state === "REAL_CONNECTED";

  useEffect(() => {
    // Demo mode is excluded by `connected`: its config tree is a fixture, and adopting a fixture's
    // chip as "the SID in your C64" would outlive the demo in a setting the user cannot see.
    if (!connected || !fromDevice) return;
    const api = getC64API();
    if (!api) return;
    void syncDeviceSidModel(api);
  }, [connected, fromDevice, routingEpoch]);

  return null;
}
