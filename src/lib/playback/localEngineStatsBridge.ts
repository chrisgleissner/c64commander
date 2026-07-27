/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Folds polled {@link LocalSidStats} into the session-cumulative numbers the
 * §12.6 budgets are pinned on (Track B / LE3).
 *
 * The engine keeps its render throughput for the whole session, so
 * `renderMsPerSecP99` passes straight through. `audioUnderruns`, however, lives
 * on the chunk scheduler, which is rebuilt for every tune — so the counter
 * restarts at 0 on each auto-advance. Polling it naively would report only the
 * current tune's underruns and silently lose every earlier gap in a 30-track
 * soak. This accumulator banks the previous tune's total whenever it sees the
 * counter drop, which is the one observable signal that the scheduler was
 * replaced.
 */

/** The slice of `LocalSidStats` the blob needs. */
export interface LocalEngineStatsSample {
  renderMsPerSecP99: number;
  audioUnderruns: number;
}

/** Session-cumulative values mirrored to the SID Radio stats blob. */
export interface LocalEngineStatsTotals {
  renderMsPerSec: number;
  audioUnderruns: number;
}

export class LocalEngineStatsAccumulator {
  /** Underruns from tunes that have already finished. */
  private bankedUnderruns = 0;
  /** Last per-tune underrun level seen, to detect the per-tune reset. */
  private lastUnderruns = 0;

  /** Fold one poll of engine stats and return the cumulative totals. */
  sample({ renderMsPerSecP99, audioUnderruns }: LocalEngineStatsSample): LocalEngineStatsTotals {
    if (audioUnderruns < this.lastUnderruns) this.bankedUnderruns += this.lastUnderruns;
    this.lastUnderruns = audioUnderruns;
    return {
      renderMsPerSec: renderMsPerSecP99,
      audioUnderruns: this.bankedUnderruns + audioUnderruns,
    };
  }

  /** Start a fresh measurement session (a new station / soak). */
  reset(): void {
    this.bankedUnderruns = 0;
    this.lastUnderruns = 0;
  }
}
