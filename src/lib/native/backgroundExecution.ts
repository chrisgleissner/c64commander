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

/** A drag on the lock-screen seek bar. Not latched: it names an absolute position in one tune. */
export type BackgroundSeekRequestEvent = {
  positionMs: number;
};

export type BackgroundExecutionEvents = {
  backgroundAutoSkipDue: BackgroundAutoSkipDueEvent;
  backgroundTransportCommand: BackgroundTransportCommandEvent;
  backgroundSeekRequest: BackgroundSeekRequestEvent;
};

/**
 * What the lock screen and the notification say is playing. Every field is nullable because a tune
 * can carry none of them: a SID header names no author more often than not, and a length is only
 * known once the songlength database has been consulted. The album names the tune within a file
 * that holds several ("Tune 3 of 19").
 */
export type NowPlayingInfo = {
  title: string | null;
  artist: string | null;
  durationMs: number | null;
  album: string | null;
};

/**
 * Where the lock-screen control puts its position marker. Android advances it by itself while
 * `playing`, so this is sent on changes of course, not on a timer.
 */
export type PlaybackPositionInfo = {
  positionMs: number;
  playing: boolean;
  /** Whether the system may offer a seek bar that acts. */
  seekable: boolean;
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
  /**
   * Publishes the tune the session is playing, so the lock-screen media control names it and its
   * transport buttons are more than a guess at what is on (HARD27-040).
   */
  setNowPlaying: (options: NowPlayingInfo & { traceContext?: NativeTraceContext }) => Promise<void>;
  setPlaybackPosition: (options: PlaybackPositionInfo & { traceContext?: NativeTraceContext }) => Promise<void>;
  setDueAtMs: (options: { dueAtMs: number | null; traceContext?: NativeTraceContext }) => Promise<void>;
  /**
   * Tells the foreground service the web layer is alive while it plays. A session that goes quiet
   * for too long is shown as paused, because the activity that played it has been destroyed.
   */
  heartbeat: () => Promise<void>;
  /**
   * The resume request the activity was launched with (notification Play, or a tap on it after the
   * activity was destroyed). Returned once; null when there is none or it was already taken.
   */
  takeLaunchCommand: () => Promise<{ command: TransportCommand | null }>;
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
  setNowPlaying: (options) =>
    plugin.setNowPlaying({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  setPlaybackPosition: (options) =>
    plugin.setPlaybackPosition({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  setDueAtMs: (options) =>
    plugin.setDueAtMs({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  heartbeat: () => plugin.heartbeat(),
  takeLaunchCommand: () => plugin.takeLaunchCommand(),
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

export const onBackgroundSeekRequest = async (listener: (positionMs: number) => void) => {
  return await BackgroundExecution.addListener("backgroundSeekRequest", (event) => listener(event.positionMs));
};
