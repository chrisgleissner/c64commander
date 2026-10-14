/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import {
  getConnectionSnapshot,
  subscribeConnection,
  type ConnectionSnapshot,
} from "@/lib/connection/connectionManager";
import { getCoarseConnectionSnapshot, type CoarseConnectionSnapshot } from "@/lib/connection/coarseConnectionSnapshot";

/** The connection without probe timestamps; it changes when the state, the device or the probe error does. */
export function useConnectionState(): CoarseConnectionSnapshot {
  return useSyncExternalStore(subscribeConnection, getCoarseConnectionSnapshot, getCoarseConnectionSnapshot);
}

/** The whole connection, including the probe timestamps: it changes after every answer from the device. */
export function useConnectionProbeState(): ConnectionSnapshot {
  return useSyncExternalStore(subscribeConnection, getConnectionSnapshot, getConnectionSnapshot);
}
