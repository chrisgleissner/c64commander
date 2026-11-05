/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef } from "react";

import { addLog } from "@/lib/logging";
import type { PlaybackRoute } from "@/lib/playback/playbackEngineRouting";
import type { SleepTimerMode } from "@/lib/playback/sleepTimer";
import { fadedVolumeIndex, SLEEP_TIMER_FADE_STEP_MS, sleepFadeStartsAtMs } from "@/lib/playback/sleepTimerFade";

import type { PlaybackVolumeBinding } from "@/pages/playFiles/playbackVolumeBinding";

type SleepFadeBinding = Pick<
  PlaybackVolumeBinding,
  "volumeIndex" | "volumeMuted" | "canControlVolume" | "onVolumeDraftChange" | "onVolumePreview" | "onVolumeCommit"
>;

type ActiveFade = {
  endsAtMs: number;
  beganAtMs: number;
  startIndex: number;
  route: PlaybackRoute;
  lastIndex: number;
};

/**
 * Lowers the playback volume over the last `SLEEP_TIMER_FADE_MS` of a timed sleep timer, through the
 * same volume control the listener uses, so the stop at the deadline is not abrupt.
 *
 * The listener's level is put back when the fade is abandoned (the timer is changed or switched off) and
 * after the stop it leads up to. On the C64 route the level after the stop is restored by the volume
 * session, which writes the pre-playback mixer levels back once playback ends; only the slider is reset here.
 */
export const useSleepTimerFade = ({
  mode,
  playing,
  route,
  binding,
}: {
  mode: SleepTimerMode;
  /** Sound is coming out: playing and not paused. A fade is held while nothing plays. */
  playing: boolean;
  /** Which output the volume control drives: this device's gain, or the Ultimate's mixer. */
  route: PlaybackRoute;
  binding: SleepFadeBinding;
}) => {
  const volumeRef = useRef({ route, binding });
  volumeRef.current = { route, binding };
  const fadeRef = useRef<ActiveFade | null>(null);

  const report = (operation: string, error: unknown) =>
    addLog("warn", `Sleep timer fade: ${operation} failed`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

  const restore = useCallback((afterStop: boolean) => {
    const fade = fadeRef.current;
    fadeRef.current = null;
    if (!fade) return;
    const { onVolumeCommit, onVolumeDraftChange } = volumeRef.current.binding;
    addLog("info", "Sleep timer fade: restoring the listener's volume", { afterStop, route: fade.route });
    if (afterStop && fade.route === "c64") {
      onVolumeDraftChange(fade.startIndex);
      return;
    }
    void Promise.resolve(onVolumeCommit(fade.startIndex)).catch((error: unknown) =>
      report("restoring the volume", error),
    );
  }, []);

  const endsAtMs = mode.kind === "timed" ? mode.endsAtMs : null;

  useEffect(() => {
    if (fadeRef.current && fadeRef.current.endsAtMs !== endsAtMs) restore(false);
  }, [endsAtMs, restore]);

  useEffect(() => {
    if (endsAtMs === null || !playing) return;
    const step = () => {
      const now = Date.now();
      if (now < sleepFadeStartsAtMs(endsAtMs) || now >= endsAtMs) return;
      const { binding: current, route: currentRoute } = volumeRef.current;
      if (!fadeRef.current) {
        if (!current.canControlVolume || current.volumeMuted || current.volumeIndex <= 0) return;
        fadeRef.current = {
          endsAtMs,
          beganAtMs: now,
          startIndex: current.volumeIndex,
          route: currentRoute,
          lastIndex: current.volumeIndex,
        };
        addLog("info", "Sleep timer fade: starting", { route: currentRoute, remainingMs: endsAtMs - now });
      }
      const fade = fadeRef.current;
      const next = fadedVolumeIndex(fade.startIndex, fade.beganAtMs, fade.endsAtMs, now);
      if (next === fade.lastIndex) return;
      fade.lastIndex = next;
      current.onVolumeDraftChange(next);
      void Promise.resolve(current.onVolumePreview(next)).catch((error: unknown) =>
        report("lowering the volume", error),
      );
    };
    step();
    const handle = window.setInterval(
      step,
      SLEEP_TIMER_FADE_STEP_MS[volumeRef.current.route === "local" ? "local" : "device"],
    );
    return () => window.clearInterval(handle);
  }, [endsAtMs, playing]);

  useEffect(() => () => restore(false), [restore]);

  /** Call after the stop at the deadline, to put the listener's level back for the next tune. */
  const finishAfterStop = useCallback(() => restore(true), [restore]);

  return { finishAfterStop };
};
