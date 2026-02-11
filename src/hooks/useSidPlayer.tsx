/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getC64API } from '@/lib/c64api';
import { BackgroundExecution } from '@/lib/native/backgroundExecution';
import { createSslPayload } from '@/lib/sid/sidUtils';

export type SidTrack = {
  id: string;
  title: string;
  source: 'hvsc' | 'local';
  path?: string;
  file?: File;
  data?: Uint8Array;
  durationMs?: number;
  songNr?: number;
  subsongCount?: number;
};

export type SidQueue = SidTrack[];

type SidPlayerContextValue = {
  queue: SidQueue;
  currentIndex: number;
  currentTrack: SidTrack | null;
  isPlaying: boolean;
  shuffle: boolean;
  elapsedMs: number;
  durationMs?: number;
  playQueue: (tracks: SidQueue, startIndex?: number) => Promise<void>;
  playTrack: (track: SidTrack) => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  setShuffle: (next: boolean) => void;
};

const SidPlayerContext = createContext<SidPlayerContextValue | null>(null);

const buildId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
  `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const resolveBlob = (track: SidTrack) => {
  if (track.file) return track.file;
  if (track.data) {
    return new Blob([track.data], { type: 'audio/sid' });
  }
  return null;
};

export function SidPlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<SidQueue>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const startedAtRef = useRef<number | null>(null);

  const currentTrack = useMemo(() => queue[currentIndex] ?? null, [queue, currentIndex]);

  const playTrackInternal = useCallback(async (track: SidTrack) => {
    const api = getC64API();
    const blob = resolveBlob(track);
    if (!blob) {
      throw new Error('Missing SID data.');
    }

    setElapsedMs(0);
    setDurationMs(track.durationMs);

    let sslBlob: Blob | undefined;
    if (track.durationMs && track.durationMs > 0) {
      const payload = createSslPayload(track.durationMs);
      sslBlob = new Blob([payload], { type: 'application/octet-stream' });
    }

    await api.playSidUpload(blob, track.songNr, sslBlob);
    startedAtRef.current = Date.now();
    setIsPlaying(true);
    BackgroundExecution.start().catch((error) => {
      console.warn('Background execution start failed', {
        trackId: track.id,
        error,
      });
    });
  }, []);

  const playTrack = useCallback(async (track: SidTrack) => {
    if (!track.id) {
      track.id = buildId();
    }
    setQueue([track]);
    setCurrentIndex(0);
    await playTrackInternal(track);
  }, [playTrackInternal]);

  const playQueue = useCallback(async (tracks: SidQueue, startIndex = 0) => {
    if (!tracks.length) return;
    const nextQueue = tracks.map((track) => ({ ...track, id: track.id || buildId() }));
    setQueue(nextQueue);
    setCurrentIndex(startIndex);
    await playTrackInternal(nextQueue[startIndex]);
  }, [playTrackInternal]);

  const next = useCallback(async () => {
    if (!queue.length) return;
    let nextIndex = currentIndex + 1;
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    }
    if (nextIndex >= queue.length) nextIndex = 0;
    setCurrentIndex(nextIndex);
    const nextTrack = queue[nextIndex];
    await playTrackInternal(nextTrack);
  }, [queue, currentIndex, shuffle, playTrackInternal]);

  const previous = useCallback(async () => {
    if (!queue.length) return;
    let nextIndex = currentIndex - 1;
    if (nextIndex < 0) nextIndex = queue.length - 1;
    setCurrentIndex(nextIndex);
    const nextTrack = queue[nextIndex];
    await playTrackInternal(nextTrack);
  }, [queue, currentIndex, playTrackInternal]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isPlaying || startedAtRef.current === null) return;
      const now = Date.now();
      const elapsed = now - startedAtRef.current;
      setElapsedMs(elapsed);
    }, 500);

    return () => window.clearInterval(timer);
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying || !durationMs) return;
    if (elapsedMs < durationMs) return;
    void next();
  }, [elapsedMs, durationMs, isPlaying, next]);

  useEffect(() => {
    return () => {
      BackgroundExecution.stop().catch((error) => {
        console.warn('Background execution stop failed', { error });
      });
    };
  }, []);

  const value: SidPlayerContextValue = {
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    shuffle,
    elapsedMs,
    durationMs,
    playQueue,
    playTrack,
    next,
    previous,
    setShuffle,
  };

  return <SidPlayerContext.Provider value={value}>{children}</SidPlayerContext.Provider>;
}

export const useSidPlayer = () => {
  const context = useContext(SidPlayerContext);
  if (!context) {
    throw new Error('useSidPlayer must be used within SidPlayerProvider');
  }
  return context;
};
