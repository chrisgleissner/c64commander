/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { NativeNetworkStatus } from "@/lib/native/deviceDiscovery";

/**
 * The phone's network state as last reported by the platform, so any module can ask synchronously
 * whether the network is known to be down: that decides whether a failed device request is the
 * expected result of leaving home or a problem worth reporting. It imports only a type, so tracing
 * and error classification can depend on it.
 */
export type NetworkEdge = "online" | "offline";

type EdgeListener = (edge: NetworkEdge) => void;

let lastStatus: NativeNetworkStatus | null = null;
const listeners = new Set<EdgeListener>();

const isOffline = (status: NativeNetworkStatus | null) => status?.supported === true && status.online === false;

export const isNetworkKnownOffline = () => isOffline(lastStatus);

export const getLastNetworkStatus = () => lastStatus;

/** Records a status and reports an edge when the phone moves between "no network" and anything else. */
export const recordNetworkStatus = (status: NativeNetworkStatus) => {
  const wasOffline = isOffline(lastStatus);
  const known = lastStatus !== null;
  lastStatus = { online: status.online !== false, supported: status.supported === true };
  const nowOffline = isOffline(lastStatus);
  if (!known || wasOffline === nowOffline) return;
  const edge: NetworkEdge = nowOffline ? "offline" : "online";
  listeners.forEach((listener) => listener(edge));
};

export const subscribeNetworkEdges = (listener: EdgeListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const resetNetworkStatusWatchForTests = () => {
  lastStatus = null;
  listeners.clear();
};
