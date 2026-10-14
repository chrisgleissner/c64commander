/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

export type PlaybackTime = { readonly elapsedMs: number; readonly playedMs: number };

/**
 * The current tune's elapsed time and the session's played time, held outside React state so the per-second tick
 * re-renders only the components that show them rather than the whole Play page.
 */
export type PlaybackTimeStore = {
  read: () => PlaybackTime;
  setElapsedMs: (elapsedMs: number) => void;
  setPlayedMs: (playedMs: number) => void;
  set: (time: PlaybackTime) => void;
  /** Called after every change; a set to the current value is not a change. */
  subscribe: (listener: () => void) => () => void;
};

export const createPlaybackTimeStore = (initial: PlaybackTime = { elapsedMs: 0, playedMs: 0 }): PlaybackTimeStore => {
  let time = initial;
  const listeners = new Set<() => void>();
  const set = (next: PlaybackTime) => {
    if (Object.is(next.elapsedMs, time.elapsedMs) && Object.is(next.playedMs, time.playedMs)) return;
    time = { elapsedMs: next.elapsedMs, playedMs: next.playedMs };
    listeners.forEach((listener) => listener());
  };
  return {
    read: () => time,
    setElapsedMs: (elapsedMs) => set({ ...time, elapsedMs }),
    setPlayedMs: (playedMs) => set({ ...time, playedMs }),
    set,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/**
 * The store's time, re-rendering the caller when it changes.
 *
 * A state update rather than `useSyncExternalStore`, whose updates always render at sync priority on their own: a tune
 * change sets the clock alongside page state, and the time would be drawn once against the previous tune's duration.
 * A state update renders together with the page state set beside it.
 */
export const usePlaybackTime = (store: PlaybackTimeStore): PlaybackTime => {
  const [time, setTime] = useState(store.read);
  useEffect(() => {
    const follow = () => setTime(store.read());
    follow();
    return store.subscribe(follow);
  }, [store]);
  return time;
};

/**
 * Calls `onTime` with the store's time now and whenever `onTime` changes, as an effect would, and again after the
 * time changes. Changes made together (elapsed and played set one after the other) are reported once, after the code
 * that made them has finished.
 */
export const usePlaybackTimeEffect = (store: PlaybackTimeStore, onTime: (time: PlaybackTime) => void) => {
  useEffect(() => {
    let active = true;
    let scheduled = false;
    onTime(store.read());
    const unsubscribe = store.subscribe(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (active) onTime(store.read());
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store, onTime]);
};
