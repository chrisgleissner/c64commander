/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidRadio } from "@/pages/playFiles/hooks/useSidRadio";
import { clearAllRankings, getRanking } from "@/lib/sidRadio/rankingStore";
import { loadSidRadioSession, saveSidRadioSession } from "@/lib/sidRadio/sidRadioSession";
import type { StationRequest } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import type { StationResult } from "@/lib/sidRadio/stationEngine";

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
});

const makeClient = () => {
  const client = {
    load: vi.fn().mockResolvedValue({ fileCount: 4, trackCount: 4, engineThreadIsMain: false }),
    compute: vi.fn(async (request: StationRequest): Promise<StationResult> => {
      const pool = Array.from({ length: 60 }, (_, i) => i + 1).filter((o) => !request.exclude.includes(o));
      return {
        candidates: pool.slice(0, request.count).map((trackOrdinal) => ({
          trackOrdinal,
          md5_48: `m${trackOrdinal}`,
          songIndex: 1,
          score: 10 - trackOrdinal,
          reason: "similar" as const,
        })),
      };
    }),
    terminate: vi.fn(),
  };
  return client;
};

const baseParams = (client: ReturnType<typeof makeClient>, overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  startPlaylist: vi.fn(),
  appendItems: vi.fn(),
  advanceToNext: vi.fn(),
  currentIndex: 0,
  playlistLength: 10,
  clientFactory: () => client as never,
  resolvePath: (md5: string) => `/HVSC/${md5}.sid`,
  randomSeed: () => 12345,
  ...overrides,
});

describe("useSidRadio", () => {
  it("starts a Song station: loads the worker, computes, and seeds the playlist", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect(client.load).toHaveBeenCalledTimes(1);
    expect(client.compute).toHaveBeenCalled();
    expect(params.startPlaylist).toHaveBeenCalledTimes(1);
    const items = (params.startPlaylist as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].request).toMatchObject({ source: "hvsc" });
    expect(result.current.active).toBe(true);
    expect(result.current.station).toMatchObject({ seedKind: "song", seedLabel: "Commando", shuffleSeed: 12345 });
  });

  it("does nothing when disabled", async () => {
    const client = makeClient();
    const params = baseParams(client, { enabled: false });
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect(client.load).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it("stops the station", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
    expect(result.current.station).toBeNull();
  });

  it("✕ steer records the dislike and skips to the next track", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    await act(async () => {
      result.current.steer("cafebabecafebabecafebabecafebabe", "notForMe");
    });
    expect(getRanking("cafebabecafebabecafebabecafebabe")).toBe("notForMe");
    expect(params.advanceToNext).toHaveBeenCalledTimes(1);
  });

  it("♥ steer records a like without skipping", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    await act(async () => {
      result.current.steer("0123456789abcdef0123456789abcdef", "like");
    });
    expect(getRanking("0123456789abcdef0123456789abcdef")).toBe("like");
    expect(params.advanceToNext).not.toHaveBeenCalled();
  });

  it("persists the station descriptor on start and clears it on stop (D15)", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    const saved = loadSidRadioSession();
    expect(saved).toMatchObject({ seedKind: "song", seedLabel: "Commando", shuffleSeed: 12345 });
    expect(saved?.excludeOrdinals.length).toBeGreaterThan(0);
    act(() => result.current.stop());
    expect(loadSidRadioSession()).toBeNull();
  });

  it("refills the queue as the cursor nears the tail and records auto-advances", async () => {
    const client = makeClient();
    const params = baseParams(client, { playlistLength: 10, currentIndex: 0 });
    const { result, rerender } = renderHook((p: ReturnType<typeof baseParams>) => useSidRadio(p), {
      initialProps: params,
    });
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    // Advance the cursor to within the refill threshold of the tail.
    await act(async () => {
      rerender({ ...params, currentIndex: 8, playlistLength: 10 });
    });
    await waitFor(() => expect(params.appendItems).toHaveBeenCalled());
    const appended = (params.appendItems as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(appended.length).toBeGreaterThan(0);
  });

  it("surfaces a 'no radio for this tune' notice when the seed has no neighbours (Q5)", async () => {
    const client = makeClient();
    client.compute = vi.fn(async () => ({ candidates: [], empty: "no-neighbours" }));
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toBe("no-radio-for-tune");
    expect(params.startPlaylist).not.toHaveBeenCalled();
    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });

  it("resumes the chip from a saved session on mount (D15)", () => {
    saveSidRadioSession({
      seedKind: "style",
      seedLabel: "Fast-Paced",
      seed: { kind: "style", styleBit: 0 },
      styleFilter: 0,
      shuffleSeed: 777,
      rankingSnapshotId: "snap",
      excludeOrdinals: [1, 2, 3],
    });
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    expect(result.current.active).toBe(true);
    expect(result.current.station).toMatchObject({ seedKind: "style", seedLabel: "Fast-Paced", shuffleSeed: 777 });
    // Resume rebuilds the chip only — it does not auto-replace the playlist.
    expect(params.startPlaylist).not.toHaveBeenCalled();
  });
});

/**
 * `emittedSequence` is the evidence behind the G11 `--shuffle-replay` gate:
 * the HIL starts a station twice with the same pinned `shuffleSeed` and
 * asserts the sequences match, then with a different seed and asserts they
 * diverge. Both assertions are vacuous unless the sequence identifies *tunes*
 * and is produced by the station rather than by playback. It used to be
 * appended on auto-advance with the playlist cursor, which is 0,1,2,… for
 * every station and every seed, so the gate compared two counters.
 */
describe("useSidRadio emittedSequence identity", () => {
  it("records the tune ordinals the station emitted, not the playlist cursor", async () => {
    const { getSidRadioStats } = await import("@/lib/sidRadio/sidRadioStats");
    const client = makeClient();
    // Emit a pool whose ordinals cannot be confused with playlist indices.
    const pool = [700, 701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711];
    client.compute = vi.fn(async (request: StationRequest): Promise<StationResult> => ({
      candidates: pool
        .filter((o) => !request.exclude.includes(o))
        .slice(0, request.count)
        .map((trackOrdinal) => ({
          trackOrdinal,
          md5_48: `m${trackOrdinal}`,
          songIndex: 1,
          score: 1,
          reason: "similar" as const,
        })),
    }));

    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });

    const sequence = getSidRadioStats().emittedSequence;
    expect(sequence.length).toBeGreaterThan(0);
    // The tunes the engine chose, in the order it chose them -- never 0,1,2,…
    expect(sequence).toEqual(pool.slice(0, sequence.length));
    expect(sequence[0]).toBe(700);
  });

  it("counts auto-advances separately from the emitted sequence", async () => {
    const { getSidRadioStats } = await import("@/lib/sidRadio/sidRadioStats");
    const client = makeClient();
    let currentIndex = 0;
    const params = baseParams(client);
    const { result, rerender } = renderHook(() => useSidRadio({ ...params, currentIndex }));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    const emittedBefore = getSidRadioStats().emittedSequence.length;

    for (const next of [1, 2]) {
      currentIndex = next;
      await act(async () => {
        rerender();
      });
    }

    // Advancing the cursor counts advances; it must not append to the
    // determinism sequence, which belongs to the station, not to playback.
    expect(getSidRadioStats().tracksAutoAdvanced).toBe(2);
    expect(getSidRadioStats().emittedSequence).toHaveLength(emittedBefore);
  });
});
