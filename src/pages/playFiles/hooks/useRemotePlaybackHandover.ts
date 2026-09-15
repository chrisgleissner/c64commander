/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { getC64API, getC64APIConfigSnapshot } from "@/lib/c64api";
import { isAbortLikeError } from "@/lib/c64api/requestRuntime";
import { getConnectionSnapshot, subscribeConnection } from "@/lib/connection/connectionManager";
import { addLog } from "@/lib/logging";
import { isRemotePlaybackActive, markRemotePlaybackStopped } from "@/lib/playback/activePlaybackSession";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { getRememberedUltimateSidBlob, tryFetchUltimateSidBlob, type PlayRequest } from "@/lib/playback/playbackRouter";
import { buildRenderedTuneKey } from "@/lib/playback/renderedTuneCache";
import { toEngineTuneIndex } from "@/lib/playback/sidTuneIndex";
import { canPlayWithoutDevice } from "@/pages/playFiles/playableWithoutDevice";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * A SID playing on the Ultimate carries on on the phone when the phone leaves the network, with no question
 * asked. While it plays on the C64 the phone reads the tune and the next few from the Ultimate and renders
 * the one playing, so the phone can pick it up at the same position the moment the device is out of reach.
 */

/** How many of the tracks coming up are read from the Ultimate ahead of time. */
export const TRACKS_READ_AHEAD = 4;

const RESET_TIMEOUT_MS = 3000;
const RESET_SETTLE_MS = 1000;
const RESET_ATTEMPTS = 3;

const readSidBytes = async (
  item: PlaylistItem,
  resolveHvscRuntimeRequest: (item: PlaylistItem) => Promise<{ request: PlayRequest } | null>,
): Promise<ArrayBuffer | null> => {
  if (item.request.source === "ultimate") return (await tryFetchUltimateSidBlob(item.path))?.arrayBuffer() ?? null;
  const file = item.request.file ?? (await resolveHvscRuntimeRequest(item))?.request.file;
  return file ? file.arrayBuffer() : null;
};

type RemotePlaybackHandoverOptions = {
  playlistRef: MutableRefObject<PlaylistItem[]>;
  currentIndexRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  isPausedRef: MutableRefObject<boolean>;
  currentPlaybackIsLocalRef: MutableRefObject<boolean>;
  trackStartedAtRef: MutableRefObject<number | null>;
  durationMsRef: MutableRefObject<number | undefined>;
  isPlaying: boolean;
  isPaused: boolean;
  currentIndex: number;
  localEngineActive: boolean;
  durationMs: number | undefined;
  getLocalSidPlayback: () => LocalSidPlaybackController;
  resolveHvscRuntimeRequest: (item: PlaylistItem) => Promise<{ request: PlayRequest } | null>;
  resolveNextIndex: (from: number) => number | null;
  playItem: (item: PlaylistItem, options: { playlistIndex: number; origin: "auto" }) => Promise<void>;
  seekBy: (deltaSeconds: number) => Promise<void>;
};

export function useRemotePlaybackHandover(options: RemotePlaybackHandoverOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** The track start and device host of the tune handed to the phone, until the device is back. */
  const handedOverRef = useRef<{ startedAt: number; host: string } | null>(null);
  const { isPlaying, isPaused, currentIndex, localEngineActive, durationMs } = options;

  useEffect(() => {
    const current = optionsRef.current;
    if (!isPlaying || isPaused || localEngineActive || !isRemotePlaybackActive() || !durationMs) return;
    const item = current.playlistRef.current[currentIndex];
    if (item?.category !== "sid" || !LocalSidPlaybackController.isSupported()) return;
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await readSidBytes(item, current.resolveHvscRuntimeRequest);
        if (cancelled || !bytes) return;
        const tuneIndex = toEngineTuneIndex(item.request.songNr);
        const engine = current.getLocalSidPlayback();
        // Loaded as well as rendered: a first load at the moment the device goes is 1.7 s of silence on a Pixel 4.
        engine.preload();
        engine.prerender(buildRenderedTuneKey(item.id, tuneIndex), bytes, tuneIndex, durationMs / 1000);
        let index: number | null = currentIndex;
        for (let ahead = 0; ahead < TRACKS_READ_AHEAD && index !== null && !cancelled; ahead += 1) {
          index = current.resolveNextIndex(index);
          const upcoming = index === null ? undefined : current.playlistRef.current[index];
          if (upcoming?.category !== "sid" || upcoming.request.source !== "ultimate") continue;
          if (!getRememberedUltimateSidBlob(upcoming.path)) await tryFetchUltimateSidBlob(upcoming.path);
        }
      } catch (error) {
        addLog("debug", "Playback: could not read ahead for carrying on without the C64", {
          item: item.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPlaying, isPaused, currentIndex, localEngineActive, durationMs]);

  useEffect(() => {
    const carryOn = async () => {
      const current = optionsRef.current;
      const index = current.currentIndexRef.current;
      const item = current.playlistRef.current[index];
      const startedAt = current.trackStartedAtRef.current;
      if (!item || startedAt === null || !current.isPlayingRef.current || current.isPausedRef.current) return;
      if (current.currentPlaybackIsLocalRef.current || !isRemotePlaybackActive()) return;
      if (handedOverRef.current?.startedAt === startedAt) return;
      const duration = current.durationMsRef.current;
      if (!canPlayWithoutDevice(item) || (duration !== undefined && Date.now() - startedAt >= duration)) {
        addLog("info", "Playback: the C64 is out of reach and this tune cannot carry on here", { item: item.label });
        return;
      }
      handedOverRef.current = { startedAt, host: getC64APIConfigSnapshot().deviceHost };
      addLog("info", "Playback: the C64 is out of reach; carrying on with the tune on this phone", {
        item: item.label,
        positionSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
      });
      const controller = current.getLocalSidPlayback();
      const muted = controller.muted();
      // Silent until the seek lands, or the opening of the tune would be heard first.
      controller.setMuted(true);
      try {
        await current.playItem(item, { playlistIndex: index, origin: "auto" });
        if (!current.currentPlaybackIsLocalRef.current) return;
        await current.seekBy((Date.now() - startedAt) / 1000 - controller.positionSeconds());
      } catch (error) {
        addLog("warn", "Playback: could not carry on with the tune on this phone", {
          item: item.label,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.setMuted(muted);
      }
    };

    // Back home the C64 is still looping the tune it was playing; the phone finishes it, the next track goes back.
    const silenceTuneLeftOnDevice = async () => {
      const handedOver = handedOverRef.current;
      handedOverRef.current = null;
      if (!handedOver) return;
      // Reconnecting re-routes the API a moment after the state changes, which aborts a request sent at once.
      for (let attempt = 1; attempt <= RESET_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, RESET_SETTLE_MS));
        const stillThere = getConnectionSnapshot().state === "REAL_CONNECTED" && isRemotePlaybackActive();
        if (!stillThere || getC64APIConfigSnapshot().deviceHost !== handedOver.host) return;
        try {
          await Promise.race([
            getC64API().machineReset(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Reset timed out")), RESET_TIMEOUT_MS)),
          ]);
          markRemotePlaybackStopped();
          addLog("info", "Playback: stopped the tune left playing on the C64 while this phone was away");
          return;
        } catch (error) {
          if (attempt < RESET_ATTEMPTS && isAbortLikeError(error)) continue;
          addLog("warn", "Playback: could not stop the tune left playing on the C64", {
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
    };

    let previous = getConnectionSnapshot().state;
    if (previous === "OFFLINE_NO_DEMO") void carryOn();
    const unsubscribe = subscribeConnection(() => {
      const { state } = getConnectionSnapshot();
      const was = previous;
      previous = state;
      if (state === was) return;
      if (state === "OFFLINE_NO_DEMO") void carryOn();
      if (state === "REAL_CONNECTED") void silenceTuneLeftOnDevice();
    });
    return () => {
      unsubscribe();
    };
  }, [isPlaying]);
}
