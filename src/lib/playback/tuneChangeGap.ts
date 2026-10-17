/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

/** A silence of this length is what the long-playback soak grader reports, so a longer gap is counted separately. */
export const LONG_TUNE_CHANGE_GAP_MS = 3000;

export interface TuneChangeGapStats {
  changes: number;
  longGaps: number;
  maxGapMs: number;
  totalGapMs: number;
  lastGapMs: number | null;
}

interface StartedTune {
  startedAtMs: number;
  endsAtMs: number | null;
}

const emptyStats = (): TuneChangeGapStats => ({
  changes: 0,
  longGaps: 0,
  maxGapMs: 0,
  totalGapMs: 0,
  lastGapMs: null,
});

/**
 * Measures the silence between one tune's audio ending at its songlength and the next tune's audio starting.
 * A tune started early overlaps its predecessor, so the gap is clamped at zero.
 */
export class TuneChangeGapTracker {
  private previous: StartedTune | null = null;
  private current = emptyStats();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** `durationMs` is the tune's songlength when known; `auto` is true when the playlist advanced by itself. */
  noteTuneAudioStarted(input: { durationMs: number | null; auto: boolean; label?: string }): number | null {
    const startedAtMs = this.now();
    const previous = this.previous;
    this.previous = {
      startedAtMs,
      endsAtMs: input.durationMs && input.durationMs > 0 ? startedAtMs + input.durationMs : null,
    };
    if (!input.auto || !previous || previous.endsAtMs === null) return null;

    const gapMs = Math.max(0, Math.round(startedAtMs - previous.endsAtMs));
    const long = gapMs >= LONG_TUNE_CHANGE_GAP_MS;
    this.current = {
      changes: this.current.changes + 1,
      longGaps: this.current.longGaps + (long ? 1 : 0),
      maxGapMs: Math.max(this.current.maxGapMs, gapMs),
      totalGapMs: this.current.totalGapMs + gapMs,
      lastGapMs: gapMs,
    };
    addLog(long ? "warn" : "info", "Tune change gap", {
      service: "local-sid",
      gapMs,
      previousPlayedMs: Math.round(startedAtMs - previous.startedAtMs),
      next: input.label ?? null,
    });
    return gapMs;
  }

  /** Forget the previous tune, so a stop followed by a fresh start is not measured as a gap. */
  reset(): void {
    this.previous = null;
  }

  stats(): TuneChangeGapStats {
    return { ...this.current };
  }

  clearStats(): void {
    this.current = emptyStats();
  }
}

export const tuneChangeGapTracker = new TuneChangeGapTracker();

(globalThis as Record<string, unknown>).__tuneChangeGaps = () => tuneChangeGapTracker.stats();
