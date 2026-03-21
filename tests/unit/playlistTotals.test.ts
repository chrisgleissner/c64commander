/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { calculatePlaylistTotals } from "@/lib/playback/playlistTotals";

describe("calculatePlaylistTotals", () => {
  it("returns undefined for empty durations array", () => {
    const totals = calculatePlaylistTotals([], 0);
    expect(totals.total).toBeUndefined();
    expect(totals.remaining).toBeUndefined();
  });

  it("returns dash when durations unknown", () => {
    const totals = calculatePlaylistTotals([5000, undefined], 0);
    expect(totals.total).toBeUndefined();
    expect(totals.remaining).toBeUndefined();
  });

  it("computes total and remaining based on played time", () => {
    const totals = calculatePlaylistTotals([5000, 7000, 4000], 3000);
    expect(totals.total).toBe(16000);
    expect(totals.remaining).toBe(13000);
  });

  it("uses total as remaining when played is zero", () => {
    const totals = calculatePlaylistTotals([1000, 2000], 0);
    expect(totals.total).toBe(3000);
    expect(totals.remaining).toBe(3000);
  });

  it("clamps remaining at zero when played exceeds total", () => {
    const totals = calculatePlaylistTotals([1000, 2000], 5000);
    expect(totals.total).toBe(3000);
    expect(totals.remaining).toBe(0);
  });

  it("handles null value cast as undefined via nullish coalescing in reduce", () => {
    // Covers the value ?? 0 branch: null passes the every(v !== undefined) check
    // but is treated as 0 in the reduce via ?? 0
    const totals = calculatePlaylistTotals([null as unknown as undefined], 0);
    expect(totals.total).toBe(0);
    expect(totals.remaining).toBe(0);
  });

  it("computes correct totals for 100k entries without degradation", () => {
    const count = 100_000;
    const durationMs = 180_000; // 3 minutes each
    const durations = Array.from({ length: count }, () => durationMs);
    const playedMs = 5 * durationMs; // 5 songs played

    const start = performance.now();
    const totals = calculatePlaylistTotals(durations, playedMs);
    const elapsed = performance.now() - start;

    expect(totals.total).toBe(count * durationMs);
    expect(totals.remaining).toBe((count - 5) * durationMs);
    // Must complete in under 500ms even on slow CI
    expect(elapsed).toBeLessThan(500);
  });
});
