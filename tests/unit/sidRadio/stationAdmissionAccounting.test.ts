/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Two defects found on the Pixel 4 against a deep, fully-ingested HVSC station.
 *
 * **The minimum-length rule was inert.** 46 of 47 queued tunes showed the 3:00 default duration and
 * a one-second subsong of `Commando.sid` was playing with the rule set to 15 s. The provider was
 * doing exactly what it was told: every duration lookup returned null, and an unknown length is
 * admitted so that a thin songlengths file cannot empty a station. Nothing counted how often that
 * happened, so a rule that never rejected anything looked identical to a rule with nothing to
 * reject. `unknownDurationAdmitted` is that missing number.
 *
 * **A refill issued ~25 engine computes, not one.** `lastRefillMs` read 3,834 ms against a 150 ms
 * budget at 84,282 exclusions. The per-compute cost was fine; the multiplier was not. A fixed
 * 24-candidate batch cannot yield 10 items when 98% of candidates are discarded, so the buffer ran
 * dry and the provider asked again, and again.
 */

import { describe, expect, it } from "vitest";

import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import type { StationCandidate, StationResult } from "@/lib/sidRadio/stationEngine";
import type { PlaylistItem } from "@/pages/playFiles/types";

const buildItem = ({ virtualPath, songIndex }: { virtualPath: string; songIndex: number }) =>
  ({ id: `${virtualPath}#${songIndex}`, path: virtualPath }) as unknown as PlaylistItem;

/** An engine that hands out consecutive ordinals forever, honouring the exclude set. */
const endlessEngine =
  (options: { startAt?: number } = {}) =>
  async (exclude: number[], _recent: number[], count: number): Promise<StationResult> => {
    const excluded = new Set(exclude);
    const candidates: StationCandidate[] = [];
    let ordinal = options.startAt ?? 0;
    while (candidates.length < count && ordinal < 500_000) {
      if (!excluded.has(ordinal)) {
        candidates.push({
          trackOrdinal: ordinal,
          md5_48: String(ordinal).padStart(12, "0"),
          songIndex: 1,
          score: 1,
          reason: "similar",
          fileTrackOrdinals: [ordinal],
        } as unknown as StationCandidate);
      }
      ordinal += 1;
    }
    return { candidates };
  };

describe("admission accounting", () => {
  it("counts a tune admitted only because its length could not be resolved", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      minSeconds: 15,
      resolveDuration: () => null,
      lookahead: 4,
    });

    const { items } = await provider.refill();

    expect(items).toHaveLength(4);
    // The rule did not reject anything, and that is the point: without this counter the queue looks
    // the same whether the songlengths answered "long enough" or did not answer at all.
    expect(provider.shortTracksSkipped).toBe(0);
    expect(provider.unknownDurationTracksAdmitted).toBe(4);
  });

  it("does not count a tune whose length was resolved and passed", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      minSeconds: 15,
      resolveDuration: () => 120,
      lookahead: 4,
    });

    await provider.refill();

    expect(provider.unknownDurationTracksAdmitted).toBe(0);
  });

  // `NaN < 15` is false, so a malformed length would slip through the comparison and be recorded as
  // a checked, long-enough tune. It is an unknown length and is counted as one.
  it("treats a malformed length as unknown rather than comparing it", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      minSeconds: 15,
      resolveDuration: () => Number.NaN,
      lookahead: 2,
    });

    const { items } = await provider.refill();

    expect(items).toHaveLength(2);
    expect(provider.unknownDurationTracksAdmitted).toBe(2);
    expect(provider.shortTracksSkipped).toBe(0);
  });

  it("counts a candidate dropped because its path did not resolve", async () => {
    let seen = 0;
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      // Every other candidate is a tune the installed HVSC does not have.
      resolvePath: (md5) => ((seen += 1) % 2 === 0 ? null : `/hvsc/${md5}.sid`),
      buildItem,
      lookahead: 4,
    });

    await provider.refill();

    expect(provider.unresolvedTracksSkipped).toBeGreaterThan(0);
  });

  it("accepts a tune of exactly the minimum and rejects one a second under", async () => {
    const durations = new Map<number, number>();
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      minSeconds: 15,
      resolveDuration: (virtualPath) => {
        const ordinal = Number(virtualPath.replace(/\D/g, ""));
        const seconds = ordinal % 2 === 0 ? 15 : 14;
        durations.set(ordinal, seconds);
        return seconds;
      },
      lookahead: 3,
    });

    const { items } = await provider.refill();

    expect(items).toHaveLength(3);
    expect(provider.shortTracksSkipped).toBeGreaterThan(0);
    // Every emitted item was a 15 s tune; the 14 s ones were all rejected.
    expect([...durations.values()].filter((s) => s === 14).length).toBe(provider.shortTracksSkipped);
  });
});

describe("refill batch sizing", () => {
  /** Counts engine calls while discarding `discard` of every candidate, as a device does. */
  const runAtYield = async (discard: number, refills: number) => {
    let calls = 0;
    let seen = 0;
    const provider = new StationQueueProvider({
      computeCandidates: async (exclude, recent, count) => {
        calls += 1;
        return endlessEngine()(exclude, recent, count);
      },
      resolvePath: (md5) => {
        seen += 1;
        return seen % Math.round(1 / (1 - discard)) === 0 ? `/hvsc/${md5}.sid` : null;
      },
      buildItem,
      lookahead: 10,
    });
    let emitted = 0;
    for (let i = 0; i < refills; i += 1) emitted += (await provider.refill()).items.length;
    return { calls, emitted, provider };
  };

  // The load-bearing assertion. At a 2% yield a fixed 24-candidate batch needs roughly 25 computes
  // per refill; sizing the batch from the observed yield needs a handful. Measured host-side at
  // 60,000 exclusions: 24.0 computes per refill before, 3.0 after, and 210 ms → 25 ms.
  it("issues a handful of computes per refill when almost every candidate is discarded", async () => {
    const { calls, emitted } = await runAtYield(0.98, 3);

    expect(emitted).toBe(30);
    // A fixed batch of 24 would be ~68 calls for these three refills.
    expect(calls).toBeLessThan(20);
  });

  it("still asks for a small batch when nearly every candidate resolves", async () => {
    const { calls, emitted } = await runAtYield(0, 3);

    expect(emitted).toBe(30);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it("reports the compute count and the yield it sized the batch from", async () => {
    const { provider } = await runAtYield(0.9, 2);

    expect(provider.engineComputeCalls).toBeGreaterThan(0);
    expect(provider.candidateYield).toBeGreaterThan(0);
    expect(provider.candidateYield).toBeLessThanOrEqual(1);
  });

  it("emits the same items whatever batch size it chose", async () => {
    // Determinism does not depend on how the provider paced its requests: the engine is asked for
    // an ordered stream and the provider consumes it in order, so a larger batch changes when a
    // compute happens and never which tunes come out.
    const collect = async (lookahead: number) => {
      const provider = new StationQueueProvider({
        computeCandidates: endlessEngine(),
        resolvePath: (md5) => `/hvsc/${md5}.sid`,
        buildItem,
        lookahead,
      });
      const all: string[] = [];
      for (let i = 0; i < 3; i += 1) for (const item of (await provider.refill()).items) all.push(item.id);
      return all;
    };

    expect(await collect(10)).toEqual(await collect(10));
  });
});

describe("the resolved duration reaches the queued item", () => {
  // The provider looks the length up to decide whether the tune is long enough and used to throw it
  // away, so every station item fell back to the three-minute default. Measured on the Pixel 4:
  // 27 of 82 queued rows carried a duration and every one of them read 3:00. The default also sets
  // the progress bar and the end of the track, so a thirty-second tune both read and behaved as
  // three minutes.
  it("passes the length it admitted the tune on to buildItem", async () => {
    const seen: Array<number | null> = [];
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem: ({ virtualPath, songIndex, durationSeconds }) => {
        seen.push(durationSeconds);
        return { id: `${virtualPath}#${songIndex}` } as unknown as PlaylistItem;
      },
      minSeconds: 15,
      resolveDuration: () => 96,
      lookahead: 3,
    });

    await provider.refill();

    expect(seen).toEqual([96, 96, 96]);
  });

  it("passes null when nothing could resolve the length", async () => {
    const seen: Array<number | null> = [];
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem: ({ virtualPath, songIndex, durationSeconds }) => {
        seen.push(durationSeconds);
        return { id: `${virtualPath}#${songIndex}` } as unknown as PlaylistItem;
      },
      minSeconds: 15,
      resolveDuration: () => null,
      lookahead: 2,
    });

    await provider.refill();

    expect(seen).toEqual([null, null]);
  });

  // The length is what the queue shows and what the track's end comes from, so it is resolved even
  // when there is no rule to enforce — otherwise turning filtering off would silently turn every
  // duration back into the default.
  it("still resolves the length when filtering is switched off", async () => {
    const seen: Array<number | null> = [];
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem: ({ virtualPath, songIndex, durationSeconds }) => {
        seen.push(durationSeconds);
        return { id: `${virtualPath}#${songIndex}` } as unknown as PlaylistItem;
      },
      minSeconds: 0,
      resolveDuration: () => 8,
      lookahead: 2,
    });

    const { items } = await provider.refill();

    // Admitted, because the rule is off — but its real length travels with it.
    expect(items).toHaveLength(2);
    expect(seen).toEqual([8, 8]);
    // And a missing length is not counted as slipping past a rule that is not in force.
    expect(provider.unknownDurationTracksAdmitted).toBe(0);
  });
});

describe("waiting for the path index before consuming anything", () => {
  // A station resumed on app start refills immediately, while the `md5_48 -> path` index is still
  // being built as a side effect of loading the HVSC songlengths. Measured on a Pixel 4 with all
  // 61,157 songs ingested: 2,454 candidates dropped as unresolved and none emitted. The refill
  // failing is not the worst of it — a candidate is consumed before it is resolved, so those 2,454
  // tracks joined the exclude set and could never be offered again.
  it("does not consume a single candidate before the index can answer", async () => {
    let indexReady = false;
    let resolved = 0;
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => {
        resolved += 1;
        return indexReady ? `/hvsc/${md5}.sid` : null;
      },
      buildItem,
      lookahead: 4,
      ensureResolvable: async () => {
        indexReady = true;
      },
    });

    const { items } = await provider.refill();

    expect(items).toHaveLength(4);
    expect(provider.unresolvedTracksSkipped).toBe(0);
    expect(provider.excludedOrdinals).toHaveLength(4);
    expect(resolved).toBe(4);
  });

  it("waits once, not before every refill", async () => {
    let waits = 0;
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      lookahead: 2,
      ensureResolvable: async () => {
        waits += 1;
      },
    });

    await provider.refill();
    await provider.refill();
    await provider.refill();

    expect(waits).toBe(1);
  });

  // An index that never loads must not stop the station trying: the empty refill that follows is
  // how that is reported, and refusing to proceed would turn a degraded station into a dead one.
  it("still refills when the wait rejects", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: endlessEngine(),
      resolvePath: (md5) => `/hvsc/${md5}.sid`,
      buildItem,
      lookahead: 3,
      ensureResolvable: async () => {
        throw new Error("index unavailable");
      },
    });

    expect((await provider.refill()).items).toHaveLength(3);
  });
});
