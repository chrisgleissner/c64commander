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
let onlineSinceMs: number | null = null;
const listeners = new Set<EdgeListener>();

/** How long a returning network is given to reach the device before a failed request counts. */
export const NETWORK_SETTLE_MS = 10_000;

const isOffline = (status: NativeNetworkStatus | null) => status?.supported === true && status.online === false;

export const isNetworkKnownOffline = () => isOffline(lastStatus);

export const getLastNetworkStatus = () => lastStatus;

/** Wi-Fi that has just come back can still drop a request or two while the phone finds the device. */
export const isNetworkSettling = (now = Date.now()) =>
  onlineSinceMs !== null && now - onlineSinceMs < NETWORK_SETTLE_MS;

/** Records a status and reports an edge when the phone moves between "no network" and anything else. */
export const recordNetworkStatus = (status: NativeNetworkStatus) => {
  const wasOffline = isOffline(lastStatus);
  const known = lastStatus !== null;
  lastStatus = { online: status.online !== false, supported: status.supported === true };
  const nowOffline = isOffline(lastStatus);
  if (!known || wasOffline === nowOffline) return;
  const edge: NetworkEdge = nowOffline ? "offline" : "online";
  onlineSinceMs = nowOffline ? null : Date.now();
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
  onlineSinceMs = null;
  listeners.clear();
};
