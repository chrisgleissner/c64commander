/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { getConnectionSnapshot, subscribeConnection, type ConnectionState } from "@/lib/connection/connectionManager";

/** Two probe timeouts: long enough for a device that is about to answer, short enough not to hold a song back. */
export const DISCOVERY_SETTLE_TIMEOUT_MS = 5000;

export const isDiscoveryPending = (state: ConnectionState): boolean => state === "UNKNOWN" || state === "DISCOVERING";

/** Resolves once discovery has reached an answer, or after `timeoutMs` if it has not. */
export const waitForDiscoveryToSettle = (
  timeoutMs: number = DISCOVERY_SETTLE_TIMEOUT_MS,
): Promise<"settled" | "timeout"> => {
  if (!isDiscoveryPending(getConnectionSnapshot().state)) return Promise.resolve("settled");
  return new Promise((resolve) => {
    const finish = (outcome: "settled" | "timeout") => {
      clearTimeout(timer);
      unsubscribe();
      if (outcome === "timeout") {
        addLog("info", "Connection discovery did not settle in time for a ROM decision", {
          waitedMs: timeoutMs,
          state: getConnectionSnapshot().state,
        });
      }
      resolve(outcome);
    };
    const unsubscribe = subscribeConnection(() => {
      if (!isDiscoveryPending(getConnectionSnapshot().state)) finish("settled");
    });
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
  });
};
