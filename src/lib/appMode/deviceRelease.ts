/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import {
  avMirrorNeedsStop,
  readAvMirrorRetargetState,
  stopAvMirrorForDeviceRetarget,
} from "@/lib/connection/deviceRetarget";
import { addLog } from "@/lib/logging";
import { hasActiveInputRelease, releaseActiveRemoteInput } from "@/lib/remoteInput/activeInputRelease";

type DeviceReleaseHandler = (signal: AbortSignal) => Promise<void>;

/** One bound for the whole release: the steps run side by side, so a slow machine costs this once. */
export const DEVICE_RELEASE_TIMEOUT_MS = 8000;

const handlers = new Set<DeviceReleaseHandler>();

/** A surface that holds the machine in a state of its own (a paused tune) registers how to give it back. */
export const registerDeviceRelease = (handler: DeviceReleaseHandler): (() => void) => {
  handlers.add(handler);
  return () => handlers.delete(handler);
};

/** Rejects when `signal` aborts, so a step that cannot be cancelled stops being waited for. */
export const untilAborted = <T>(task: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("The release was abandoned"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });

let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const isReleasingDevice = (): boolean => inFlight !== null;

export const subscribeDeviceRelease = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = () => listeners.forEach((listener) => listener());

const releaseSteps = (signal: AbortSignal): Array<[string, () => Promise<void>]> => [
  ...(hasActiveInputRelease()
    ? [["remote input", () => releaseActiveRemoteInput()] as [string, () => Promise<void>]]
    : []),
  ...(avMirrorNeedsStop(readAvMirrorRetargetState())
    ? [["Live View", () => stopAvMirrorForDeviceRetarget(null)] as [string, () => Promise<void>]]
    : []),
  ...[...handlers].map((handler): [string, () => Promise<void>] => ["playback", () => handler(signal)]),
];

const runRelease = async (): Promise<void> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEVICE_RELEASE_TIMEOUT_MS);
  try {
    const steps = releaseSteps(controller.signal);
    const outcomes = await Promise.allSettled(steps.map(([, step]) => untilAborted(step(), controller.signal)));
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "rejected") {
        addLog("warn", `Entering SID Player: could not release the device (${steps[index][0]})`, {
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          stack: outcome.reason instanceof Error ? outcome.reason.stack : undefined,
        });
      }
    });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * What the app leaves running on a connected machine when the person chooses SID Player: the tune, a
 * pause, Live View and held Remote Input. Music playing on the phone is not touched. Run before the mode
 * is saved, because the traffic gate closes with it. The steps run together under one bound, and a second
 * request while one runs waits for the same release.
 */
export const releaseDeviceForSidPlayer = (): Promise<void> => {
  if (getConnectionSnapshot().state !== "REAL_CONNECTED") return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = runRelease().finally(() => {
    inFlight = null;
    notify();
  });
  notify();
  return inFlight;
};
