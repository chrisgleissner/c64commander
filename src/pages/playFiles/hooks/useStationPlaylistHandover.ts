/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { commitPlaylistSnapshot } from "@/pages/playFiles/playlistRepositorySync";
import {
  handoverForStationStart,
  isStationQueueEdited,
  lastTuneQueue,
  readSavedPlaylistWithRetry,
  rememberHandover,
  SAVED_PLAYLIST_READ,
  rememberedHandover,
  restoredPlaylistState,
  savedPlaylistRepositoryId,
  shouldRestorePlaylist,
  withAppendedStationItems,
  writeHandoverRecord,
  clearHandoverRecord,
  type StationHandover,
} from "@/pages/playFiles/stationPlaylistHandover";
import { SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";

const SAVED_PLAYLIST_REPOSITORY_ID = savedPlaylistRepositoryId(SHARED_PLAYLIST_STORAGE_KEY);

const persistSavedItems = (items: PlaylistItem[]) => {
  void commitPlaylistSnapshot({ playlistId: SAVED_PLAYLIST_REPOSITORY_ID, items }).catch((error: unknown) => {
    addErrorLog("Failed to store the playlist saved before SID Radio", {
      playlistId: SAVED_PLAYLIST_REPOSITORY_ID,
      itemCount: items.length,
      error: (error as Error)?.message ?? String(error),
    });
  });
};

export const PLAYLIST_RESTORED_TOAST = "Your playlist is back";
export const LAST_TUNE_TOAST = "This tune plays to its end, then your playlist comes back.";
export const SAVED_PLAYLIST_LOST_TOAST = "Your playlist from before SID Radio could not be read back";

export type UseStationPlaylistHandoverParams = {
  queue: {
    playlist: PlaylistItem[];
    setPlaylist: (value: React.SetStateAction<PlaylistItem[]>) => void;
    currentIndex: number;
    setCurrentIndex: (value: React.SetStateAction<number>) => void;
    selectedPlaylistIds: Set<string>;
    setSelectedPlaylistIds: (value: Set<string>) => void;
  };
  playback: {
    isPlaying: boolean;
    isPaused: boolean;
    playlistEnded: boolean;
    startPlaylist: (items: PlaylistItem[], startIndex: number, options: { replaceQueue: boolean }) => Promise<boolean>;
    stopPlayback: () => void;
    /** Read by the playback traversal: the stopped station's last tune must not repeat or shuffle on. */
    stationActiveRef: { current: boolean };
  };
  persistence: {
    /** The stored playlist and playback session have been applied, so they cannot overwrite a restore. */
    ready: boolean;
    readSavedPlaylist: (playlistId: string) => Promise<PlaylistItem[]>;
  };
  station: { active: boolean; resumeSettled: boolean; stop: () => void };
};

/**
 * Keeps the listener's playlist while a SID Radio station owns the queue, and gives it back.
 *
 * Any end of the station (Stop, Clear playlist, a start that failed) is seen as the station going
 * inactive. The tune then playing is kept as the whole queue, so it ends the queue and playback
 * stops there; the saved playlist is put back once nothing plays.
 */
export const useStationPlaylistHandover = (params: UseStationPlaylistHandoverParams) => {
  const { active: stationActive, resumeSettled } = params.station;
  const { ready } = params.persistence;
  const { isPlaying, isPaused, playlistEnded } = params.playback;
  const [handover, setHandoverState] = useState<StationHandover | null>(rememberedHandover);
  const [editedPromptOpen, setEditedPromptOpen] = useState(false);
  const handoverRef = useRef(handover);
  const latestRef = useRef(params);
  latestRef.current = params;
  const stationOrdersQueue = stationActive || handover?.phase === "finishing";
  params.playback.stationActiveRef.current = stationOrdersQueue;

  const commit = useCallback((next: StationHandover | null) => {
    handoverRef.current = next;
    rememberHandover(next);
    setHandoverState(next);
    if (next) writeHandoverRecord(next);
    else clearHandoverRecord();
  }, []);

  const discard = useCallback(() => {
    commit(null);
    persistSavedItems([]);
  }, [commit]);

  const startStationQueue = useCallback(
    async (items: PlaylistItem[]): Promise<boolean> => {
      const { queue, playback } = latestRef.current;
      const startQueue = async () => (await playback.startPlaylist(items, 0, { replaceQueue: true })) !== false;
      if (!items.length) return startQueue();
      const existing = handoverRef.current;
      const position = {
        playlist: queue.playlist,
        currentIndex: queue.currentIndex,
        selectedIds: queue.selectedPlaylistIds,
      };
      const next = handoverForStationStart(existing, position, items);
      commit(next);
      if (next.items && next.items !== existing?.items) persistSavedItems(next.items);
      const started = await startQueue();
      if (!started) {
        if (existing) commit(existing);
        else discard();
      } else if (!existing) {
        latestRef.current.queue.setSelectedPlaylistIds(new Set());
      }
      return started;
    },
    [commit, discard],
  );

  const appendStationItems = useCallback(
    (items: PlaylistItem[]) => {
      const current = handoverRef.current;
      if (current) commit(withAppendedStationItems(current, items));
      latestRef.current.queue.setPlaylist((prev) => [...prev, ...items]);
    },
    [commit],
  );

  const requestStop = useCallback(() => {
    const current = handoverRef.current;
    const { queue, station } = latestRef.current;
    if (current?.phase === "station" && isStationQueueEdited(queue.playlist, current.stationItemIds)) {
      setEditedPromptOpen(true);
      return;
    }
    station.stop();
  }, []);

  const keepStationTunes = useCallback(() => {
    setEditedPromptOpen(false);
    discard();
    latestRef.current.station.stop();
  }, [discard]);

  const returnToPlaylist = useCallback(() => {
    setEditedPromptOpen(false);
    latestRef.current.station.stop();
  }, []);

  const finishStation = useCallback(() => {
    const current = handoverRef.current;
    if (current?.phase !== "station") return;
    const { queue, playback } = latestRef.current;
    const lastTune = lastTuneQueue(queue.playlist, queue.currentIndex);
    const playsOutLastTune = playback.isPlaying && !playback.isPaused && lastTune.length > 0;
    if (playsOutLastTune) {
      queue.setPlaylist(lastTune);
      queue.setCurrentIndex(0);
      toast({ title: "SID Radio stopped", description: LAST_TUNE_TOAST });
    }
    // Whatever is queued now belongs to the station; only what is queued after this point is kept.
    const stationItemIds = [...new Set([...current.stationItemIds, ...queue.playlist.map((item) => item.id)])];
    commit({ ...current, stationItemIds, phase: "finishing", playsOutLastTune });
  }, [commit]);

  const wasStationActiveRef = useRef(stationActive);
  useEffect(() => {
    const wasActive = wasStationActiveRef.current;
    wasStationActiveRef.current = stationActive;
    if (wasActive && !stationActive) finishStation();
  }, [stationActive, finishStation]);

  // The station can end while Play is not mounted (SID Radio turned off in Settings), so no edge is
  // seen here. Once SID Radio has had its chance to resume, a station that did not come back is over.
  const strandedCheckDoneRef = useRef(false);
  useEffect(() => {
    if (strandedCheckDoneRef.current || !resumeSettled) return;
    strandedCheckDoneRef.current = true;
    if (stationActive || handoverRef.current?.phase !== "station") return;
    latestRef.current.station.stop();
    finishStation();
  }, [resumeSettled, stationActive, finishStation]);

  // After a restart only the record is left; the items come back from the playlist repository.
  const loadingRef = useRef(false);
  useEffect(() => {
    if (!handover || handover.items !== null || loadingRef.current) return;
    loadingRef.current = true;
    void readSavedPlaylistWithRetry(() => latestRef.current.persistence.readSavedPlaylist(SAVED_PLAYLIST_REPOSITORY_ID))
      .then((items) => {
        const current = handoverRef.current;
        if (!current || current.items !== null) return;
        commit({ ...current, items });
        addLog("info", "SID Radio: read back the playlist saved before the station", { itemCount: items.length });
      })
      .catch((error: unknown) => {
        addErrorLog("Failed to read back the playlist saved before SID Radio; giving it up", {
          playlistId: SAVED_PLAYLIST_REPOSITORY_ID,
          attempts: SAVED_PLAYLIST_READ.attempts,
          error: (error as Error)?.message ?? String(error),
          stack: (error as Error)?.stack,
        });
        // Left in place, the unreadable handover would hold the queue in station order indefinitely.
        if (handoverRef.current?.items === null) commit(null);
        toast({ title: SAVED_PLAYLIST_LOST_TOAST, variant: "destructive" });
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [handover, commit]);

  useEffect(() => {
    if (!shouldRestorePlaylist({ handover, ready, isPlaying, isPaused, playlistEnded })) return;
    // A second run of this effect for the same state (StrictMode) must not restore twice.
    if (handoverRef.current !== handover || !handover?.items) return;
    const { queue, playback } = latestRef.current;
    const restored = restoredPlaylistState({ ...handover, items: handover.items }, queue.playlist);
    if (isPlaying || isPaused) playback.stopPlayback();
    queue.setPlaylist(restored.playlist);
    queue.setCurrentIndex(restored.currentIndex);
    queue.setSelectedPlaylistIds(restored.selectedIds);
    discard();
    toast({ title: PLAYLIST_RESTORED_TOAST });
  }, [handover, ready, isPlaying, isPaused, playlistEnded, discard]);

  return {
    /** A station, or its last tune after Stop, owns the play order; the value `stationActiveRef` carries. */
    stationOrdersQueue,
    startStationQueue,
    appendStationItems,
    requestStop,
    editedPrompt: {
      open: editedPromptOpen,
      onKeepStationTunes: keepStationTunes,
      onReturnToPlaylist: returnToPlaylist,
      onDismiss: () => setEditedPromptOpen(false),
    },
  };
};
