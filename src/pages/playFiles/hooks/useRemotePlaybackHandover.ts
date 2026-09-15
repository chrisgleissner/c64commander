/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { addLog } from "@/lib/logging";
import { isRemotePlaybackActive } from "@/lib/playback/activePlaybackSession";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { getRememberedUltimateSidBlob, tryFetchUltimateSidBlob, type PlayRequest } from "@/lib/playback/playbackRouter";
import { buildRenderedTuneKey } from "@/lib/playback/renderedTuneCache";
import {
  noteTuneHandedOver,
  registerPageHandover,
  rememberRemoteTune,
  takeTuneHandedOverWithoutPage,
  wasTuneHandedOver,
} from "@/lib/playback/remoteTuneHandover";
import { toEngineTuneIndex } from "@/lib/playback/sidTuneIndex";
import { canPlayWithoutDevice } from "@/pages/playFiles/playableWithoutDevice";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * The Play page's part in carrying a SID from the C64 on to the phone (see remoteTuneHandover). While a tune
 * plays on the C64 the phone reads it and the next few from the Ultimate and renders the one playing, so the
 * tune can be picked up at the same position the moment the device is out of reach.
 */

/** How many of the tracks coming up are read from the Ultimate ahead of time. */
export const TRACKS_READ_AHEAD = 4;

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
  setCurrentPlaybackIsLocal: (isLocal: boolean) => void;
  resolveHvscRuntimeRequest: (item: PlaylistItem) => Promise<{ request: PlayRequest } | null>;
  resolveNextIndex: (from: number) => number | null;
  playItem: (item: PlaylistItem, options: { playlistIndex: number; origin: "auto" }) => Promise<void>;
  seekBy: (deltaSeconds: number) => Promise<void>;
};

export function useRemotePlaybackHandover(options: RemotePlaybackHandoverOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { isPlaying, isPaused, currentIndex, localEngineActive, durationMs } = options;
  // Read while rendering: a replayed track keeps its index and duration, and only its start time changes.
  const trackStartedAt = options.trackStartedAtRef.current;
  const remotePlaying = isRemotePlaybackActive();

  useEffect(() => {
    const current = optionsRef.current;
    // Not on a page that has yet to restore its session: the tune may still be playing on the C64.
    if (isPaused || localEngineActive || !remotePlaying) rememberRemoteTune(null);
    if (!isPlaying || isPaused || localEngineActive || !remotePlaying || !durationMs) return;
    const item = current.playlistRef.current[currentIndex];
    const startedAt = trackStartedAt;
    if (item?.category !== "sid" || startedAt === null || !LocalSidPlaybackController.isSupported()) return;
    const tuneIndex = toEngineTuneIndex(item.request.songNr);
    const renderKey = buildRenderedTuneKey(item.id, tuneIndex);
    const readBytes = () => readSidBytes(item, current.resolveHvscRuntimeRequest);
    rememberRemoteTune({ itemId: item.id, label: item.label, tuneIndex, renderKey, startedAt, durationMs, readBytes });
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await readBytes();
        if (cancelled || !bytes) return;
        const engine = current.getLocalSidPlayback();
        // Loaded as well as rendered: a first load at the moment the device goes is 1.7 s of silence on a Pixel 4.
        engine.preload();
        engine.prerender(renderKey, bytes, tuneIndex, durationMs / 1000);
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
  }, [isPlaying, isPaused, currentIndex, localEngineActive, durationMs, trackStartedAt, remotePlaying]);

  useEffect(() => {
    const carryOn = async () => {
      const current = optionsRef.current;
      const index = current.currentIndexRef.current;
      const item = current.playlistRef.current[index];
      const startedAt = current.trackStartedAtRef.current;
      if (!item || startedAt === null || !current.isPlayingRef.current || current.isPausedRef.current) return;
      if (current.currentPlaybackIsLocalRef.current || !isRemotePlaybackActive() || wasTuneHandedOver(startedAt))
        return;
      const duration = current.durationMsRef.current;
      if (!canPlayWithoutDevice(item) || (duration !== undefined && Date.now() - startedAt >= duration)) {
        addLog("info", "Playback: the C64 is out of reach and this tune cannot carry on here", { item: item.label });
        return;
      }
      noteTuneHandedOver(startedAt);
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

    // A tune taken over while this page was closed is playing on the phone already; the page makes it its own.
    const current = optionsRef.current;
    const item = current.playlistRef.current[current.currentIndexRef.current];
    if (current.isPlayingRef.current && item) {
      const adopted = takeTuneHandedOverWithoutPage();
      if (adopted === item.id && current.getLocalSidPlayback().isActive()) {
        current.setCurrentPlaybackIsLocal(true);
        addLog("info", "Playback: the Play page took over the tune playing on this phone", { item: item.label });
      }
    }
    if (getConnectionSnapshot().state === "OFFLINE_NO_DEMO") void carryOn();
    return registerPageHandover(() => void carryOn());
  }, [isPlaying]);
}
