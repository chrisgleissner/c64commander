/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceLocation } from "@/lib/sourceNavigation/types";
import { useSourceNavigator } from "@/lib/sourceNavigation/useSourceNavigator";
import { addErrorLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
}));

describe("useSourceNavigator", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("loads stored path and toggles the loading indicator for ultimate sources", async () => {
    vi.useFakeTimers();
    let resolveEntries: ((value: { type: "file"; name: string; path: string }[]) => void) | null = null;
    const listEntries = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEntries = resolve;
        }),
    );
    const source: SourceLocation = {
      id: "ultimate-1",
      type: "ultimate",
      name: "Ultimate",
      rootPath: "/root",
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
    };

    localStorage.setItem("c64u_source_nav:ultimate:ultimate-1", "/root");

    const { result } = renderHook(() => useSourceNavigator(source));

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current.showLoadingIndicator).toBe(true);

    await act(async () => {
      resolveEntries?.([{ type: "file", name: "song.sid", path: "/root/song.sid" }]);
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.path).toBe("/root");

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.showLoadingIndicator).toBe(false);

    vi.useRealTimers();
  });

  it("navigates up and refresh clears cache", async () => {
    const listEntries = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ type: "dir", name: "Child", path: "/root/child" }])
      .mockResolvedValueOnce([]);
    const clearCacheForPath = vi.fn();
    const source: SourceLocation = {
      id: "local-1",
      type: "local",
      name: "Local",
      rootPath: "/root",
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
      clearCacheForPath,
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.navigateTo("/root/child");
    });

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.navigateUp();
    });

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.path).toMatch(/^\/root\/?$/));

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(clearCacheForPath).toHaveBeenCalledWith(result.current.path));
  });

  it("captures list errors and reports them", async () => {
    const listEntries = vi.fn().mockRejectedValue(new Error("Boom"));
    const source: SourceLocation = {
      id: "ultimate-2",
      type: "ultimate",
      name: "Ultimate",
      rootPath: "/root",
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    await waitFor(() => expect(result.current.error).toBe("Boom"));
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "Source browse failed",
      expect.objectContaining({
        sourceId: "ultimate-2",
        sourceType: "ultimate",
        path: "/root",
      }),
    );
  });

  it("discards stale responses when a newer navigation fires", async () => {
    type Resolver = (entries: { type: string; name: string; path: string }[]) => void;
    const resolvers: Resolver[] = [];
    const listEntries = vi.fn().mockImplementation(
      () =>
        new Promise<{ type: string; name: string; path: string }[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const source: SourceLocation = {
      id: "race-1",
      type: "local",
      name: "Local",
      rootPath: "/",
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    // Wait for the initial load call
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));

    // Resolve initial load
    await act(async () => {
      resolvers[0]([{ type: "dir", name: "A", path: "/A" }]);
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.path).toBe("/");

    // Fire two navigations quickly — second should win
    act(() => {
      result.current.navigateTo("/A");
    });
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.navigateTo("/B");
    });
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(3));

    // Resolve the FIRST navigation (stale — /A) AFTER the second was dispatched
    await act(async () => {
      resolvers[1]([{ type: "file", name: "stale.sid", path: "/A/stale.sid" }]);
    });

    // Stale result should NOT appear — entries should still be from initial load
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].name).toBe("A");

    // Now resolve the SECOND navigation (current — /B)
    await act(async () => {
      resolvers[2]([{ type: "file", name: "current.sid", path: "/B/current.sid" }]);
    });

    // Current result should appear
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].name).toBe("current.sid");
    expect(result.current.path).toBe("/B");
  });

  it("ignores stale failures while a newer request is still pending", async () => {
    type Resolver = {
      resolve: (entries: { type: string; name: string; path: string }[]) => void;
      reject: (error: Error) => void;
    };
    const requests: Resolver[] = [];
    const listEntries = vi.fn().mockImplementation(
      () =>
        new Promise<{ type: string; name: string; path: string }[]>((resolve, reject) => {
          requests.push({ resolve, reject });
        }),
    );
    const source: SourceLocation = {
      id: "race-error-1",
      type: "local",
      name: "Local",
      rootPath: "/",
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));
    await act(async () => {
      requests[0].resolve([{ type: "dir", name: "A", path: "/A" }]);
    });

    act(() => {
      result.current.navigateTo("/A");
    });
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.navigateTo("/B");
    });
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(3));

    await act(async () => {
      requests[1].reject(new Error("stale failure"));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      requests[2].resolve([{ type: "file", name: "current.sid", path: "/B/current.sid" }]);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.path).toBe("/B");
    expect(vi.mocked(addErrorLog)).not.toHaveBeenCalledWith(
      "Source browse failed",
      expect.objectContaining({ path: "/A" }),
    );
  });

  it("uses paged source queries and loads more without calling full listings", async () => {
    const listEntries = vi.fn();
    const listEntriesPage = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [{ type: "dir", name: "Collections", path: "/root/Collections" }],
        totalCount: 3,
        nextOffset: 0,
      })
      .mockResolvedValueOnce({
        entries: [{ type: "file", name: "demo.sid", path: "/root/demo.sid", durationMs: 12_000 }],
        totalCount: 3,
        nextOffset: 1,
      })
      .mockResolvedValueOnce({
        entries: [{ type: "file", name: "extra.sid", path: "/root/extra.sid", durationMs: 24_000 }],
        totalCount: 3,
        nextOffset: null,
      });
    const source: SourceLocation = {
      id: "hvsc-1",
      type: "hvsc",
      name: "HVSC",
      rootPath: "/root",
      isAvailable: true,
      listEntries,
      listEntriesPage,
      listFilesRecursive: vi.fn(),
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    await waitFor(() =>
      expect(listEntriesPage).toHaveBeenCalledWith({
        path: "/root",
        query: "",
        offset: 0,
        limit: 200,
      }),
    );

    act(() => {
      result.current.setQuery?.("demo");
    });

    await waitFor(() => expect(listEntriesPage).toHaveBeenCalledTimes(2));
    expect(listEntriesPage).toHaveBeenNthCalledWith(2, {
      path: expect.stringMatching(/^\/root\/?$/),
      query: "demo",
      offset: 0,
      limit: 200,
    });

    await waitFor(() => {
      expect(result.current.query).toBe("demo");
      expect(result.current.entries).toEqual([
        { type: "file", name: "demo.sid", path: "/root/demo.sid", durationMs: 12_000 },
      ]);
      expect(result.current.hasMore).toBe(true);
    });

    act(() => {
      result.current.loadMore?.();
    });

    await waitFor(() => expect(listEntriesPage).toHaveBeenCalledTimes(3));
    expect(listEntriesPage).toHaveBeenNthCalledWith(3, {
      path: expect.stringMatching(/^\/root\/?$/),
      query: "demo",
      offset: 1,
      limit: 200,
    });

    expect(listEntries).not.toHaveBeenCalled();
    expect(result.current.isQueryBacked).toBe(true);
    await waitFor(() => {
      expect(result.current.entries).toEqual([
        { type: "file", name: "demo.sid", path: "/root/demo.sid", durationMs: 12_000 },
        { type: "file", name: "extra.sid", path: "/root/extra.sid", durationMs: 24_000 },
      ]);
      expect(result.current.hasMore).toBe(false);
    });
  });
});

/**
 * Searching beyond the folder on screen.
 *
 * The filter box used to narrow the current folder and nothing else. For a source arranged by
 * composer that means a query can only ever find what is already visible, which is the one case
 * where a search is not needed. The navigator therefore carries a scope, and the source says whether
 * it can answer a whole-source search at all and whether that answer is cheap enough to run while
 * the person is still typing.
 */
describe("useSourceNavigator whole-source search", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  const makeSource = (overrides: Partial<SourceLocation> = {}): SourceLocation => ({
    id: "hvsc-library",
    type: "hvsc",
    name: "HVSC",
    rootPath: "/",
    isAvailable: true,
    listEntries: vi.fn(async () => [{ type: "file" as const, name: "in-folder.sid", path: "/in-folder.sid" }]),
    listFilesRecursive: vi.fn(async () => []),
    ...overrides,
  });

  it("starts scoped to the folder, so nothing changes until it is asked to", async () => {
    const source = makeSource({ searchEntries: vi.fn(), searchIsInstant: true });
    const { result } = renderHook(() => useSourceNavigator(source));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.searchScope).toBe("folder");
    expect(result.current.isSearching).toBe(false);
    expect(result.current.canSearchSource).toBe(true);
  });

  it("reports no whole-source search for a source that cannot do one", async () => {
    const { result } = renderHook(() => useSourceNavigator(makeSource()));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.canSearchSource).toBe(false);
    expect(result.current.runSourceSearch).toBeUndefined();
  });

  it("searches the whole source on every keystroke when the source is indexed", async () => {
    const searchEntries = vi.fn(async () => ({
      entries: [{ type: "file" as const, name: "Commando.sid", path: "/M/H/Hubbard_Rob/Commando.sid" }],
      totalCount: 1,
      nextOffset: null,
    }));
    const source = makeSource({ searchEntries, searchIsInstant: true });
    const { result } = renderHook(() => useSourceNavigator(source));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.setSearchScope("source"));
    act(() => result.current.setQuery?.("commando"));

    await waitFor(() => expect(searchEntries).toHaveBeenCalled());
    await waitFor(() => expect(result.current.entries[0]?.name).toBe("Commando.sid"));
    expect(result.current.isSearching).toBe(true);
    expect(searchEntries).toHaveBeenCalledWith(expect.objectContaining({ query: "commando" }));
  });

  it("never starts a walk while the person is typing", async () => {
    // A source that has to be walked costs seconds to minutes per search. Firing one per keystroke
    // would queue walks far faster than they complete.
    const searchEntries = vi.fn(async () => ({ entries: [], totalCount: 0, nextOffset: null }));
    const source = makeSource({ searchEntries, searchIsInstant: false });
    const { result } = renderHook(() => useSourceNavigator(source));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.setSearchScope("source"));
    act(() => result.current.setQuery?.("commando"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(searchEntries).not.toHaveBeenCalled();

    act(() => result.current.runSourceSearch?.());
    await waitFor(() => expect(searchEntries).toHaveBeenCalledTimes(1));
  });

  it("goes back to the folder listing when the scope returns to this folder", async () => {
    const searchEntries = vi.fn(async () => ({
      entries: [{ type: "file" as const, name: "Commando.sid", path: "/M/Commando.sid" }],
      totalCount: 1,
      nextOffset: null,
    }));
    const source = makeSource({ searchEntries, searchIsInstant: true });
    const { result } = renderHook(() => useSourceNavigator(source));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.setSearchScope("source"));
    act(() => result.current.setQuery?.("commando"));
    await waitFor(() => expect(result.current.isSearching).toBe(true));

    act(() => result.current.setSearchScope("folder"));

    await waitFor(() => expect(result.current.isSearching).toBe(false));
    await waitFor(() => expect(result.current.entries[0]?.name).toBe("in-folder.sid"));
  });

  it("leaves the search when the person navigates, rather than filtering the new folder by it", async () => {
    // Up and Root have nothing to mean inside a flat list of results, so reaching for one is how a
    // person says they are done searching. Carrying the query over would land them on a folder
    // listing filtered by a term they had moved on from.
    const searchEntries = vi.fn(async () => ({
      entries: [{ type: "file" as const, name: "Commando.sid", path: "/M/Commando.sid" }],
      totalCount: 1,
      nextOffset: null,
    }));
    const source = makeSource({ searchEntries, searchIsInstant: true });
    const { result } = renderHook(() => useSourceNavigator(source));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.setSearchScope("source"));
    act(() => result.current.setQuery?.("commando"));
    await waitFor(() => expect(result.current.isSearching).toBe(true));

    act(() => result.current.navigateRoot());

    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.query).toBe("");
    expect(result.current.searchScope).toBe("folder");
  });

  it("pages further results without losing the ones already shown", async () => {
    const searchEntries = vi.fn(async ({ offset }: { offset?: number }) =>
      offset
        ? { entries: [{ type: "file" as const, name: "b.sid", path: "/b.sid" }], totalCount: 2, nextOffset: null }
        : { entries: [{ type: "file" as const, name: "a.sid", path: "/a.sid" }], totalCount: 2, nextOffset: 1 },
    );
    const source = makeSource({ searchEntries, searchIsInstant: true });
    const { result } = renderHook(() => useSourceNavigator(source));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.setSearchScope("source"));
    act(() => result.current.setQuery?.("sid"));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore?.());

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
  });

  it("clearing the search restores the folder listing", async () => {
    const searchEntries = vi.fn(async () => ({
      entries: [{ type: "file" as const, name: "Commando.sid", path: "/M/Commando.sid" }],
      totalCount: 1,
      nextOffset: null,
    }));
    const source = makeSource({ searchEntries, searchIsInstant: true });
    const { result } = renderHook(() => useSourceNavigator(source));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.setSearchScope("source"));
    act(() => result.current.setQuery?.("commando"));
    await waitFor(() => expect(result.current.isSearching).toBe(true));

    act(() => result.current.clearSearch());

    await waitFor(() => expect(result.current.entries[0]?.name).toBe("in-folder.sid"));
    expect(result.current.query).toBe("");
  });
});
