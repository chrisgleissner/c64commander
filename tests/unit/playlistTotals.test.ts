/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { calculatePlaylistTotals } from "@/lib/playback/playlistTotals";

const MINUTES = 60_000;
const linear = (count: number) => Array.from({ length: count }, (_, index) => index);

describe("calculatePlaylistTotals", () => {
  it("returns undefined for empty durations array", () => {
    const totals = calculatePlaylistTotals([], null);
    expect(totals.total).toBeUndefined();
    expect(totals.remaining).toBeUndefined();
  });

  it("returns undefined totals while any duration is unknown", () => {
    const totals = calculatePlaylistTotals([5000, undefined], { playOrder: [0, 1], currentIndex: 0, elapsedMs: 0 });
    expect(totals.total).toBeUndefined();
    expect(totals.remaining).toBeUndefined();
  });

  it("reports the whole playlist as remaining when no item is current", () => {
    const totals = calculatePlaylistTotals([1000, 2000], { playOrder: [0, 1], currentIndex: -1, elapsedMs: 0 });
    expect(totals).toEqual({ total: 3000, remaining: 3000 });
  });

  it("counts only the rest of the last item when playing the last item, not total minus listening time", () => {
    const totals = calculatePlaylistTotals([3 * MINUTES, 3 * MINUTES], {
      playOrder: [0, 1],
      currentIndex: 1,
      elapsedMs: 5000,
    });
    expect(totals).toEqual({ total: 6 * MINUTES, remaining: 3 * MINUTES - 5000 });
  });

  it("counts every later item again after Previous returns to the first item", () => {
    const totals = calculatePlaylistTotals([5000, 7000, 4000], { playOrder: [0, 1, 2], currentIndex: 0, elapsedMs: 0 });
    expect(totals.remaining).toBe(16000);
  });

  it("follows the shuffled play order: only items after the current one in that order are still to come", () => {
    const totals = calculatePlaylistTotals([1000, 2000, 4000], {
      playOrder: [2, 0, 1],
      currentIndex: 0,
      elapsedMs: 250,
    });
    expect(totals.remaining).toBe(750 + 2000);
  });

  it("stops at the end of this pass, so items played earlier in the pass are not counted again even with repeat on", () => {
    const totals = calculatePlaylistTotals([1000, 2000, 4000], {
      playOrder: [0, 1, 2],
      currentIndex: 2,
      elapsedMs: 1000,
    });
    expect(totals.remaining).toBe(3000);
  });

  it("clamps the current item's remainder at zero when elapsed passes its duration", () => {
    const totals = calculatePlaylistTotals([1000, 2000], { playOrder: [0, 1], currentIndex: 0, elapsedMs: 5000 });
    expect(totals.remaining).toBe(2000);
  });

  it("computes correct totals for 100k entries without degradation", () => {
    const count = 100_000;
    const durationMs = 3 * MINUTES;
    const durations = Array.from({ length: count }, () => durationMs);

    const start = performance.now();
    const totals = calculatePlaylistTotals(durations, { playOrder: linear(count), currentIndex: 5, elapsedMs: 0 });
    const elapsed = performance.now() - start;

    expect(totals.total).toBe(count * durationMs);
    expect(totals.remaining).toBe((count - 5) * durationMs);
    expect(elapsed).toBeLessThan(500);
  });
});
