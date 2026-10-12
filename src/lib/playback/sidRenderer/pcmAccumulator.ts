/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isNativePcm, NativePcmBuffer, type CachedPcm, type PcmPayload } from "./pcmPayload";

const EMPTY_PCM = new Int16Array(0);

/**
 * A pre-render or lead-in as it grows, slice by slice.
 *
 * WASM slices are copied into one buffer sized from the requested length up front. Reallocating and
 * copying the whole buffer per slice is O(n²) in the number of slices: a three-minute tune copied
 * about 1.6 GB on the thread that also schedules audio, measured as a 250 ms dropout. Each view
 * handed out is a `subarray` of the filled prefix, not a copy.
 *
 * libSidplayEZ slices are frame ranges of one native buffer that the native renderer is filling, so
 * growing is just remembering how far it has got.
 */
export class PcmAccumulator {
  private js: Int16Array = EMPTY_PCM;
  private filled = 0;
  private native: NativePcmBuffer | null = null;

  /** Add one slice; `plannedSamples` is the whole render's expected size. Returns the grown view. */
  append(slice: PcmPayload, plannedSamples: number, channels: number): CachedPcm {
    if (isNativePcm(slice)) {
      this.native = new NativePcmBuffer(slice.bufferId, slice.startFrame + slice.frames, channels);
      return this.native;
    }
    const needed = this.filled + slice.length;
    if (this.js.length < needed) {
      // `Math.max` with a non-finite estimate is non-finite, and `new Int16Array(NaN)` has length
      // zero, which then throws on the very next write. Size to the write when the plan is unusable.
      const sized = new Int16Array(Number.isFinite(plannedSamples) ? Math.max(plannedSamples, needed) : needed);
      sized.set(this.js.subarray(0, this.filled), 0);
      this.js = sized;
    }
    this.js.set(slice, this.filled);
    this.filled = needed;
    return this.js.subarray(0, this.filled);
  }

  get samples(): number {
    return this.native ? this.native.length : this.filled;
  }

  /** The finished render, trimmed so a cache entry never pins more memory than its audio. */
  finish(): CachedPcm {
    const result = this.native ?? this.js.subarray(0, this.filled).slice();
    this.reset();
    return result;
  }

  /** Forget the render. Returns the native buffer it was growing, which the caller may release. */
  reset(): NativePcmBuffer | null {
    const native = this.native;
    this.js = EMPTY_PCM;
    this.filled = 0;
    this.native = null;
    return native;
  }

  /** The native buffer this render is growing, if it is one. */
  get nativeBuffer(): NativePcmBuffer | null {
    return this.native;
  }
}
