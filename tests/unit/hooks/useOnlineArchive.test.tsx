import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";
import * as archiveClient from "@/lib/archive/client";
import * as archiveExecution from "@/lib/archive/execution";
import { __resetArchivePresetCacheForTests, useOnlineArchive } from "@/hooks/useOnlineArchive";
import { createArchiveMock } from "../../mocks/archiveMock";

const closers: Array<() => Promise<void>> = [];

const createArchiveClientStub = () => ({
  getPresets: vi.fn().mockResolvedValue([]),
  search: vi.fn(),
  getEntries: vi.fn(),
  getBinaryUrl: vi.fn(),
  downloadBinary: vi.fn(),
  getResolvedConfig: vi.fn(),
});

const flushArchivePresetRefresh = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(async () => {
  __resetArchivePresetCacheForTests();
  vi.useRealTimers();
  await Promise.allSettled(closers.splice(0).map((close) => close()));
});

describe("useOnlineArchive", () => {
  it("switches source config at runtime without stale requests or config leakage", async () => {
    const commodore = await createArchiveMock();
    const custom = await createArchiveMock(
      {
        searchByQuery: {
          '(name:"wizball") & (category:games)': [{ id: "200", category: 10, name: "Wizball" }],
        },
      },
      {
        expectedClientId: "Custom",
        expectedUserAgent: "Custom Agent",
      },
    );
    closers.push(commodore.close, custom.close);

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useOnlineArchive>[0]) => useOnlineArchive(props),
      {
        initialProps: buildDefaultArchiveClientConfig({ hostOverride: commodore.host }),
      },
    );

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    expect(result.current.clientType).toBe("CommoserveClient");
    expect(result.current.resolvedConfig.host).toBe(commodore.host);

    await act(async () => {
      await result.current.search({ name: "joyride", category: "apps" });
    });
    await waitFor(() => expect(result.current.state.phase).toBe("results"));
    expect(result.current.state.phase === "results" && result.current.state.results[0]?.name).toBe("Joyride");

    rerender({
      id: "archive-custom",
      name: "Custom Archive",
      baseUrl: `http://${custom.host}`,
      headers: {
        "Client-Id": "Custom",
        "User-Agent": "Custom Agent",
      },
    });

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    expect(result.current.clientType).toBe("CommoserveClient");
    expect(result.current.resolvedConfig.host).toBe(custom.host);

    await act(async () => {
      await result.current.search({ name: "wizball", category: "games" });
    });
    await waitFor(() => expect(result.current.state.phase).toBe("results"));
    expect(result.current.state.phase === "results" && result.current.state.results[0]?.name).toBe("Wizball");
    expect(commodore.requests.some((request) => request.url.includes("wizball"))).toBe(false);
    expect(custom.requests.some((request) => request.url.includes("wizball"))).toBe(true);
  });

  it("keeps seeded presets and idle state when the preset refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T12:00:00Z"));

    const client = createArchiveClientStub();
    client.getPresets.mockRejectedValue(new Error("preset refresh failed"));
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() =>
      useOnlineArchive(buildDefaultArchiveClientConfig({ hostOverride: "127.0.0.1:1" })),
    );

    await flushArchivePresetRefresh();

    expect(result.current.presetsLoading).toBe(false);
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "category" }),
        expect.objectContaining({ type: "sort" }),
      ]),
    );
    expect(result.current.presets.find((preset) => preset.type === "date")?.values.at(-1)?.aqlKey).toBe("2026");

    spy.mockRestore();
  });

  it("refreshes presets only once per app launch for the same source config", async () => {
    const client = {
      getPresets: vi.fn().mockResolvedValue([{ type: "category", description: "Category", values: [] }]),
      search: vi.fn(),
      getEntries: vi.fn(),
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn(),
      getResolvedConfig: vi.fn(),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result, unmount } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));
    await waitFor(() => expect(result.current.presetsLoading).toBe(false));

    unmount();

    const second = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));
    await waitFor(() => expect(second.result.current.presetsLoading).toBe(false));

    expect(client.getPresets).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    second.unmount();
  });

  it("keeps the seeded presets visible until the background refresh completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T12:00:00Z"));

    const deferred = new Promise<Array<{ type: string; description: string; values: never[] }>>((resolve) => {
      setTimeout(() => resolve([{ type: "category", description: "Category", values: [] }]), 0);
    });
    const client = {
      getPresets: vi.fn().mockReturnValue(deferred),
      search: vi.fn(),
      getEntries: vi.fn(),
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn(),
      getResolvedConfig: vi.fn(),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    expect(result.current.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "category" }),
        expect.objectContaining({ type: "sort" }),
      ]),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.presetsLoading).toBe(false);
    expect(result.current.state.phase).toBe("idle");

    spy.mockRestore();
  });

  it("keeps the current year in the date presets even when the server lags behind", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T12:00:00Z"));

    const client = createArchiveClientStub();
    client.getPresets.mockResolvedValue([
      {
        type: "date",
        description: "Date",
        values: Array.from({ length: 46 }, (_, index) => ({ aqlKey: String(1980 + index) })),
      },
    ]);
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await flushArchivePresetRefresh();

    expect(result.current.presetsLoading).toBe(false);
    const datePreset = result.current.presets.find((preset) => preset.type === "date");
    expect(datePreset?.values[0]?.aqlKey).toBe("1980");
    expect(datePreset?.values.at(-1)?.aqlKey).toBe("2026");
    expect(datePreset?.values.at(-1)?.name).toBe("2026");

    spy.mockRestore();
  });

  it("returns to idle when cancelling an in-flight search", async () => {
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn(
        () =>
          new Promise<never>(() => {
            // intentionally unresolved
          }),
      ),
      getEntries: vi.fn(),
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn(),
      getResolvedConfig: vi.fn(),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));
    await waitFor(() => expect(result.current.presetsLoading).toBe(false));

    act(() => {
      void result.current.search({ name: "joyride", category: "apps" });
    });
    await waitFor(() => expect(result.current.state.phase).toBe("searching"));

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toEqual({ phase: "idle" });
    spy.mockRestore();
  });

  it("records an entry-loading failure with the search results as recoverable state", async () => {
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([{ id: "100", category: 40, name: "Joyride" }]),
      getEntries: vi.fn().mockRejectedValue(new Error("entries failed")),
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn(),
      getResolvedConfig: vi.fn(),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    await act(async () => {
      await result.current.search({ name: "joyride", category: "apps" });
    });
    await act(async () => {
      await result.current.openEntries(
        { name: "joyride", category: "apps" },
        { id: "100", category: 40, name: "Joyride" },
        [{ id: "100", category: 40, name: "Joyride" }],
      );
    });

    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.phase === "error" && result.current.state.recoverableState).toEqual({
      phase: "results",
      params: { name: "joyride", category: "apps" },
      results: [{ id: "100", category: 40, name: "Joyride" }],
    });

    act(() => {
      result.current.clearError();
    });

    expect(result.current.state).toEqual({
      phase: "results",
      params: { name: "joyride", category: "apps" },
      results: [{ id: "100", category: 40, name: "Joyride" }],
    });
    spy.mockRestore();
  });

  it("leaves non-error state unchanged when clearError is called", async () => {
    const { result } = renderHook(() =>
      useOnlineArchive(buildDefaultArchiveClientConfig({ hostOverride: "127.0.0.1:1" })),
    );
    await waitFor(() => expect(result.current.presetsLoading).toBe(false));

    act(() => {
      result.current.clearError();
    });

    expect(result.current.state).toEqual({ phase: "idle" });
  });

  it("preserves the current result context while entries are loading", async () => {
    const getEntries = vi.fn(
      () =>
        new Promise<Array<{ id: number; path: string }>>(() => {
          // intentionally unresolved
        }),
    );
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([{ id: "100", category: 40, name: "Joyride" }]),
      getEntries,
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn(),
      getResolvedConfig: vi.fn().mockReturnValue({
        id: "archive-commoserve",
        name: "CommoServe",
        headers: {
          "Client-Id": "Commodore",
          "User-Agent": "Assembly Query",
        },
        enabled: true,
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));

    await act(async () => {
      await result.current.search({ name: "joyride", category: "apps" });
    });

    act(() => {
      void result.current.openEntries(
        { name: "joyride", category: "apps" },
        { id: "100", category: 40, name: "Joyride" },
        [{ id: "100", category: 40, name: "Joyride" }],
      );
    });

    await waitFor(() => expect(result.current.state.phase).toBe("loadingEntries"));
    expect(result.current.state.phase === "loadingEntries" && result.current.state.results[0]?.name).toBe("Joyride");

    spy.mockRestore();
  });

  it("cancels loading entries back to the current results view", async () => {
    const getEntries = vi.fn(
      () =>
        new Promise<Array<{ id: number; path: string }>>(() => {
          // intentionally unresolved
        }),
    );
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([{ id: "100", category: 40, name: "Joyride" }]),
      getEntries,
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn(),
      getResolvedConfig: vi.fn().mockReturnValue({
        id: "archive-commoserve",
        name: "CommoServe",
        headers: {
          "Client-Id": "Commodore",
          "User-Agent": "Assembly Query",
        },
        enabled: true,
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    await act(async () => {
      await result.current.search({ name: "joyride", category: "apps" });
    });

    act(() => {
      void result.current.openEntries(
        { name: "joyride", category: "apps" },
        { id: "100", category: 40, name: "Joyride" },
        [{ id: "100", category: 40, name: "Joyride" }],
      );
    });
    await waitFor(() => expect(result.current.state.phase).toBe("loadingEntries"));

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toEqual({
      phase: "results",
      params: { name: "joyride", category: "apps" },
      results: [{ id: "100", category: 40, name: "Joyride" }],
    });

    spy.mockRestore();
  });

  it("returns to entries when a download is cancelled", async () => {
    const downloadBinary = vi.fn(
      () =>
        new Promise(() => {
          // intentionally unresolved
        }),
    );
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn(),
      getEntries: vi.fn(),
      getBinaryUrl: vi.fn(),
      downloadBinary,
      getResolvedConfig: vi.fn().mockReturnValue({
        id: "archive-commoserve",
        name: "CommoServe",
        headers: {
          "Client-Id": "Commodore",
          "User-Agent": "Assembly Query",
        },
        enabled: true,
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    act(() => {
      void result.current.execute(
        { name: "joyride", category: "apps" },
        { id: "100", category: 40, name: "Joyride" },
        [{ id: "100", category: 40, name: "Joyride" }],
        { id: 0, path: "joyride.prg" },
        [{ id: 0, path: "joyride.prg" }],
      );
    });

    await waitFor(() => expect(result.current.state.phase).toBe("downloading"));
    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toEqual({
      phase: "entries",
      params: { name: "joyride", category: "apps" },
      result: { id: "100", category: 40, name: "Joyride" },
      results: [{ id: "100", category: 40, name: "Joyride" }],
      entries: [{ id: 0, path: "joyride.prg" }],
    });

    spy.mockRestore();
  });

  it("returns to entries after a successful archive execution", async () => {
    const executeSpy = vi.spyOn(archiveExecution, "executeArchiveEntry").mockResolvedValue(undefined);
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn(),
      getEntries: vi.fn(),
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn().mockResolvedValue({
        fileName: "joyride.prg",
        bytes: new Uint8Array([1, 8, 96]),
        contentType: "application/octet-stream",
        url: "http://archive.local/joyride.prg",
      }),
      getResolvedConfig: vi.fn().mockReturnValue({
        id: "archive-commoserve",
        name: "CommoServe",
        headers: {
          "Client-Id": "Commodore",
          "User-Agent": "Assembly Query",
        },
        enabled: true,
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    await act(async () => {
      await result.current.execute(
        { name: "joyride", category: "apps" },
        { id: "100", category: 40, name: "Joyride" },
        [{ id: "100", category: 40, name: "Joyride" }],
        { id: 0, path: "joyride.prg" },
        [{ id: 0, path: "joyride.prg" }],
      );
    });

    expect(executeSpy).toHaveBeenCalled();
    expect(result.current.state).toEqual({
      phase: "entries",
      params: { name: "joyride", category: "apps" },
      result: { id: "100", category: 40, name: "Joyride" },
      results: [{ id: "100", category: 40, name: "Joyride" }],
      entries: [{ id: 0, path: "joyride.prg" }],
    });

    executeSpy.mockRestore();
    spy.mockRestore();
  });

  it("records a search failure as an error state", async () => {
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockRejectedValue(new Error("search failed")),
      getEntries: vi.fn(),
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn(),
      getResolvedConfig: vi.fn().mockReturnValue({
        id: "archive-commoserve",
        name: "CommoServe",
        headers: {
          "Client-Id": "Commodore",
          "User-Agent": "Assembly Query",
        },
        enabled: true,
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    await act(async () => {
      await result.current.search({ name: "joyride", category: "apps" });
    });

    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.phase === "error" && result.current.state.message).toContain("search failed");
    spy.mockRestore();
  });

  it("records an execution failure with an entries recoverable state", async () => {
    const executeSpy = vi.spyOn(archiveExecution, "executeArchiveEntry").mockRejectedValue(new Error("execute failed"));
    const client = {
      getPresets: vi.fn().mockResolvedValue([]),
      search: vi.fn(),
      getEntries: vi.fn(),
      getBinaryUrl: vi.fn(),
      downloadBinary: vi.fn().mockResolvedValue({
        fileName: "joyride.prg",
        bytes: new Uint8Array([1, 8, 96]),
        contentType: "application/octet-stream",
        url: "http://archive.local/joyride.prg",
      }),
      getResolvedConfig: vi.fn().mockReturnValue({
        id: "archive-commoserve",
        name: "CommoServe",
        headers: {
          "Client-Id": "Commodore",
          "User-Agent": "Assembly Query",
        },
        enabled: true,
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig()));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    await act(async () => {
      await result.current.execute(
        { name: "joyride", category: "apps" },
        { id: "100", category: 40, name: "Joyride" },
        [{ id: "100", category: 40, name: "Joyride" }],
        { id: 0, path: "joyride.prg" },
        [{ id: 0, path: "joyride.prg" }],
      );
    });

    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.phase === "error" && result.current.state.message).toContain("execute failed");
    expect(result.current.state.phase === "error" && result.current.state.recoverableState).toEqual({
      phase: "entries",
      params: { name: "joyride", category: "apps" },
      result: { id: "100", category: 40, name: "Joyride" },
      results: [{ id: "100", category: 40, name: "Joyride" }],
      entries: [{ id: 0, path: "joyride.prg" }],
    });

    executeSpy.mockRestore();
    spy.mockRestore();
  });
});
