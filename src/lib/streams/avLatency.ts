/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Interactive A/V latency tracker for the space-triggered av-sync-key program.
 *
 * On each SPACE press (sent over Remote Input) the tracker records the press time, then the
 * arrival of the resulting video pop and audio pop, and measures per press:
 *   - press → see:  press time → the frame's JS render/observe time (what the user perceives).
 *   - press → hear: press time → the audio's JS observe time.
 *   - A/V offset:   the analyzer's WIRE-arrival audio↔video offset for the pop (its true sync,
 *                   independent of downstream buffering — the same metric the soak reports).
 *
 * press→see/hear use the JS observe clock (same clock as the press) so they measure the real
 * end-to-end user latency; the A/V offset uses the wire clock so it is not polluted by the
 * asymmetric receive latency. Pure and side-effect-free: the caller supplies every timestamp.
 *
 * Each of the three metrics is recorded INDEPENDENTLY, the instant its pop arrives — a press is
 * never held hostage waiting for the other two. So "press → see" appears the moment the flash is
 * rendered even if audio isn't playing, and a value never gets stuck because the analyzer failed to
 * pair the pops for the offset. A press counts as measured once it produces any pop; it counts as
 * missed only if it is superseded by the next press having produced no pop at all.
 */

export interface AvLatencyStats {
  /** Completed press→pop measurements since the last reset. */
  count: number;
  /** Presses whose pop never arrived (superseded by the next press). */
  missed: number;
  seeLastMs: number | null;
  seeP99Ms: number | null;
  hearLastMs: number | null;
  hearP99Ms: number | null;
  /** |audio − video| wire offset (ms). */
  offsetLastMs: number | null;
  offsetP99Ms: number | null;
}

interface Pending {
  pressMs: number;
  sawVideo: boolean;
  sawAudio: boolean;
  sawOffset: boolean;
}

/**
 * A pop must belong to the CURRENT press: one press is measured at a time, and the caller spaces
 * presses further apart than the end-to-end pop latency (~200 ms on hardware; the mocked E2E fires
 * one tap at a time). A pop arriving more than this after the press is stale — from an abandoned
 * earlier press — and is rejected so it cannot complete a mixed measurement against a newer press.
 */
const MAX_POP_WINDOW_MS = 5000;

const percentile = (sortedAsc: number[], p: number): number => {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
};

const p99 = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return percentile(
    [...values].sort((a, b) => a - b),
    99,
  );
};

export class AvLatencyTracker {
  private pending: Pending | null = null;
  private readonly see: number[] = [];
  private readonly hear: number[] = [];
  private readonly offset: number[] = [];
  private measured = 0;
  private missed = 0;

  /** Begin a measurement: SPACE was sent at `pressMs` (JS observe clock, e.g. performance.now). */
  markPress(pressMs: number): void {
    // Count the outgoing press as missed only if it produced NO pop at all before this one.
    if (this.pending && !this.pending.sawVideo && !this.pending.sawAudio) this.missed += 1;
    this.pending = { pressMs, sawVideo: false, sawAudio: false, sawOffset: false };
  }

  /** A video pop was rendered at `observeMs` (JS observe clock). Records press→see immediately. */
  onVideoPop(observeMs: number): void {
    if (!this.pending || this.pending.sawVideo || !this.belongsToPending(observeMs)) return;
    this.markMeasured();
    this.pending.sawVideo = true;
    this.see.push(observeMs - this.pending.pressMs);
  }

  /** An audio pop was observed at `observeMs` (JS observe clock). Records press→hear immediately. */
  onAudioPop(observeMs: number): void {
    if (!this.pending || this.pending.sawAudio || !this.belongsToPending(observeMs)) return;
    this.markMeasured();
    this.pending.sawAudio = true;
    this.hear.push(observeMs - this.pending.pressMs);
  }

  /** The analyzer matched the pop pair with this signed wire offset (audio − video, ms). */
  onMatchOffset(wireOffsetMs: number): void {
    if (!this.pending || this.pending.sawOffset) return;
    this.pending.sawOffset = true;
    this.offset.push(Math.abs(wireOffsetMs));
  }

  /** Count the current press as measured the first time it produces any pop. */
  private markMeasured(): void {
    if (this.pending && !this.pending.sawVideo && !this.pending.sawAudio) this.measured += 1;
  }

  /** True when a pop at `observeMs` plausibly belongs to the current press (after it, within window). */
  private belongsToPending(observeMs: number): boolean {
    const pending = this.pending;
    if (!pending) return false;
    return observeMs >= pending.pressMs && observeMs - pending.pressMs <= MAX_POP_WINDOW_MS;
  }

  getStats(): AvLatencyStats {
    const last = (a: number[]): number | null => (a.length ? a[a.length - 1] : null);
    return {
      count: this.measured,
      missed: this.missed,
      seeLastMs: last(this.see),
      seeP99Ms: p99(this.see),
      hearLastMs: last(this.hear),
      hearP99Ms: p99(this.hear),
      offsetLastMs: last(this.offset),
      offsetP99Ms: p99(this.offset),
    };
  }

  reset(): void {
    this.pending = null;
    this.see.length = 0;
    this.hear.length = 0;
    this.offset.length = 0;
    this.measured = 0;
    this.missed = 0;
  }
}
