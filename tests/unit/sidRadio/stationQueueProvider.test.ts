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
  fileTrackOrdinals: [trackOrdinal],
});

/** Several subsongs of one `.sid` file: distinct ordinals, one file identity. */
const subsongsOfOneFile = (md5_48: string, ordinals: number[]): StationCandidate[] =>
  ordinals.map((trackOrdinal, index) => ({
    trackOrdinal,
    md5_48,
    songIndex: index + 1,
    score: 100 - trackOrdinal,
    reason: "similar" as const,
    fileTrackOrdinals: ordinals,
  }));

/** A scripted engine: returns the ordinals in `order`, respecting the exclude set. */
const scriptedEngine = (order: number[]) => {
  return async (excludeOrdinals: number[], _recentOrdinals: number[], count: number): Promise<StationResult> => {
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

describe("StationQueueProvider — the drifting query's aim (E1)", () => {
  it("tells the engine what was consumed most recently, most recent first", async () => {
    const seen: number[][] = [];
    const provider = new StationQueueProvider({
      computeCandidates: async (exclude, recent, count) => {
        seen.push(recent);
        return scriptedEngine([10, 11, 12, 13, 14, 15, 16, 17])(exclude, recent, count);
      },
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
      recentWindow: 3,
    });

    await provider.refill(2);
    expect(seen[0]).toEqual([]); // nothing has played yet
    await provider.refill(2);
    // 10 and 11 played, newest first, and the buffered batch means only one further compute.
    expect(provider.recentOrdinals).toEqual([13, 12, 11]);
  });

  it("caps the window at `recentWindow` and never widens it", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
      recentWindow: 4,
    });
    await provider.refill(9);
    expect(provider.recentOrdinals).toEqual([8, 7, 6, 5]);
  });

  /**
   * A resumed station is aimed by what it just played, not by the tile the listener tapped hours ago.
   * Without `initialRecent` the first refill after a restart drifts from the original seed instead of
   * from the tail of the session, and the sequence diverges.
   */
  it("resumes with the recent window it was given", async () => {
    const seen: number[][] = [];
    const provider = new StationQueueProvider({
      computeCandidates: async (exclude, recent, count) => {
        seen.push(recent);
        return scriptedEngine([20, 21, 22])(exclude, recent, count);
      },
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
      initialExclude: [5, 6, 7, 8],
      initialRecent: [8, 7, 6],
      recentWindow: 3,
    });
    await provider.refill(1);
    expect(seen[0]).toEqual([8, 7, 6]);
    expect(provider.recentOrdinals).toEqual([20, 8, 7]);
  });
});

describe("StationQueueProvider — one tune, not one ordinal (E2)", () => {
  it("retires every subsong of a file it plays a subsong of", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: async () => ({ candidates: subsongsOfOneFile("aaaaaaaaaaaa", [4, 5, 6]) }),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
    });

    const result = await provider.refill(3);

    // One tune, played once — not subsongs 1, 2 and 3 back to back.
    expect(result.items).toHaveLength(1);
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([4, 5, 6]);
    // The retired siblings never counted as played, so the query is not aimed at them.
    expect(provider.recentOrdinals).toEqual([4]);
  });

  /**
   * Retiring the siblings only prevents the *next* batch offering them if the engine is told. It is,
   * because the retired ordinals go into the same exclude set the engine already respects — so no
   * second mechanism is needed for the cross-batch case.
   */
  it("passes the retired siblings to the engine as exclusions", async () => {
    const excludeSeen: number[][] = [];
    const provider = new StationQueueProvider({
      computeCandidates: async (exclude) => {
        excludeSeen.push([...exclude].sort((a, b) => a - b));
        return { candidates: [subsongsOfOneFile("aaaaaaaaaaaa", [4, 5, 6])[0]] };
      },
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
    });

    await provider.refill(1);
    await provider.refill(1);

    expect(excludeSeen[0]).toEqual([]);
    expect(excludeSeen[1]).toEqual([4, 5, 6]);
  });
});
