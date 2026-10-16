/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { addLog } from "@/lib/logging";
import { reportUserError } from "@/lib/uiErrors";
import { createLatestIntentWriteLane, type LatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import {
  isBackgroundExecutionActive,
  setBackgroundExecutionPaused,
  startBackgroundExecution,
  stopBackgroundExecution,
} from "@/lib/native/backgroundExecutionManager";
import { BackgroundExecution } from "@/lib/native/backgroundExecution";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { resolveBackgroundExecutionAction } from "@/pages/playFiles/backgroundExecutionPolicy";
import { useBackgroundDueAtSync } from "@/pages/playFiles/hooks/useBackgroundDueAtSync";

/**
 * The Play page's Android background execution: the foreground service and wake lock that keep auto-advance running
 * with the screen off, the media-session paused state, and the auto-advance deadline mirrored to the native watchdog.
 */
export const usePlayBackgroundExecution = ({
  backgroundExecutionEnabled,
  isPlaying,
  isPaused,
  playlistEnded,
  trackInstanceId,
  autoAdvanceDueAtMs,
  autoAdvanceGuardRef,
  playbackStateRef,
  sessionRestoreSettled,
}: {
  backgroundExecutionEnabled: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  playlistEnded: boolean;
  trackInstanceId: number;
  autoAdvanceDueAtMs: number | null;
  autoAdvanceGuardRef: MutableRefObject<{ dueAtMs: number } | null>;
  playbackStateRef: MutableRefObject<{ isPlaying: boolean; isPaused: boolean }>;
  sessionRestoreSettled: boolean;
}) => {
  const backgroundDueWriteLaneRef = useRef<LatestIntentWriteLane<number | null> | null>(null);
  // Adopt an already-running background-execution session on remount (e.g. after
  // navigating away from Play while playing) instead of issuing a second start,
  // which would unbalance the manager's reference count and leak the wake lock
  // after Stop (BUG-025).
  const backgroundExecutionActiveRef = useRef(isBackgroundExecutionActive());
  // True once THIS Play instance has actually observed active playback. A fresh
  // instance adopts the running session above (BUG-025) but starts isPlaying=false
  // until its async session restore runs. A transient instance created during a
  // tab transition can therefore mount-and-unmount while still isPlaying=false and
  // would otherwise tear down the wake lock owned by the live playback session
  // (BUG-040). Only an instance that genuinely owned playback may release it.
  const hasObservedActivePlaybackRef = useRef(false);

  if (!backgroundDueWriteLaneRef.current) {
    backgroundDueWriteLaneRef.current = createLatestIntentWriteLane<number | null>({
      run: async (nextDueAtMs) => {
        await BackgroundExecution.setDueAtMs({ dueAtMs: nextDueAtMs });
      },
    });
  }

  const queueBackgroundDueAtUpdate = useCallback(async (nextDueAtMs: number | null) => {
    await backgroundDueWriteLaneRef.current?.schedule(nextDueAtMs);
  }, []);
  const queueBackgroundDueAtUpdateRef = useRef(queueBackgroundDueAtUpdate);
  useEffect(() => {
    queueBackgroundDueAtUpdateRef.current = queueBackgroundDueAtUpdate;
  }, [queueBackgroundDueAtUpdate]);
  const stopBackgroundExecutionRef = useRef(stopBackgroundExecution);
  useEffect(() => {
    stopBackgroundExecutionRef.current = stopBackgroundExecution;
  }, [stopBackgroundExecution]);
  const backgroundCleanupTrackInstanceIdRef = useRef(trackInstanceId);
  useEffect(() => {
    backgroundCleanupTrackInstanceIdRef.current = trackInstanceId;
  }, [trackInstanceId]);

  useEffect(() => {
    if (isPlaying) hasObservedActivePlaybackRef.current = true;
  }, [isPlaying]);

  useEffect(() => {
    const backgroundExecutionAction = resolveBackgroundExecutionAction({
      backgroundExecutionEnabled,
      backgroundExecutionActive: backgroundExecutionActiveRef.current,
      isPlaying,
      isPaused,
      playlistEnded,
    });
    if (backgroundExecutionAction === "start") {
      backgroundExecutionActiveRef.current = true;
      void startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
        context: { trackInstanceId },
      }).catch((error) => {
        reportUserError({
          operation: "startBackgroundExecution",
          title: "Background playback unavailable",
          description: "Foreground playback continues, but background auto-advance may be interrupted.",
          error,
          context: { trackInstanceId },
          // Playback itself succeeded; degraded background capability is a
          // notice, not a destructive error (ERROR_POLICY §1 S2).
          severity: "S2",
        });
      });
      void queueBackgroundDueAtUpdate(autoAdvanceDueAtMs);
      return;
    }
    if (backgroundExecutionAction === "publish-paused" || backgroundExecutionAction === "publish-playing") {
      // HARD27-007: a pause or resume of a live session updates the service in place. Stopping it
      // on pause released the MediaSession, so the headset Play that followed reached nothing.
      const paused = backgroundExecutionAction === "publish-paused";
      void setBackgroundExecutionPaused(paused, {
        source: "playback-controller",
        reason: paused ? "pause" : "resume",
        context: { trackInstanceId },
      }).catch((error) => {
        reportUserError({
          operation: "setBackgroundExecutionPaused",
          title: "Background playback state update failed",
          description: "Lock-screen and headset controls may not match the current playback state.",
          error,
          context: { trackInstanceId, paused },
          // System bookkeeping around a transport action the user already saw
          // succeed; diagnostics material, never a toast (ERROR_POLICY §3).
          background: true,
        });
      });
      return;
    }
    if (backgroundExecutionAction !== "stop") {
      return;
    }
    // Never let an instance that only adopted the running session (and has not
    // itself observed playback) stop it — that transient case is BUG-040. Keep
    // the adopted flag so a later restore on this instance does not double-start.
    if (!hasObservedActivePlaybackRef.current) {
      return;
    }
    backgroundExecutionActiveRef.current = false;
    void stopBackgroundExecution({
      source: "playback-controller",
      reason: "stop",
      context: { trackInstanceId },
    }).catch((error) => {
      reportUserError({
        operation: "stopBackgroundExecution",
        title: "Background playback cleanup failed",
        description: "Background playback guard could not be fully stopped.",
        error,
        context: { trackInstanceId, reason: "stop" },
        // Background guard cleanup is system work; failures are diagnostics
        // material, never a toast (ERROR_POLICY §3).
        background: true,
      });
    });
    void queueBackgroundDueAtUpdate(null);
  }, [
    autoAdvanceDueAtMs,
    backgroundExecutionEnabled,
    isPaused,
    isPlaying,
    queueBackgroundDueAtUpdate,
    trackInstanceId,
  ]);

  useEffect(
    () => () => {
      if (!backgroundExecutionActiveRef.current) return;
      const latestPlaybackState = playbackStateRef.current;
      // Keep the wake lock when this instance is still playing OR when it never
      // observed playback (a transient instance that only adopted the running
      // session must not release the live session's lock — BUG-040). A paused
      // session is kept too (HARD27-007): the service has already dropped its
      // wake lock and its own grace period bounds how long it survives, so
      // tabbing away from Play must not be what kills the headset controls.
      if (latestPlaybackState.isPlaying || !hasObservedActivePlaybackRef.current) {
        addLog("debug", "Leaving background playback guard active across Play page unmount", {
          trackInstanceId: backgroundCleanupTrackInstanceIdRef.current,
          dueAtMs: autoAdvanceGuardRef.current?.dueAtMs ?? null,
        });
        return;
      }
      backgroundExecutionActiveRef.current = false;
      void stopBackgroundExecutionRef
        .current({
          source: "playback-controller",
          reason: "cleanup",
          context: { trackInstanceId: backgroundCleanupTrackInstanceIdRef.current },
        })
        .catch((error) => {
          reportUserError({
            operation: "stopBackgroundExecution",
            title: "Background playback cleanup failed",
            description: "Background playback guard could not be fully stopped.",
            error,
            context: {
              trackInstanceId: backgroundCleanupTrackInstanceIdRef.current,
              reason: "cleanup",
            },
            // Unmount-time cleanup is never user-initiated (ERROR_POLICY §3).
            background: true,
          });
        });
      void queueBackgroundDueAtUpdateRef.current(null);
    },
    [],
  );

  useBackgroundDueAtSync({
    backgroundExecutionEnabled,
    backgroundExecutionActiveRef,
    isNativeAndroid: isNativePlatform() && getPlatform() === "android",
    sessionRestoreSettled,
    autoAdvanceDueAtMs,
    queueBackgroundDueAtUpdate,
  });

  return { queueBackgroundDueAtUpdateRef };
};
