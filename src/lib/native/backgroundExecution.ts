/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from "@capacitor/core";
import { getActiveAction } from "@/lib/tracing/actionTrace";
import { resolveNativeTraceContext, type NativeTraceContext } from "@/lib/native/nativeTraceContext";
import type { TransportCommand } from "@/lib/input/latchedCommandBus";

export type BackgroundAutoSkipDueEvent = {
  dueAtMs: number;
  firedAtMs: number;
};

/** A media button press (headset, lock screen, Bluetooth) relayed by the foreground service. */
export type BackgroundTransportCommandEvent = {
  command: TransportCommand;
};

/** Alias declared by BackgroundExecutionPlugin for android.permission.POST_NOTIFICATIONS. */
export const NOTIFICATIONS_PERMISSION_ALIAS = "notifications";

export type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

export type BackgroundExecutionPermissions = { notifications: PermissionState };

export type BackgroundExecutionEvents = {
  backgroundAutoSkipDue: BackgroundAutoSkipDueEvent;
  backgroundTransportCommand: BackgroundTransportCommandEvent;
};

export type BackgroundExecutionPlugin = {
  start: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
  stop: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
  /**
   * Tells the foreground service whether the session is playing or paused. A paused session keeps
   * its notification and MediaSession for a bounded grace period so a headset or lock-screen Play
   * still reaches the web layer (HARD27-007).
   */
  setPlaybackState: (options: { paused: boolean; traceContext?: NativeTraceContext }) => Promise<void>;
  setDueAtMs: (options: { dueAtMs: number | null; traceContext?: NativeTraceContext }) => Promise<void>;
  checkPermissions: () => Promise<BackgroundExecutionPermissions>;
  requestPermissions: (options: { permissions: string[] }) => Promise<BackgroundExecutionPermissions>;
  addListener: <E extends keyof BackgroundExecutionEvents>(
    eventName: E,
    listenerFunc: (event: BackgroundExecutionEvents[E]) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
};

const plugin = registerPlugin<BackgroundExecutionPlugin>("BackgroundExecution", {
  web: () => import("./backgroundExecution.web").then((m) => new m.BackgroundExecutionWeb()),
});

export const BackgroundExecution: BackgroundExecutionPlugin = {
  start: (options) =>
    plugin.start({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  stop: (options) =>
    plugin.stop({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  setPlaybackState: (options) =>
    plugin.setPlaybackState({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  setDueAtMs: (options) =>
    plugin.setDueAtMs({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  checkPermissions: () => plugin.checkPermissions(),
  requestPermissions: (options) => plugin.requestPermissions(options),
  addListener: (eventName, listenerFunc) => plugin.addListener(eventName, listenerFunc),
};

export const onBackgroundAutoSkipDue = async (listener: (event: BackgroundAutoSkipDueEvent) => void) => {
  return await BackgroundExecution.addListener("backgroundAutoSkipDue", listener);
};

export const onBackgroundTransportCommand = async (listener: (command: TransportCommand) => void) => {
  return await BackgroundExecution.addListener("backgroundTransportCommand", (event) => listener(event.command));
};
