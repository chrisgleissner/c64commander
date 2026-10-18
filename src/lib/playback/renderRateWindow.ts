/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The most recent per-chunk render rates, with their 99th percentile.
 *
 * The percentile is read on every scheduling pass and every statistics poll, while a rate is added once
 * per chunk. Sorting a copy of 4096 values on each read cost 80 ms of main-thread time in a seven second
 * profile while a tune played, so the percentile is kept until the next rate is recorded.
 */
export class RenderRateWindow {
  private readonly rates: Float64Array;
  private count = 0;
  private next = 0;
  private cachedP99: number | null = null;

  constructor(capacity: number) {
    this.rates = new Float64Array(capacity);
  }

  record(rate: number): void {
    this.rates[this.next] = rate;
    this.next = (this.next + 1) % this.rates.length;
    this.count = Math.min(this.count + 1, this.rates.length);
    this.cachedP99 = null;
  }

  /** 0 before the first rate. */
  p99(): number {
    if (this.count === 0) return 0;
    if (this.cachedP99 !== null) return this.cachedP99;
    const sorted = this.rates.slice(0, this.count).sort();
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
    this.cachedP99 = sorted[Math.max(0, index)];
    return this.cachedP99;
  }

  clear(): void {
    this.count = 0;
    this.next = 0;
    this.cachedP99 = null;
  }
}
