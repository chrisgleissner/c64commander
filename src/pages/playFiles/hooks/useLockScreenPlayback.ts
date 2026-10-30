/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef } from "react";
import { lockScreenSeekChannel } from "@/lib/input/lockScreenSeekChannel";
import { addLog } from "@/lib/logging";
import {
  setBackgroundExecutionNowPlaying,
  setBackgroundExecutionPosition,
} from "@/lib/native/backgroundExecutionManager";
import { reportUserError } from "@/lib/uiErrors";
import {
  formatTuneAlbum,
  isPlaybackPositionJump,
  positionMsToFraction,
  type ObservedElapsed,
} from "@/pages/playFiles/lockScreenPlayback";
import { usePlaybackTimeEffect, type PlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";

type Options = {
  title: string | null;
  artist: string | null;
  durationMs: number | null;
  tuneNumber: number | null;
  tuneCount: number | null;
  trackInstanceId: number;
  playing: boolean;
  playbackTime: PlaybackTimeStore;
  /** From `resolveSeekToFraction`: the same answer the on-screen seek bar uses. */
  onSeekToFraction: ((fraction: number) => void) | undefined;
};

/**
 * What the lock screen, the notification shade and a headset know about the tune on Play: its name,
 * where it stands, and whether the seek bar may act (HARD27-040, QW-LS-02, QW-LS-03).
 *
 * The position is published on the edges that move it and never on a timer, because Android advances
 * the marker by itself while the state says playing. A seek is recognised from the elapsed time
 * leaving its own pace, so local and C64 seeks need no separate hook-up.
 */
export const useLockScreenPlayback = ({
  title,
  artist,
  durationMs,
  tuneNumber,
  tuneCount,
  trackInstanceId,
  playing,
  playbackTime,
  onSeekToFraction,
}: Options): void => {
  const seekable = onSeekToFraction !== undefined;
  const latest = useRef({ playing, seekable, trackInstanceId, durationMs, onSeekToFraction });
  latest.current = { playing, seekable, trackInstanceId, durationMs, onSeekToFraction };
  const observedElapsed = useRef<ObservedElapsed | null>(null);

  const album = formatTuneAlbum(tuneNumber, tuneCount);
  useEffect(() => {
    void setBackgroundExecutionNowPlaying(
      { title, artist, durationMs, album },
      { source: "playback-controller", reason: "now-playing", context: { trackInstanceId } },
    ).catch((error) => {
      reportUserError({
        operation: "setBackgroundExecutionNowPlaying",
        title: "Now-playing metadata update failed",
        description: "The lock-screen media control may not name the current tune.",
        error,
        context: { trackInstanceId },
        // The tune plays either way; a media control naming the wrong thing is
        // diagnostics material, never a toast (ERROR_POLICY §3).
        background: true,
      });
    });
  }, [durationMs, artist, title, album, trackInstanceId]);

  const publishPosition = useCallback((positionMs: number, reason: string) => {
    const { playing: isPlaying, seekable: canSeek, trackInstanceId: instanceId } = latest.current;
    observedElapsed.current = { elapsedMs: positionMs, atMs: Date.now() };
    void setBackgroundExecutionPosition(
      { positionMs, playing: isPlaying, seekable: canSeek },
      { source: "playback-controller", reason, context: { trackInstanceId: instanceId } },
    ).catch((error) => {
      reportUserError({
        operation: "setBackgroundExecutionPosition",
        title: "Lock-screen position update failed",
        description: "The lock-screen seek bar may not match the current position.",
        error,
        context: { trackInstanceId: instanceId, reason },
        background: true,
      });
    });
  }, []);

  useEffect(() => {
    publishPosition(playbackTime.read().elapsedMs, "playback-edge");
  }, [trackInstanceId, playing, durationMs, seekable, playbackTime, publishPosition]);

  const followClock = useCallback(
    ({ elapsedMs }: { elapsedMs: number }) => {
      const nowMs = Date.now();
      const jumped = isPlaybackPositionJump({
        last: observedElapsed.current,
        elapsedMs,
        nowMs,
        playing: latest.current.playing,
      });
      if (jumped) publishPosition(elapsedMs, "seek");
      else observedElapsed.current = { elapsedMs, atMs: nowMs };
    },
    [publishPosition],
  );
  usePlaybackTimeEffect(playbackTime, followClock);

  useEffect(
    () =>
      lockScreenSeekChannel.subscribe((positionMs) => {
        const { onSeekToFraction: seekTo, durationMs: lengthMs } = latest.current;
        const fraction = positionMsToFraction(positionMs, lengthMs ?? undefined);
        if (!seekTo || fraction === null) {
          addLog("warn", "Ignored a lock-screen seek: this tune cannot be seeked", {
            source: "lock-screen-seek",
            positionMs,
            hasSeekHandler: Boolean(seekTo),
            durationMs: lengthMs,
          });
          return;
        }
        seekTo(fraction);
      }),
    [],
  );
};
