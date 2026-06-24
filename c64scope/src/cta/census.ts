/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ---------------------------------------------------------------------------
// Scroll-to-fixed-point CTA census with logical-row identity (Section 11.4)
//
// For each scrollable scope the runner captures visible controls, scrolls by a
// bounded amount with overlap, re-captures, deduplicates by stable fingerprint
// key, and continues until two consecutive scrolls yield nothing new AND the end
// condition is observed. Virtualized lists are de-duplicated by logical row
// identity (the fingerprint key), not by recycled view instances.
//
// The fixed-point detection (CensusAccumulator) is pure and unit-tested. The
// driver (runScrollCensus) is a thin async loop over an injectable capture/scroll
// interface so it is deterministic and testable without a device.
// ---------------------------------------------------------------------------

export interface CensusAccumulatorOptions {
  /** Number of consecutive no-new-item scrolls required to declare a fixed point. */
  requiredEmptyScrolls?: number;
}

export interface SnapshotResult {
  /** Fingerprint keys newly discovered by this snapshot, in capture order. */
  newlyDiscovered: string[];
  /** Whether the census is considered exhausted after this snapshot. */
  exhausted: boolean;
}

export class CensusAccumulator {
  private readonly discovered = new Map<string, number>();
  private readonly firstSeenOrder: string[] = [];
  private consecutiveEmpty = 0;
  private readonly requiredEmptyScrolls: number;

  constructor(options: CensusAccumulatorOptions = {}) {
    this.requiredEmptyScrolls = options.requiredEmptyScrolls ?? 2;
  }

  /**
   * Record a snapshot. A snapshot that introduces at least one new key resets the
   * empty-scroll streak; a snapshot with no new keys advances it. Exhaustion is
   * declared once the streak reaches the required threshold and the end condition
   * has been observed, OR the end condition is observed with at least one empty
   * scroll (short lists).
   */
  addSnapshot(keys: readonly string[], scrollIndex: number, atEnd = false): SnapshotResult {
    const fresh: string[] = [];
    for (const key of keys) {
      if (!this.discovered.has(key)) {
        this.discovered.set(key, scrollIndex);
        this.firstSeenOrder.push(key);
        fresh.push(key);
      }
    }

    if (fresh.length === 0) {
      this.consecutiveEmpty += 1;
    } else {
      this.consecutiveEmpty = 0;
    }

    const thresholdMet = this.consecutiveEmpty >= this.requiredEmptyScrolls;
    const shortListDone = atEnd && this.consecutiveEmpty >= 1;
    return { newlyDiscovered: fresh, exhausted: thresholdMet || shortListDone };
  }

  size(): number {
    return this.discovered.size;
  }

  all(): string[] {
    return [...this.firstSeenOrder];
  }
}

// ---------------------------------------------------------------------------
// Injectable scroll driver
// ---------------------------------------------------------------------------

export interface ScrollDriver {
  /** Capture the fingerprint keys currently visible in the scrollable scope. */
  capture(): Promise<string[]>;
  /** Scroll by a bounded amount with overlap. Returns whether the end was reached. */
  scroll(): Promise<{ atEnd: boolean }>;
  /** Hard upper bound on scroll attempts for this scope. */
  readonly maxScrolls: number;
}

export type CensusStopReason = "fixed-point" | "at-end" | "max-scrolls" | "single-page";

export interface CensusResult {
  discovered: string[];
  scrollAttempts: number;
  stopReason: CensusStopReason;
}

/**
 * Drive a scrollable scope to its fixed point. An initial capture is taken
 * before any scroll. Each subsequent iteration scrolls (advancing the viewport
 * with overlap) then re-captures, de-duplicating by logical-row fingerprint
 * key. The census stops when the accumulator reaches its fixed point, when the
 * driver signals the end of the scope, or when maxScrolls is exceeded.
 */
export async function runScrollCensus(driver: ScrollDriver): Promise<CensusResult> {
  const accumulator = new CensusAccumulator();

  const initial = await driver.capture();
  let latest = accumulator.addSnapshot(initial, 0);

  if (initial.length === 0) {
    return { discovered: [], scrollAttempts: 0, stopReason: "single-page" };
  }

  let scrollAttempts = 0;
  let atEnd = false;

  while (!latest.exhausted && scrollAttempts < driver.maxScrolls && !atEnd) {
    const scrolled = await driver.scroll();
    scrollAttempts += 1;
    atEnd = scrolled.atEnd;

    const visible = await driver.capture();
    latest = accumulator.addSnapshot(visible, scrollAttempts, atEnd);
  }

  let stopReason: CensusStopReason;
  if (scrollAttempts === 0) {
    stopReason = "single-page";
  } else if (atEnd) {
    stopReason = "at-end";
  } else if (latest.exhausted) {
    stopReason = "fixed-point";
  } else {
    stopReason = "max-scrolls";
  }

  return {
    discovered: accumulator.all(),
    scrollAttempts,
    stopReason,
  };
}
