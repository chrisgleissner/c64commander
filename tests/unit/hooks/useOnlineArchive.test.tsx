import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";
import * as archiveClient from "@/lib/archive/client";
import * as archiveExecution from "@/lib/archive/execution";
import { useOnlineArchive } from "@/hooks/useOnlineArchive";
import { createArchiveMock } from "../../mocks/archiveMock";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
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

  it("clears an error state back to idle after a failed preset load", async () => {
    const { result } = renderHook(() => useOnlineArchive(buildDefaultArchiveClientConfig({ hostOverride: "127.0.0.1:1" })));

    await waitFor(() => expect(result.current.state.phase).toBe("error"));

    act(() => {
      result.current.clearError();
    });

    expect(result.current.state.phase).toBe("idle");
  });

  it("clears a preset-load error automatically after the client is recreated successfully", async () => {
    const server = await createCommoserveMock();
    closers.push(server.close);

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useOnlineArchive>[0]) => useOnlineArchive(props),
      {
        initialProps: buildDefaultArchiveClientConfig({ hostOverride: "127.0.0.1:1" }),
      },
    );

    await waitFor(() => expect(result.current.state.phase).toBe("error"));

    rerender(buildDefaultArchiveClientConfig({ hostOverride: server.host }));

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    expect(result.current.state.phase).toBe("idle");
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
        backend: "commodore",
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() =>
      useOnlineArchive({
        backend: "commodore",
        hostOverride: "",
        clientIdOverride: "",
        userAgentOverride: "",
      }),
    );

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
        backend: "commodore",
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() =>
      useOnlineArchive({
        backend: "commodore",
        hostOverride: "",
        clientIdOverride: "",
        userAgentOverride: "",
      }),
    );

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
        backend: "commodore",
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() =>
      useOnlineArchive({
        backend: "commodore",
        hostOverride: "",
        clientIdOverride: "",
        userAgentOverride: "",
      }),
    );

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
        backend: "commodore",
        host: "archive.local",
        clientId: "Commodore",
        userAgent: "Assembly Query",
        baseUrl: "http://archive.local",
      }),
    };
    const spy = vi.spyOn(archiveClient, "createArchiveClient").mockReturnValue(client as never);

    const { result } = renderHook(() =>
      useOnlineArchive({
        backend: "commodore",
        hostOverride: "",
        clientIdOverride: "",
        userAgentOverride: "",
      }),
    );

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
