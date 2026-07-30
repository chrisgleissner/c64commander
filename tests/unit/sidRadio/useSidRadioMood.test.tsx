/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The mood constraint from the entry point a listener actually uses, through the real worker core
 * and the real engine over a synthetic bundle.
 *
 * `useSidRadio.test.tsx` covers the station lifecycle against a hand-written candidate pool; these
 * tests need the genuine engine instead, because the property under test is a property of the walk:
 * a mocked pool would prove only that the hook passes an argument along.
 *
 * Every expectation about *which* tunes may be served comes from {@link admissibleOracle}, which
 * reads the fixture's declared edges and the bundle's style mask directly.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rebuildMd548PathIndex, resetMd548PathIndex } from "@/lib/sidRadio/md5PathIndex";
import { clearAllRankings, setRanking } from "@/lib/sidRadio/rankingStore";
import { getSidRadioStats } from "@/lib/sidRadio/sidRadioStats";
import { computeStationResponse, readyStatsFromBundle } from "@/lib/sidRadio/sidRadioWorkerCore";
import type { StationRequest } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import { DEFAULT_STATION_BALANCE, type StationResult } from "@/lib/sidRadio/stationEngine";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { SID_RADIO_STYLE_TILES, useSidRadio } from "@/pages/playFiles/hooks/useSidRadio";
import {
  MOOD,
  admissibleOracle,
  buildMoodBundle,
  everyTrackWithMood,
  fullMd5For,
  md548For,
} from "./moodStationFixture";

const bundle = buildMoodBundle();
const SEED = 0;
const SEED_LABEL = "Bouncy_Balls.sid";
const SHUFFLE_SEED = 4242;

/** The mood label a tile carries, so the chip's expectations read the way the UI does. */
const moodLabel = (bit: number) => SID_RADIO_STYLE_TILES.find((tile) => tile.bit === bit)!.label;

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
  resetMd548PathIndex();
  // "HVSC is installed": with an empty md5→path index nothing resolves and every empty station is
  // reported as a missing collection instead of a genuinely empty one.
  rebuildMd548PathIndex(";/MUSICIANS/T/Test/Test.sid\n0123456789abcdef0123456789abcdef=0:30\n", { force: true });
});

/**
 * A worker client that answers from the real engine.
 *
 * `holdNextComputeFor` parks the next compute carrying a given mood so a station can be superseded
 * while its batch is genuinely still in flight — the state the queue is served from if a superseded
 * result is ever allowed through.
 */
const makeEngineClient = () => {
  let holdFor: number | null | undefined;
  let releaseHeld: (() => void) | null = null;
  let gate: Promise<void> | null = null;

  const client = {
    load: vi.fn(async () => readyStatsFromBundle(bundle, false)),
    compute: vi.fn(async (request: StationRequest): Promise<StationResult> => {
      if (holdFor !== undefined && (request.styleFilter ?? null) === holdFor) {
        holdFor = undefined;
        await gate;
      }
      const response = computeStationResponse(bundle, 1, request);
      return response.type === "candidates"
        ? { candidates: response.candidates }
        : { candidates: [], empty: response.reason };
    }),
    terminate: vi.fn(),
    holdNextComputeFor(styleFilter: number | null) {
      holdFor = styleFilter;
      gate = new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });
    },
    releaseHeldCompute() {
      releaseHeld?.();
      releaseHeld = null;
    },
  };
  return client;
};

type EngineClient = ReturnType<typeof makeEngineClient>;

const baseParams = (client: EngineClient, overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  startPlaylist: vi.fn(),
  appendItems: vi.fn(),
  advanceToNext: vi.fn(),
  currentIndex: 0,
  playlistLength: 10,
  clientFactory: () => client as never,
  resolvePath: (md5_48: string) => `/HVSC/${md5_48}.sid`,
  randomSeed: () => SHUFFLE_SEED,
  ...overrides,
});

/** The track ordinal behind a queued item — the fixture gives each file a one-track md5. */
const ordinalOfItem = (item: PlaylistItem): number => Number.parseInt(item.path!.slice(6, 18), 16);

const ordinalsOf = (mock: ReturnType<typeof vi.fn>): number[] =>
  mock.mock.calls.flatMap((call) => (call[0] as PlaylistItem[]).map(ordinalOfItem));

const lastRequest = (client: EngineClient): StationRequest => client.compute.mock.calls.at(-1)![0] as StationRequest;

/** Every ordinal the station may serve for this mood, allowing the walk its full widening budget. */
const mayServe = (styleBit: number | null, extra: Record<string, unknown> = {}) =>
  admissibleOracle({
    bundle,
    seedOrdinals: [SEED],
    styleBit,
    hops: DEFAULT_STATION_BALANCE.maxHops,
    ...extra,
  });

const expectSatisfiesBothConditions = (ordinals: readonly number[], styleBit: number) => {
  expect(ordinals.length).toBeGreaterThan(0);
  const reachable = mayServe(styleBit);
  for (const ordinal of ordinals) {
    // Condition 1: the tune carries the mood, read straight off the bundle's style mask.
    expect(bundle.styleMask[ordinal] & (1 << styleBit)).not.toBe(0);
    // Condition 2: the tune is one the similarity walk from this seed can reach at all.
    expect(reachable.has(ordinal)).toBe(true);
  }
};

describe("useSidRadio — a Song station constrained to one mood", () => {
  it("starts with no constraint when no mood is chosen (All moods)", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio(md548For(SEED), SEED_LABEL);
    });
    expect(lastRequest(client).styleFilter).toBeNull();
    expect(result.current.station).toMatchObject({ seedKind: "song", seedLabel: SEED_LABEL, styleBit: null });
    const served = ordinalsOf(params.startPlaylist as ReturnType<typeof vi.fn>);
    expect(served.length).toBeGreaterThan(0);
    for (const ordinal of served) expect(mayServe(null).has(ordinal)).toBe(true);
  });

  for (const tile of SID_RADIO_STYLE_TILES) {
    it(`serves only tunes that are both similar to the seed and ${tile.label} when that mood is chosen`, async () => {
      const client = makeEngineClient();
      const params = baseParams(client);
      const { result } = renderHook(() => useSidRadio(params));
      await act(async () => {
        await result.current.startSongRadio(md548For(SEED), SEED_LABEL, tile.bit);
      });

      const admissible = mayServe(tile.bit);
      if (admissible.size === 0) {
        // Two different empty conditions, and both must be reported rather than widened: Game Themes
        // has no members at all, Deep Cuts has members the seed cannot reach.
        expect(result.current.active).toBe(false);
        expect(params.startPlaylist).not.toHaveBeenCalled();
        expect(result.current.notice).toBe(
          everyTrackWithMood(bundle, tile.bit).length === 0 ? "no-radio" : "no-radio-for-tune",
        );
        return;
      }

      expect(result.current.station).toMatchObject({ seedKind: "song", styleBit: tile.bit });
      expect(lastRequest(client).styleFilter).toBe(tile.bit);
      expectSatisfiesBothConditions(getSidRadioStats().emittedSequence, tile.bit);
      expectSatisfiesBothConditions(ordinalsOf(params.startPlaylist as ReturnType<typeof vi.fn>), tile.bit);
    });
  }

  it("keeps serving a sparse mood by widening the walk rather than reporting the station empty", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.experimental);
    });
    // Two of the three Experimental tunes are reachable; the third is in the isolated component.
    expect(ordinalsOf(params.startPlaylist as ReturnType<typeof vi.fn>).sort((a, b) => a - b)).toEqual([7, 23]);
    expect(result.current.notice).toBeNull();
    expect(result.current.active).toBe(true);
  });

  it("composes the mood with the minimum-length rule", async () => {
    const client = makeEngineClient();
    // Ordinal 7 is Experimental and reachable, and two seconds long — a sound effect, not a tune.
    const params = baseParams(client, {
      resolveDurationSeconds: (virtualPath: string) => (virtualPath.includes(md548For(7)) ? 2 : 120),
    });
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.experimental);
    });
    expect(ordinalsOf(params.startPlaylist as ReturnType<typeof vi.fn>)).toEqual([23]);
  });

  it("composes the mood with ✕ (not-for-me)", async () => {
    await setRanking(fullMd5For(7), "notForMe");
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.experimental);
    });
    expect(ordinalsOf(params.startPlaylist as ReturnType<typeof vi.fn>)).toEqual([23]);
  });

  it("composes the mood with the already-played exclusion as the queue refills", async () => {
    const client = makeEngineClient();
    const params = baseParams(client, { currentIndex: 0, playlistLength: 10 });
    const { result, rerender } = renderHook((p: ReturnType<typeof baseParams>) => useSidRadio(p), {
      initialProps: params,
    });
    await act(async () => {
      await result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.fastPaced);
    });
    await act(async () => {
      rerender({ ...params, currentIndex: 8, playlistLength: 10 });
    });
    await waitFor(() => expect(params.appendItems).toHaveBeenCalled());

    const first = ordinalsOf(params.startPlaylist as ReturnType<typeof vi.fn>);
    const refilled = ordinalsOf(params.appendItems as ReturnType<typeof vi.fn>);
    // Nothing is served twice, and the refill obeys the mood exactly as the first batch did.
    expect(refilled.filter((ordinal) => first.includes(ordinal))).toEqual([]);
    expectSatisfiesBothConditions(refilled, MOOD.fastPaced);
  });
});

/**
 * Changing the mood keeps the tune the station was seeded by, and supersedes everything the previous
 * constraint had in flight. The two moods used here are deliberately disjoint — Fast-Paced is every
 * even ordinal and Chill / Ambient every odd one — so a single leaked track is unambiguous.
 */
describe("useSidRadio — changing the mood of a running Song station", () => {
  const startFastPaced = async (client: EngineClient, params: ReturnType<typeof baseParams>) => {
    const hook = renderHook((p: ReturnType<typeof baseParams>) => useSidRadio(p), { initialProps: params });
    await act(async () => {
      await hook.result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.fastPaced);
    });
    return hook;
  };

  it("keeps the song seed, replaces the queue, and serves only the new mood", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = await startFastPaced(client, params);

    await act(async () => {
      await result.current.setSongStationStyleFilter(MOOD.slowAmbient);
    });

    expect(lastRequest(client).seed).toEqual({ kind: "song", md5_48: md548For(SEED) });
    expect(result.current.station).toMatchObject({
      seedKind: "song",
      seedLabel: SEED_LABEL,
      styleBit: MOOD.slowAmbient,
    });
    // The queue was replaced rather than extended: a second start, not an append.
    expect(params.startPlaylist).toHaveBeenCalledTimes(2);
    expect(params.appendItems).not.toHaveBeenCalled();
    const replaced = (params.startPlaylist as ReturnType<typeof vi.fn>).mock.calls[1][0] as PlaylistItem[];
    expectSatisfiesBothConditions(replaced.map(ordinalOfItem), MOOD.slowAmbient);
  });

  it("resets the station history so the emitted sequence describes one station", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = await startFastPaced(client, params);
    const beforeChange = [...getSidRadioStats().emittedSequence];
    expect(beforeChange.length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.setSongStationStyleFilter(MOOD.slowAmbient);
    });

    const replaced = (params.startPlaylist as ReturnType<typeof vi.fn>).mock.calls[1][0] as PlaylistItem[];
    const afterChange = getSidRadioStats().emittedSequence;
    expect(afterChange).toHaveLength(replaced.length);
    expectSatisfiesBothConditions(afterChange, MOOD.slowAmbient);
    // Not the previous station's tunes followed by the new ones.
    for (const ordinal of beforeChange) expect(afterChange).not.toContain(ordinal);
  });

  it("never appends the tracks a refill had already chosen under the previous mood", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result, rerender } = await startFastPaced(client, params);

    // Park the lookahead refill mid-compute, then change the mood underneath it.
    client.holdNextComputeFor(MOOD.fastPaced);
    await act(async () => {
      rerender({ ...params, currentIndex: 8, playlistLength: 10 });
    });
    await waitFor(() => expect(client.compute.mock.calls.length).toBeGreaterThan(1));

    await act(async () => {
      await result.current.setSongStationStyleFilter(MOOD.slowAmbient);
    });
    await act(async () => {
      client.releaseHeldCompute();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Fast-Paced is every even ordinal, so a single even one appended after the change is a leak.
    const appended = ordinalsOf(params.appendItems as ReturnType<typeof vi.fn>);
    for (const ordinal of appended) {
      expect(bundle.styleMask[ordinal] & (1 << MOOD.slowAmbient)).not.toBe(0);
      expect(ordinal % 2).toBe(1);
    }
    const secondBatch = (params.startPlaylist as ReturnType<typeof vi.fn>).mock.calls[1][0] as PlaylistItem[];
    expectSatisfiesBothConditions(secondBatch.map(ordinalOfItem), MOOD.slowAmbient);
  });

  it("drops a station superseded while its own first batch was still being computed", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));

    client.holdNextComputeFor(MOOD.fastPaced);
    let superseded!: Promise<void>;
    await act(async () => {
      superseded = result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.fastPaced);
      await waitFor(() => expect(client.compute).toHaveBeenCalled());
    });
    await act(async () => {
      await result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.slowAmbient);
    });
    await act(async () => {
      client.releaseHeldCompute();
      await superseded;
    });

    // The superseded station queued nothing, recorded nothing, and did not become the active one.
    expect(params.startPlaylist).toHaveBeenCalledTimes(1);
    expect(params.appendItems).not.toHaveBeenCalled();
    expect(result.current.station).toMatchObject({ styleBit: MOOD.slowAmbient });
    expectSatisfiesBothConditions(getSidRadioStats().emittedSequence, MOOD.slowAmbient);
    expectSatisfiesBothConditions(ordinalsOf(params.startPlaylist as ReturnType<typeof vi.fn>), MOOD.slowAmbient);
  });

  it("reports an empty intersection instead of falling back to the station that was playing", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = await startFastPaced(client, params);

    // Deep Cuts is carried by the seed itself and by the isolated component, so nothing the walk can
    // reach qualifies — an empty intersection over a mood that is not empty at all.
    await act(async () => {
      await result.current.setSongStationStyleFilter(MOOD.deepDiscovery);
    });

    expect(result.current.notice).toBe("no-radio-for-tune");
    expect(result.current.active).toBe(false);
    expect(result.current.station).toBeNull();
    expect(params.startPlaylist).toHaveBeenCalledTimes(1); // the Fast-Paced batch, and nothing since
    expect(params.appendItems).not.toHaveBeenCalled();
    expect(everyTrackWithMood(bundle, MOOD.deepDiscovery).length).toBeGreaterThan(1);
  });

  it("refuses a mood with no members without disturbing the station that is playing", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result, rerender } = await startFastPaced(client, params);
    const computesBefore = client.compute.mock.calls.length;

    await act(async () => {
      await result.current.setSongStationStyleFilter(MOOD.themeHunter);
    });

    expect(result.current.notice).toBe("no-radio");
    expect(client.compute.mock.calls.length).toBe(computesBefore); // refused ahead of any walk
    expect(result.current.station).toMatchObject({ styleBit: MOOD.fastPaced });
    expect(params.startPlaylist).toHaveBeenCalledTimes(1);

    // Still a working station, not just a chip that is still on screen: the refusal must happen
    // before anything is torn down, so the Fast-Paced station keeps refilling.
    await act(async () => {
      rerender({ ...params, currentIndex: 8, playlistLength: 10 });
    });
    await waitFor(() => expect(params.appendItems).toHaveBeenCalled());
    expectSatisfiesBothConditions(ordinalsOf(params.appendItems as ReturnType<typeof vi.fn>), MOOD.fastPaced);
  });

  it("goes back to All moods without losing the seed", async () => {
    const client = makeEngineClient();
    const params = baseParams(client);
    const { result } = await startFastPaced(client, params);

    await act(async () => {
      await result.current.setSongStationStyleFilter(null);
    });

    expect(result.current.station).toMatchObject({ seedKind: "song", seedLabel: SEED_LABEL, styleBit: null });
    expect(lastRequest(client).styleFilter).toBeNull();
    expect(lastRequest(client).seed).toEqual({ kind: "song", md5_48: md548For(SEED) });
  });
});

describe("useSidRadio — order of a mood-constrained Song station", () => {
  const emittedFor = async (shuffleSeed: number) => {
    const client = makeEngineClient();
    const params = baseParams(client, { randomSeed: () => shuffleSeed });
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio(md548For(SEED), SEED_LABEL, MOOD.fastPaced);
    });
    return [...getSidRadioStats().emittedSequence];
  };

  it("replays the identical sequence for the same inputs", async () => {
    expect(await emittedFor(SHUFFLE_SEED)).toEqual(await emittedFor(SHUFFLE_SEED));
  });

  it("gives a different but still valid order for a different shuffleSeed", async () => {
    const first = await emittedFor(11);
    const second = await emittedFor(9001);
    expect(second).not.toEqual(first);
    expectSatisfiesBothConditions(first, MOOD.fastPaced);
    expectSatisfiesBothConditions(second, MOOD.fastPaced);
  });
});

describe("SID Radio chip labelling", () => {
  it("names the mood alongside the tune once a Song station carries one", async () => {
    const { SidRadioChip } = await import("@/pages/playFiles/components/SidRadioChip");
    const { render, screen } = await import("@testing-library/react");
    render(
      <SidRadioChip
        station={{
          seedKind: "song",
          seedLabel: SEED_LABEL,
          styleBit: MOOD.melodic,
          shuffleSeed: 1,
          rankingSnapshotId: "snap",
        }}
        onStop={vi.fn()}
      />,
    );
    // The expected tune name changed from the raw "Bouncy_Balls.sid" when friendly SID names shipped:
    // the chip now draws the same readable name the transport and the playlist rows draw, and a
    // station chip that alone kept the file name would read as a bug. What this test is actually
    // about — that a Song station names its mood alongside its seed tune — is unchanged, and the
    // station's stored `seedLabel` is still the raw file name.
    expect(screen.getByTestId("sid-radio-chip")).toHaveTextContent(`Bouncy Balls · ${moodLabel(MOOD.melodic)}`);
  });

  it("keeps the file name when the friendly-name preference is off", async () => {
    const { SidRadioChip } = await import("@/pages/playFiles/components/SidRadioChip");
    const { saveFriendlySidNames } = await import("@/lib/config/appSettings");
    const { render, screen } = await import("@testing-library/react");
    saveFriendlySidNames(false);
    render(
      <SidRadioChip
        station={{
          seedKind: "song",
          seedLabel: SEED_LABEL,
          styleBit: MOOD.melodic,
          shuffleSeed: 1,
          rankingSnapshotId: "snap",
        }}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sid-radio-chip")).toHaveTextContent(`${SEED_LABEL} · ${moodLabel(MOOD.melodic)}`);
  });
});
