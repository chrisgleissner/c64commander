/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export class PlaybackClock {
  private baseMs = 0;
  private startedAt: number | null = null;

  start(now: number, reset = false) {
    if (reset) {
      this.baseMs = 0;
    }
    this.startedAt = now;
  }

  pause(now: number) {
    if (this.startedAt === null) return;
    const delta = Math.max(0, now - this.startedAt);
    this.baseMs += delta;
    this.startedAt = null;
  }

  resume(now: number) {
    if (this.startedAt !== null) return;
    this.startedAt = now;
  }

  stop(now: number, reset = false) {
    this.pause(now);
    if (reset) {
      this.baseMs = 0;
    }
  }

  reset() {
    this.baseMs = 0;
    this.startedAt = null;
  }

  hydrate(baseMs: number, startedAt: number | null) {
    this.baseMs = Math.max(0, baseMs);
    this.startedAt = startedAt;
  }

  current(now: number): number {
    if (this.startedAt === null) return this.baseMs;
    return this.baseMs + Math.max(0, now - this.startedAt);
  }
}

/**
 * Moves both playback clocks to `positionMs` within the current track after a seek, and returns the new
 * played total. The played clock spans the whole playlist and drives "Remaining", so it moves by the
 * distance seeked rather than being set to the position in this track.
 */
export const seekPlaybackClocks = (
  playedClock: Pick<PlaybackClock, "current" | "hydrate">,
  trackStartedAtRef: { current: number | null },
  { positionMs, elapsedMs, paused, now }: { positionMs: number; elapsedMs: number; paused: boolean; now: number },
): number => {
  const fromPositionMs = paused || trackStartedAtRef.current === null ? elapsedMs : now - trackStartedAtRef.current;
  const playedMs = Math.max(0, playedClock.current(now) + positionMs - fromPositionMs);
  trackStartedAtRef.current = now - positionMs;
  playedClock.hydrate(playedMs, paused ? null : now);
  return playedMs;
};
