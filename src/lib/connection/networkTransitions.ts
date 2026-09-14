/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  discoverConnection,
  getConnectionSnapshot,
  noteDeviceUnreachable,
  probeOnce,
} from "@/lib/connection/connectionManager";
import { isNetworkKnownOffline, recordNetworkStatus, subscribeNetworkEdges } from "@/lib/connection/networkStatusWatch";
import { readNativeNetworkStatus } from "@/lib/connection/offlineStartup";
import { registerUnreachableListener } from "@/lib/connection/reachabilityEvents";
import { addLog } from "@/lib/logging";
import { DeviceDiscovery } from "@/lib/native/deviceDiscovery";

/**
 * Coming home probes the device as soon as the network returns, and again while Wi-Fi settles,
 * rather than at the next background tick (5 s, backing off to 60 s). Leaving shows the device
 * offline at once, so polls stop and its absence is not reported as a fault. A device that stops
 * answering on a working network is confirmed by two probes before it is shown offline.
 */
export const RECONNECT_ATTEMPT_DELAYS_MS = [0, 500, 1000, 2000, 4000, 8000] as const;
export const UNREACHABLE_CONFIRM_DELAYS_MS = [0, 2000] as const;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let reconnectRun = 0;

export const reconnectWhenNetworkReturns = async () => {
  const run = ++reconnectRun;
  for (const delayMs of RECONNECT_ATTEMPT_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);
    if (run !== reconnectRun || isNetworkKnownOffline()) return;
    const { state } = getConnectionSnapshot();
    if (state === "REAL_CONNECTED") return;
    if (state !== "OFFLINE_NO_DEMO" && state !== "DEMO_ACTIVE") continue;
    await discoverConnection("background");
  }
};

const showDeviceOffline = async (reason: "network-lost" | "not-answering") => {
  await noteDeviceUnreachable(reason);
};

let confirmingUnreachable = false;

export const confirmDeviceUnreachable = async () => {
  if (confirmingUnreachable || getConnectionSnapshot().state !== "REAL_CONNECTED") return;
  if (isNetworkKnownOffline()) {
    await showDeviceOffline("network-lost");
    return;
  }
  confirmingUnreachable = true;
  try {
    for (const delayMs of UNREACHABLE_CONFIRM_DELAYS_MS) {
      if (delayMs > 0) await wait(delayMs);
      if (getConnectionSnapshot().state !== "REAL_CONNECTED") return;
      if (await probeOnce()) return;
    }
    await showDeviceOffline("not-answering");
  } finally {
    confirmingUnreachable = false;
  }
};

const handleNetworkEdge = (edge: "online" | "offline") => {
  addLog("info", edge === "offline" ? "Network lost on this device" : "Network available on this device");
  if (edge === "offline") {
    reconnectRun += 1;
    void showDeviceOffline("network-lost");
    return;
  }
  void reconnectWhenNetworkReturns();
};

// A hidden WebView may not run the listener when the network changes, so the answer is read again on return.
const handleVisibilityChange = () => {
  if (document.visibilityState !== "visible") return;
  void readNativeNetworkStatus().then(() => {
    const { state } = getConnectionSnapshot();
    if (!isNetworkKnownOffline() && (state === "OFFLINE_NO_DEMO" || state === "DEMO_ACTIVE")) {
      void reconnectWhenNetworkReturns();
    }
  });
};

export const installNetworkTransitions = () => {
  const unsubscribeEdges = subscribeNetworkEdges(handleNetworkEdge);
  const unregisterUnreachable = registerUnreachableListener(() => {
    void confirmDeviceUnreachable();
  });
  let removeNativeListener: (() => void) | null = null;
  let disposed = false;
  const noteEventsUnavailable = (error: unknown) =>
    addLog("info", "Network change events are unavailable; reconnection relies on background probes", {
      error: error instanceof Error ? error.message : String(error),
    });
  try {
    void DeviceDiscovery.addListener("networkStatusChange", recordNetworkStatus)
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeNativeListener = () => void handle.remove();
      })
      .catch(noteEventsUnavailable);
  } catch (error) {
    noteEventsUnavailable(error);
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    disposed = true;
    reconnectRun += 1;
    unsubscribeEdges();
    unregisterUnreachable();
    removeNativeListener?.();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
};
