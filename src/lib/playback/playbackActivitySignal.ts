/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * "Something started or stopped playing" — a bare notification, no state.
 *
 * It lives in its own module (like `streams/inputActivitySignal`) so the two
 * parties can both use it without importing each other: the playback controller
 * announces changes, and `activePlaybackSession` answers what is playing. Wiring
 * it directly between them would make an import cycle.
 *
 * Why a signal at all: whether a tune is playing is module-level truth that
 * outlives any React tree — a page can mount and unmount mid-tune — and nothing
 * else can tell React that such a fact has moved.
 */
const listeners = new Set<() => void>();

/** Subscribe to playback start/stop. Returns an unsubscribe. */
export const subscribePlaybackActivity = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Announce that playback started, stopped, paused or resumed. */
export const notifyPlaybackActivityChanged = (): void => {
  listeners.forEach((listener) => listener());
};
