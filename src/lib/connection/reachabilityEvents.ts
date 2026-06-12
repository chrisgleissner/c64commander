/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DeviceInfo } from "@/lib/c64api";

export type ReachabilitySource = "rest" | "ftp" | "telnet";

type ReachabilityListener = (host: string, source: ReachabilitySource, deviceInfo: DeviceInfo | null) => void;

type ReachabilityEvent = {
  host: string;
  source: ReachabilitySource;
  deviceInfo: DeviceInfo | null;
};

const MAX_PENDING_REACHABILITY_EVENTS = 16;

let listener: ReachabilityListener | null = null;
const pendingEvents: ReachabilityEvent[] = [];

export const notifyReachable = (host: string, source: ReachabilitySource, deviceInfo: DeviceInfo | null = null) => {
  const event = { host, source, deviceInfo };
  if (!listener) {
    pendingEvents.push(event);
    if (pendingEvents.length > MAX_PENDING_REACHABILITY_EVENTS) {
      pendingEvents.shift();
    }
    return;
  }
  listener(event.host, event.source, event.deviceInfo);
};

export const registerReachabilityListener = (nextListener: ReachabilityListener) => {
  listener = nextListener;
  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();
    if (event) {
      nextListener(event.host, event.source, event.deviceInfo);
    }
  }
  return () => {
    if (listener === nextListener) {
      listener = null;
    }
  };
};
