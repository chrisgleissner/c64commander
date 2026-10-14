/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const SAMPLE_COUNT = 32;

/**
 * Relates the page clock (`performance.now`, milliseconds) to the native monotonic clock (nanoseconds),
 * so a frame can be asked for the sound that will be audible when it is shown. Each reply gives one
 * offset, wrong by at most half its round trip; the sample with the shortest round trip among the last
 * few is the best estimate, so a slow reply never skews it.
 */
export class NativeClockOffset {
  private readonly roundTripMs = new Float64Array(SAMPLE_COUNT).fill(Number.POSITIVE_INFINITY);
  private readonly offsetMs = new Float64Array(SAMPLE_COUNT);
  private next = 0;
  private best = -1;

  add(sentMs: number, receivedMs: number, nativeNanos: number): void {
    if (!(nativeNanos > 0) || receivedMs < sentMs) return;
    this.roundTripMs[this.next] = receivedMs - sentMs;
    this.offsetMs[this.next] = nativeNanos / 1e6 - (sentMs + receivedMs) / 2;
    this.next = (this.next + 1) % SAMPLE_COUNT;
    let best = 0;
    for (let i = 1; i < SAMPLE_COUNT; i++) if (this.roundTripMs[i] < this.roundTripMs[best]) best = i;
    this.best = best;
  }

  get known(): boolean {
    return this.best >= 0;
  }

  /** The native clock reading, in nanoseconds, at a page time; 0 while no reply has been seen. */
  nativeNanosAt(pageMs: number): number {
    return this.best < 0 ? 0 : Math.round((pageMs + this.offsetMs[this.best]) * 1e6);
  }
}
