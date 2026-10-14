/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getConnectionSnapshot, type ConnectionSnapshot } from "@/lib/connection/connectionManager";

export type CoarseConnectionSnapshot = Omit<
  ConnectionSnapshot,
  "lastProbeAtMs" | "lastProbeSucceededAtMs" | "lastProbeFailedAtMs"
>;

const shallowEqual = (a: object | null, b: object | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = Object.entries(a);
  const right = b as Record<string, unknown>;
  return left.length === Object.keys(b).length && left.every(([key, value]) => Object.is(right[key], value));
};

const sameCoarseFields = (a: CoarseConnectionSnapshot, b: CoarseConnectionSnapshot): boolean =>
  a.state === b.state &&
  a.lastDiscoveryTrigger === b.lastDiscoveryTrigger &&
  a.lastTransitionAtMs === b.lastTransitionAtMs &&
  a.lastProbeError === b.lastProbeError &&
  a.demoInterstitialVisible === b.demoInterstitialVisible &&
  a.demoInterstitialReason === b.demoInterstitialReason &&
  shallowEqual(a.deviceInfo, b.deviceInfo);

const toCoarse = (snapshot: ConnectionSnapshot): CoarseConnectionSnapshot => ({
  state: snapshot.state,
  lastDiscoveryTrigger: snapshot.lastDiscoveryTrigger,
  lastTransitionAtMs: snapshot.lastTransitionAtMs,
  lastProbeError: snapshot.lastProbeError,
  deviceInfo: snapshot.deviceInfo,
  demoInterstitialVisible: snapshot.demoInterstitialVisible,
  demoInterstitialReason: snapshot.demoInterstitialReason,
});

let source: ConnectionSnapshot | null = null;
let coarse: CoarseConnectionSnapshot | null = null;

/**
 * The connection snapshot without the probe timestamps. Every answer from the device moves those
 * timestamps, so a snapshot that carries them is a new object after each REST response, and every
 * component that reads the connection renders again. This one keeps its identity until something
 * a component can show or act on changes.
 */
export const getCoarseConnectionSnapshot = (): CoarseConnectionSnapshot => {
  const current = getConnectionSnapshot();
  if (current === source && coarse) return coarse;
  const next = toCoarse(current);
  source = current;
  if (!coarse || !sameCoarseFields(coarse, next)) coarse = next;
  return coarse;
};
