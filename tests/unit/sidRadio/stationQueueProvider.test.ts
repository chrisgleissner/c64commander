/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import type { StationCandidate, StationResult } from "@/lib/sidRadio/stationEngine";

const candidate = (trackOrdinal: number): StationCandidate => ({
  trackOrdinal,
  md5_48: `md${trackOrdinal.toString().padStart(10, "0")}`,
  songIndex: 1,
  score: 100 - trackOrdinal,
  reason: "similar",
});

/** A scripted engine: returns the ordinals in `order`, respecting the exclude set. */
const scriptedEngine = (order: number[]) => {
  return async (excludeOrdinals: number[], count: number): Promise<StationResult> => {
    const excluded = new Set(excludeOrdinals);
    const candidates = order
      .filter((o) => !excluded.has(o))
      .slice(0, count)
      .map(candidate);
    return { candidates, empty: candidates.length === 0 ? "exhausted" : undefined };
  };
};

const buildItem = ({ virtualPath, trackOrdinal }: { virtualPath: string; trackOrdinal: number }) =>
  ({
    id: `it:${trackOrdinal}`,
    request: { source: "hvsc", path: virtualPath },
    category: "sid",
    label: virtualPath,
    path: virtualPath,
  }) as never;

describe("StationQueueProvider", () => {
  it("leaves out tunes shorter than the minimum, and keeps going past them", async () => {
    // HVSC is not only music: it carries jingles, one-shot sound effects and test tones. A station
    // that serves them between pieces reads as broken. Skipped exactly like a tune whose path no
    // longer resolves — the ordinal is consumed, so the next refill asks the engine for somewhere
    // else rather than offering the same effect again.
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([1, 2, 3, 4, 5, 6]),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      minSeconds: 15,
      // Ordinals 1, 3 and 5 are two-second effects.
      resolveDuration: (virtualPath) =>
        [1, 3, 5].some((o) => virtualPath.includes(String(o).padStart(10, "0"))) ? 2 : 120,
      lookahead: 3,
    });

    const { items } = await provider.refill();

    expect(items).toHaveLength(3);
    expect(provider.shortTracksSkipped).toBe(3);
    // Every candidate it looked at is consumed, short ones included, so none comes round again.
    expect(provider.excludedOrdinals).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("admits a tune whose length is unknown", async () => {
    // Never drop a tune because the songlengths are thin: an absent duration is not a short one.
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([1, 2]),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      minSeconds: 15,
      resolveDuration: () => null,
      lookahead: 2,
    });

    const { items } = await provider.refill();

    expect(items).toHaveLength(2);
    expect(provider.shortTracksSkipped).toBe(0);
  });

  it("plays everything when the minimum is switched off", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([1, 2]),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      minSeconds: 0,
      resolveDuration: () => 1,
      lookahead: 2,
    });

    expect((await provider.refill()).items).toHaveLength(2);
  });

  it("resolves the next `count` items and advances the exclude set", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1, 2, 3, 4, 5]),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
    });
    const first = await provider.refill(2);
    expect(first.items).toHaveLength(2);
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1]);
    const second = await provider.refill(2);
    expect(second.items).toHaveLength(2);
    // No double-append: the second batch is different ordinals.
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("skips a candidate whose md5_48 no longer resolves (removed tune, §2.5)", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1, 2, 3]),
      // ordinal 1 and 2 are unresolved (removed by an HVSC update).
      resolvePath: (md5) => (md5 === candidate(1).md5_48 || md5 === candidate(2).md5_48 ? null : `/x/${md5}.sid`),
      buildItem,
    });
    const result = await provider.refill(2);
    // Emits 0 and 3 (skipping 1, 2) — no gap.
    expect(result.items).toHaveLength(2);
    // 1 and 2 were consumed (excluded) even though skipped.
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("keeps ~lookahead items queued by default", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine(Array.from({ length: 40 }, (_, i) => i)),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
      lookahead: 10,
    });
    const result = await provider.refill();
    expect(result.items).toHaveLength(10);
  });

  it("reports 'exhausted' when the engine runs out", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1]),
      resolvePath: () => null, // nothing resolves
      buildItem,
    });
    const result = await provider.refill(5);
    expect(result.items).toHaveLength(0);
    expect(result.reason).toBe("exhausted");
  });

  it("surfaces a 'no-neighbours' empty from the engine", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: async () => ({ candidates: [], empty: "no-neighbours" }),
      resolvePath: () => "/x.sid",
      buildItem,
    });
    const result = await provider.refill(3);
    expect(result.items).toEqual([]);
    expect(result.reason).toBe("no-neighbours");
  });

  it("honours an initial exclude set (resume)", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1, 2, 3]),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
      initialExclude: [0, 1],
    });
    const result = await provider.refill(2);
    expect(result.items).toHaveLength(2);
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
});
