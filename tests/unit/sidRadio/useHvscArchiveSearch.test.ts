/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHvscArchiveSearch } from "@/pages/playFiles/hooks/useHvscArchiveSearch";
import { searchHvscSongs } from "@/lib/hvsc";
import { addErrorLog } from "@/lib/logging";

vi.mock("@/lib/hvsc", () => ({ searchHvscSongs: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

/**
 * The search hook's own guards, which the sheet's tests cannot reach.
 *
 * A search runs while somebody is still typing, so more than one can be in the air at once, and the
 * box can be emptied or the sheet closed while one is outstanding. Each of those has a deliberate
 * answer here; none of them is visible from the outside until it goes wrong.
 */

const page = (songs: unknown[], totalSongs = songs.length) =>
  ({ songs, totalSongs, offset: 0, limit: 100, query: "q" }) as never;

const song = (overrides: Record<string, unknown> = {}) => ({
  virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
  fileName: "Commando.sid",
  canonicalTitle: "Commando",
  canonicalAuthor: "Rob Hubbard",
  ...overrides,
});

describe("useHvscArchiveSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a failed search as a finished search that found nothing", async () => {
    // Not as a permanent "Searching…", which is what an unhandled rejection would have left on
    // screen for as long as the sheet stayed open.
    vi.mocked(searchHvscSongs).mockRejectedValue(new Error("index exploded"));
    const { result } = renderHook(() => useHvscArchiveSearch());

    act(() => result.current.setQuery("commando"));

    await waitFor(() => expect(result.current.hasSearched).toBe(true));
    expect(result.current.hits).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.isSearching).toBe(false);
    expect(addErrorLog).toHaveBeenCalledWith("HVSC search failed", expect.objectContaining({ query: "commando" }));
  });

  it("drops a slow earlier search rather than letting it overwrite a newer one", async () => {
    // Typing produces overlapping searches. The one that started first can finish last, and if it
    // does it must not replace what the person is now looking at.
    let releaseFirst: ((value: unknown) => void) | null = null;
    vi.mocked(searchHvscSongs)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }) as never,
      )
      .mockResolvedValueOnce(page([song({ canonicalTitle: "Second" })]));

    const { result } = renderHook(() => useHvscArchiveSearch());
    act(() => result.current.setQuery("first"));
    await waitFor(() => expect(searchHvscSongs).toHaveBeenCalledTimes(1));
    act(() => result.current.setQuery("second"));
    await waitFor(() => expect(result.current.hits[0]?.title).toBe("Second"));

    // The first search lands late, carrying results for a query nobody is looking at.
    await act(async () => {
      releaseFirst?.(page([song({ canonicalTitle: "First" })]));
    });

    expect(result.current.hits[0]?.title).toBe("Second");
  });

  it("clears everything, including a search still in flight", async () => {
    let release: ((value: unknown) => void) | null = null;
    vi.mocked(searchHvscSongs).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    const { result } = renderHook(() => useHvscArchiveSearch());
    act(() => result.current.setQuery("commando"));
    await waitFor(() => expect(searchHvscSongs).toHaveBeenCalled());

    act(() => result.current.clear());
    expect(result.current.query).toBe("");
    expect(result.current.hasSearched).toBe(false);

    await act(async () => {
      release?.(page([song()]));
    });

    // The abandoned search must not repopulate a box the person emptied.
    expect(result.current.hits).toEqual([]);
    expect(result.current.query).toBe("");
  });

  it("does not search at all while disabled", async () => {
    const { result } = renderHook(() => useHvscArchiveSearch({ enabled: false }));

    act(() => result.current.setQuery("commando"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(searchHvscSongs).not.toHaveBeenCalled();
  });

  it("carries the subsong, count and duration a station item needs to play correctly", async () => {
    // Without these a found tune falls back to the three-minute default, which sets the progress bar
    // and the end of the track as well as the display.
    vi.mocked(searchHvscSongs).mockResolvedValue(
      page([
        song({
          trackSubsongs: [
            { songNr: 1, isDefault: false },
            { songNr: 2, isDefault: true },
          ],
          durationSeconds: 221,
        }),
      ]),
    );
    const { result } = renderHook(() => useHvscArchiveSearch());

    act(() => result.current.setQuery("commando"));

    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(result.current.hits[0]).toMatchObject({ songNr: 2, subsongCount: 2, durationMs: 221_000 });
  });

  it("falls back to the SID header when the archive names no default subsong", async () => {
    vi.mocked(searchHvscSongs).mockResolvedValue(
      page([song({ trackSubsongs: null, sidMetadata: { startSong: 3, songs: 9 } })]),
    );
    const { result } = renderHook(() => useHvscArchiveSearch());

    act(() => result.current.setQuery("commando"));

    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(result.current.hits[0]).toMatchObject({ songNr: 3, subsongCount: 9 });
    expect(result.current.hits[0]?.durationMs).toBeUndefined();
  });

  it("says where a tune at the root of the archive lives", async () => {
    vi.mocked(searchHvscSongs).mockResolvedValue(page([song({ virtualPath: "/loose.sid" })]));
    const { result } = renderHook(() => useHvscArchiveSearch());

    act(() => result.current.setQuery("loose"));

    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(result.current.hits[0]?.folder).toBe("/");
  });
});
