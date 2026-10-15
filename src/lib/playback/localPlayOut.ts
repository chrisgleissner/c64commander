/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether the phone is still playing out a tune the playlist has already moved past.
 *
 * With the crossfade off, the next tune is started ahead of the current tune's songlength and the native
 * feed plays the current tune on to its end before the next tune's first sample. The playlist logic moves
 * on at the start of that play-out; what the listener hears moves on at its end. The Play page names what
 * is heard, so it follows this signal rather than the playlist.
 *
 * The play-out ends when the next tune's sink reports its own first sample heard, when anything else stops
 * the engine, or, if neither happens, at the deadline the play-out was started with plus
 * {@link LOCAL_PLAY_OUT_GRACE_MS}, so a lost report cannot hold the old title on screen.
 */
export type LocalPlayOut = {
  /** Wall-clock time by which the play-out should have ended. */
  endsAtMs: number;
};

/** What is left of a tune that ends at `endsAtSeconds` and stands at `positionSeconds`, at most `maxSeconds`. */
export const playOutSeconds = (endsAtSeconds: number | undefined, positionSeconds: number, maxSeconds: number) =>
  endsAtSeconds === undefined ? 0 : Math.min(maxSeconds, Math.max(0, endsAtSeconds - positionSeconds));

/** How long past its expected end a play-out is waited for; the end is estimated from the playhead. */
export const LOCAL_PLAY_OUT_GRACE_MS = 500;

let current: LocalPlayOut | null = null;
let deadline: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export const endLocalPlayOut = (): void => {
  if (deadline !== null) clearTimeout(deadline);
  deadline = null;
  if (current === null) return;
  current = null;
  notify();
};

export const beginLocalPlayOut = (seconds: number, nowMs = Date.now()): void => {
  if (deadline !== null) clearTimeout(deadline);
  current = { endsAtMs: nowMs + seconds * 1000 };
  deadline = setTimeout(endLocalPlayOut, seconds * 1000 + LOCAL_PLAY_OUT_GRACE_MS);
  notify();
};

export const readLocalPlayOut = (): LocalPlayOut | null => current;

export const subscribeLocalPlayOut = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
