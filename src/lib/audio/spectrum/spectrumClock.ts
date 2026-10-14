/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const SAMPLE_COUNT = 256;
const BEST_COUNT = 8;
const REFRESH_EVERY = 8;

/**
 * Relates the page clock (`performance.now`, milliseconds) to the native monotonic clock (nanoseconds),
 * so a frame can be asked for the sound that will be audible when it is shown. Each reply gives one
 * offset, wrong by at most half its round trip. The two clocks do not drift apart noticeably over
 * seconds, so the estimate is the mean of the offsets from the replies with the shortest round trips
 * among the last few hundred: a busy phone that slows every reply for a while then does not move it.
 */
export class NativeClockOffset {
  private readonly roundTripMs = new Float64Array(SAMPLE_COUNT).fill(Number.POSITIVE_INFINITY);
  private readonly offsetMs = new Float64Array(SAMPLE_COUNT);
  private next = 0;
  private added = 0;
  private estimateMs = 0;
  private haveEstimate = false;

  add(sentMs: number, receivedMs: number, nativeNanos: number): void {
    if (!(nativeNanos > 0) || receivedMs < sentMs) return;
    this.roundTripMs[this.next] = receivedMs - sentMs;
    this.offsetMs[this.next] = nativeNanos / 1e6 - (sentMs + receivedMs) / 2;
    this.next = (this.next + 1) % SAMPLE_COUNT;
    this.added += 1;
    if (!this.haveEstimate || this.added % REFRESH_EVERY === 0) this.refresh();
  }

  private refresh(): void {
    const filled = Math.min(this.added, SAMPLE_COUNT);
    const used = Math.min(BEST_COUNT, filled);
    let sum = 0;
    let previousLimit = -1;
    let previousIndex = -1;
    for (let rank = 0; rank < used; rank++) {
      let best = -1;
      for (let i = 0; i < filled; i++) {
        const rtt = this.roundTripMs[i];
        const ahead = rtt > previousLimit || (rtt === previousLimit && i > previousIndex);
        if (ahead && (best < 0 || rtt < this.roundTripMs[best])) best = i;
      }
      if (best < 0) break;
      sum += this.offsetMs[best];
      previousLimit = this.roundTripMs[best];
      previousIndex = best;
    }
    this.estimateMs = sum / used;
    this.haveEstimate = true;
  }

  get known(): boolean {
    return this.haveEstimate;
  }

  /** The page time, in milliseconds, at a native clock reading in nanoseconds. */
  pageMsAt(nativeNanos: number): number {
    return this.haveEstimate ? nativeNanos / 1e6 - this.estimateMs : 0;
  }

  /** The native clock reading, in nanoseconds, at a page time; 0 while no reply has been seen. */
  nativeNanosAt(pageMs: number): number {
    return this.haveEstimate ? Math.round((pageMs + this.estimateMs) * 1e6) : 0;
  }
}
