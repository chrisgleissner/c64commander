/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidRadio } from "@/pages/playFiles/hooks/useSidRadio";
import { clearAllRankings, getRanking } from "@/lib/sidRadio/rankingStore";
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
      const pool = [1, 2, 3, 4, 5, 6].filter((o) => !request.exclude.includes(o));
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
});
