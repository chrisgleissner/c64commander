/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { loadPlaybackEngine, type PlaybackEngine } from "@/lib/config/appSettings";
import { isRemotePlaybackActive } from "@/lib/playback/activePlaybackSession";
import type { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { updateSidRadioStats } from "@/lib/sidRadio/sidRadioStats";
import { isDeviceOutOfReach } from "@/pages/playFiles/playableWithoutDevice";
import type { PlaylistItem } from "@/pages/playFiles/types";

type PlaybackEngineSwitchOptions = {
  selectedEngineRef: MutableRefObject<PlaybackEngine>;
  /** Counts Stop presses; a move that a Stop overtook must not start the tune again. */
  stopCountRef: MutableRefObject<number>;
  currentPlaybackIsLocalRef: MutableRefObject<boolean>;
  currentIndexRef: MutableRefObject<number>;
  playlistRef: MutableRefObject<PlaylistItem[]>;
  isPlayingRef: MutableRefObject<boolean>;
  getLocalSidPlayback: () => LocalSidPlaybackController;
  setCurrentPlaybackIsLocal: (isLocal: boolean) => void;
  enqueuePlayTransition: (task: () => Promise<void>) => Promise<void>;
  playItem: (
    item: PlaylistItem,
    options: { playlistIndex: number; playlistSize: number; origin: "auto"; stopsAtRequest: number },
  ) => Promise<void>;
  /** Stops the tune on the C64. Reports its own failure; a tune that would not stop must not block the move. */
  stopOnC64: (item: PlaylistItem) => Promise<void>;
  onRestartFailed: (error: unknown, item: PlaylistItem) => void;
};

/**
 * Moving the playing SID when the listener changes where it plays (Track B, LE2, §12.5): stop it where it
 * sounds and start it again on the chosen engine, instead of waiting for the next track.
 *
 * Each move runs in the play-transition queue, after any launch still in flight, and decides what to stop
 * from what is sounding when its turn comes. Run straight away, a move reset the C64 before an earlier move's
 * launch had reached it, so that launch then started the tune there as well, and both played. A move
 * overtaken by a later one does nothing: the latest choice is the only one that counts.
 */
export function usePlaybackEngineSwitch(options: PlaybackEngineSwitchOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const latestMoveRef = useRef(0);

  useEffect(() => {
    const moveTune = async (move: number, startedAt: number, stopsAtRequest: number) => {
      const current = optionsRef.current;
      const isLatest = () => move === latestMoveRef.current && current.stopCountRef.current === stopsAtRequest;
      const decided: { restart?: { item: PlaylistItem; index: number } } = {};
      await current.enqueuePlayTransition(async () => {
        if (!isLatest()) return;
        const index = current.currentIndexRef.current;
        const item = current.playlistRef.current[index];
        // Only a playing SID can move between engines; anything else changes engine from the next track.
        if (!current.isPlayingRef.current || !item || item.category !== "sid") return;
        const wantsHere = loadPlaybackEngine() === "local";
        // From the engine, not this page's record: the phone's engine is shared, so a remounted page plays on it
        // without having started it, and the C64's streamed audio can take the speaker from it without telling us.
        const soundsHere = current.getLocalSidPlayback().isActive();
        const soundsOnC64 = isRemotePlaybackActive();
        // A tune playing here would only start again here, or not at all with the C64 out of reach.
        if (soundsHere && !soundsOnC64 && (wantsHere || isDeviceOutOfReach())) return;
        if (soundsOnC64 && !soundsHere && !wantsHere) return;
        if (soundsHere) current.getLocalSidPlayback().stop();
        current.setCurrentPlaybackIsLocal(false);
        if (soundsOnC64) await current.stopOnC64(item);
        decided.restart = { item, index };
      });
      if (!decided.restart || !isLatest()) return;
      const { item, index } = decided.restart;
      try {
        // `playItem` reads the engine setting itself, so the tune lands on the latest choice.
        await current.playItem(item, {
          playlistIndex: index,
          playlistSize: current.playlistRef.current.length,
          origin: "auto",
          stopsAtRequest,
        });
        // §12.6 `engineSwitchMs`: press → the tune is audible again.
        updateSidRadioStats({ engineSwitchMs: performance.now() - startedAt });
      } catch (error) {
        current.onRestartFailed(error, item);
      }
    };

    const onSettingsUpdated = () => {
      const current = optionsRef.current;
      const nextEngine = loadPlaybackEngine();
      if (nextEngine === current.selectedEngineRef.current) return;
      current.selectedEngineRef.current = nextEngine;
      latestMoveRef.current += 1;
      void moveTune(latestMoveRef.current, performance.now(), current.stopCountRef.current);
    };
    window.addEventListener("c64u-app-settings-updated", onSettingsUpdated);
    return () => window.removeEventListener("c64u-app-settings-updated", onSettingsUpdated);
  }, []);
}
