/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  playSidUpload: vi.fn(async () => undefined),
  startBackgroundExecution: vi.fn(async () => undefined),
  stopBackgroundExecution: vi.fn(async () => undefined),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ playSidUpload: mocks.playSidUpload }),
}));

vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  startBackgroundExecution: mocks.startBackgroundExecution,
  stopBackgroundExecution: mocks.stopBackgroundExecution,
}));

import { SidPlayerProvider, useSidPlayer } from "@/hooks/useSidPlayer";

describe("useSidPlayer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mocks.startBackgroundExecution.mockReset();
    mocks.stopBackgroundExecution.mockReset();
  });

  it("only starts elapsed timer interval while playback is active", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );

    const { result } = renderHook(() => useSidPlayer(), { wrapper });

    expect(setIntervalSpy).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.playTrack({
        id: "track-1",
        title: "Track 1",
        source: "local",
        data: new Uint8Array([1, 2, 3]),
      });
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("does not start background execution in deprecated provider path", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );

    const { result, unmount } = renderHook(() => useSidPlayer(), { wrapper });

    await act(async () => {
      await result.current.playTrack({
        id: "track-1",
        title: "Track 1",
        source: "local",
        data: new Uint8Array([1, 2, 3]),
      });
    });

    expect(mocks.playSidUpload).toHaveBeenCalled();
    expect(mocks.startBackgroundExecution).not.toHaveBeenCalled();

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
  });

  it("throws when legacy hook is used outside provider", () => {
    expect(() => renderHook(() => useSidPlayer())).toThrow(
      "useSidPlayer must be used within SidPlayerProvider",
    );
  });

  it("returns early for empty queue in playQueue", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );
    const { result } = renderHook(() => useSidPlayer(), { wrapper });

    await act(async () => {
      await result.current.playQueue([]);
    });

    expect(mocks.playSidUpload).not.toHaveBeenCalled();
    expect(result.current.currentIndex).toBe(-1);
  });

  it("throws when track is missing playable data", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );
    const { result } = renderHook(() => useSidPlayer(), { wrapper });

    await expect(
      result.current.playTrack({
        id: "missing-data",
        title: "Missing",
        source: "local",
      }),
    ).rejects.toThrow("Missing SID data.");
  });

  it("assigns an id when playTrack is called without one", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );
    const { result } = renderHook(() => useSidPlayer(), { wrapper });

    const track = {
      title: "No ID",
      source: "local" as const,
      data: new Uint8Array([1, 2, 3]),
    };

    await act(async () => {
      await result.current.playTrack(track);
    });

    expect(typeof (track as { id?: string }).id).toBe("string");
    expect((track as { id?: string }).id?.length).toBeGreaterThan(0);
  });

  it("wraps previous and next around queue boundaries", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );
    const { result } = renderHook(() => useSidPlayer(), { wrapper });
    const tracks = [
      {
        id: "a",
        title: "A",
        source: "local" as const,
        data: new Uint8Array([1]),
      },
      {
        id: "b",
        title: "B",
        source: "local" as const,
        data: new Uint8Array([2]),
      },
    ];

    await act(async () => {
      await result.current.playQueue(tracks, 0);
    });

    await act(async () => {
      await result.current.previous();
    });
    expect(result.current.currentIndex).toBe(1);

    await act(async () => {
      await result.current.next();
    });
    expect(result.current.currentIndex).toBe(0);
  });

  it("uses shuffle branch when enabled", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );
    const { result } = renderHook(() => useSidPlayer(), { wrapper });
    const tracks = [
      {
        id: "a",
        title: "A",
        source: "local" as const,
        data: new Uint8Array([1]),
      },
      {
        id: "b",
        title: "B",
        source: "local" as const,
        data: new Uint8Array([2]),
      },
      {
        id: "c",
        title: "C",
        source: "local" as const,
        data: new Uint8Array([3]),
      },
    ];

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.8);
    await act(async () => {
      await result.current.playQueue(tracks, 0);
    });

    await act(async () => {
      result.current.setShuffle(true);
    });

    await act(async () => {
      await result.current.next();
    });

    expect(result.current.currentIndex).toBe(2);
    randomSpy.mockRestore();
  });

  it("auto-advances when elapsed time reaches duration", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );
    const { result } = renderHook(() => useSidPlayer(), { wrapper });
    const tracks = [
      {
        id: "a",
        title: "A",
        source: "local" as const,
        data: new Uint8Array([1]),
        durationMs: 100,
      },
      {
        id: "b",
        title: "B",
        source: "local" as const,
        data: new Uint8Array([2]),
        durationMs: 100,
      },
    ];

    await act(async () => {
      await result.current.playQueue(tracks, 0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.currentIndex).toBe(1);
    expect(mocks.playSidUpload).toHaveBeenCalledTimes(2);
  });
});
