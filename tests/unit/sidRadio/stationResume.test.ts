/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What a resumed station guarantees (D15 / G11), now that the query drifts.
 *
 * The whole loop is under test: the real {@link computeStation}, the real
 * {@link StationQueueProvider}, and the real persisted descriptor. A resumed station is aimed by what
 * it just played, so the descriptor has to carry that; nothing else in the tuple can stand in for it.
 *
 * The guarantee is that the continuation is a pure function of the persisted descriptor, and that
 * nothing is repeated or lost across the interruption. It is **not** that the resumed sequence equals
 * the sequence an uninterrupted station would have produced: a refill computes a batch larger than it
 * emits, and the un-emitted tail of that batch is in memory only. Those candidates were never
 * consumed, so they stay eligible and the resumed station simply recomputes from the state it saved.
 * That was already true before the query could drift; what is new is that it is now asserted.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_STATION_BALANCE, computeStation, type StationSeed } from "@/lib/sidRadio/stationEngine";
import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import { parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import {
  clearSidRadioSession,
  loadSidRadioSession,
  resumeRecentOrdinals,
  saveSidRadioSession,
  type SidRadioSessionDescriptor,
} from "@/lib/sidRadio/sidRadioSession";
import { buildTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

const FILES = 30;
const SUBSONGS_PER_FILE = 2;
const SHUFFLE_SEED = 0x51d;
const md5At = (fileIndex: number): string => `${fileIndex}`.padStart(12, "c");

/**
 * 30 two-subsong files. Two subsongs per file matter: they are what makes the exclude set differ from
 * the play order, so a resume that reads its aim off the exclude set gets a different answer.
 */
const multiSubsongBundle = (): SidcorrTinyBundle =>
  parseSidcorrTiny(
    buildTinyFixture({
      files: Array.from({ length: FILES }, (_, fileIndex) => ({
        md5_48: md5At(fileIndex),
        tracks: Array.from({ length: SUBSONGS_PER_FILE }, (_, subsong) => {
          const ordinal = fileIndex * SUBSONGS_PER_FILE + subsong;
          return {
            styleMask: 0b1,
            neighbors: [ordinal - 1, ordinal - 3, ordinal - 7].filter((target) => target >= 0),
          };
        }),
      })),
    }),
  );

const seed: StationSeed = { kind: "song", md5_48: md5At(FILES - 1) };

const buildProvider = (bundle: SidcorrTinyBundle, initialExclude: number[], initialRecent: number[]) =>
  new StationQueueProvider({
    lookahead: 5,
    initialExclude,
    initialRecent,
    computeCandidates: async (exclude, recent, count) =>
      computeStation({ bundle, seed, shuffleSeed: SHUFFLE_SEED, exclude, recent, limit: count }),
    resolvePath: (md5_48) => `/${md5_48}.sid`,
    buildItem: ({ virtualPath, trackOrdinal }) => ({ id: `radio:${trackOrdinal}`, path: virtualPath }) as never,
  });

const drain = async (provider: StationQueueProvider, refills: number): Promise<string[]> => {
  const ids: string[] = [];
  for (let index = 0; index < refills; index += 1) {
    const { items } = await provider.refill(5);
    ids.push(...items.map((item) => item.id));
  }
  return ids;
};

const descriptorFor = (provider: StationQueueProvider): SidRadioSessionDescriptor => ({
  seedKind: "song",
  seedLabel: "test tune",
  seed,
  styleFilter: null,
  shuffleSeed: SHUFFLE_SEED,
  rankingSnapshotId: "snapshot",
  excludeOrdinals: provider.excludedOrdinals,
  recentOrdinals: provider.recentOrdinals,
});

describe("a resumed station continues identically", () => {
  const bundle = multiSubsongBundle();

  beforeEach(() => {
    clearSidRadioSession();
  });

  const resumeFrom = (saved: SidRadioSessionDescriptor) =>
    buildProvider(bundle, saved.excludeOrdinals, resumeRecentOrdinals(saved, DEFAULT_STATION_BALANCE.recentWindow));

  it("serves one continuation, byte-identical for a given persisted descriptor", async () => {
    const first = buildProvider(bundle, [], []);
    const beforeRestart = await drain(first, 3);
    saveSidRadioSession(descriptorFor(first));

    const oneResume = await drain(resumeFrom(loadSidRadioSession()!), 3);
    const anotherResume = await drain(resumeFrom(loadSidRadioSession()!), 3);

    expect(beforeRestart.length).toBeGreaterThan(0);
    expect(oneResume.length).toBeGreaterThan(0);
    expect(oneResume).toEqual(anotherResume);
  });

  it("loses nothing and repeats nothing across the interruption", async () => {
    const uninterrupted = await drain(buildProvider(bundle, [], []), 6);

    const first = buildProvider(bundle, [], []);
    const beforeRestart = await drain(first, 3);
    saveSidRadioSession(descriptorFor(first));
    const afterRestart = await drain(resumeFrom(loadSidRadioSession()!), 3);

    const resumedRun = [...beforeRestart, ...afterRestart];
    expect(new Set(resumedRun).size).toBe(resumedRun.length);
    // The interruption costs no depth: the batch tail that was dropped was never consumed.
    expect(resumedRun.length).toBe(uninterrupted.length);
  });

  it("needs the persisted recent window: the exclude set is not a substitute for it", async () => {
    // The exclude set also holds the retired subsong siblings, which were never played. Aiming the
    // resumed query at its tail therefore points the station somewhere it has not been.
    const uninterrupted = await drain(buildProvider(bundle, [], []), 6);

    const first = buildProvider(bundle, [], []);
    const beforeRestart = await drain(first, 3);
    const excludeOrdinals = first.excludedOrdinals;

    const fromExcludeTail = buildProvider(
      bundle,
      excludeOrdinals,
      excludeOrdinals.slice(-DEFAULT_STATION_BALANCE.recentWindow).reverse(),
    );
    const afterRestart = await drain(fromExcludeTail, 3);

    expect([...beforeRestart, ...afterRestart]).not.toEqual(uninterrupted);
  });

  it("resumes a descriptor written before the query could drift, from the exclude tail", async () => {
    const first = buildProvider(bundle, [], []);
    await drain(first, 3);
    const legacy: SidRadioSessionDescriptor = { ...descriptorFor(first), recentOrdinals: undefined };

    const recent = resumeRecentOrdinals(legacy, DEFAULT_STATION_BALANCE.recentWindow);

    expect(recent).toHaveLength(DEFAULT_STATION_BALANCE.recentWindow);
    expect(await drain(buildProvider(bundle, legacy.excludeOrdinals, recent), 1)).not.toEqual([]);
  });

  it("never serves one file twice, whatever the interruption", async () => {
    const first = buildProvider(bundle, [], []);
    const beforeRestart = await drain(first, 3);
    saveSidRadioSession(descriptorFor(first));
    const saved = loadSidRadioSession()!;
    const afterRestart = await drain(
      buildProvider(bundle, saved.excludeOrdinals, resumeRecentOrdinals(saved, DEFAULT_STATION_BALANCE.recentWindow)),
      3,
    );

    const paths = [...beforeRestart, ...afterRestart];
    expect(new Set(paths).size).toBe(paths.length);
  });
});
