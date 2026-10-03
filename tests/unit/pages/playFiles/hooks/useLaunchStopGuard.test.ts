/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

import { addErrorLog } from "@/lib/logging";
import { useLaunchStopGuard } from "@/pages/playFiles/hooks/useLaunchStopGuard";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useLaunchStopGuard", () => {
  it("sends one Stop for a launch, then sends Stop again once that launch has unwound", async () => {
    const stop = vi.fn(async () => undefined);
    const { result, rerender } = renderHook((props) => useLaunchStopGuard(props), {
      initialProps: { isPlaylistLoading: true, isPlaying: false, stop },
    });

    await act(async () => result.current.stopPlayback());
    await act(async () => result.current.stopPlayback());
    await act(async () => result.current.stopPlayback());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.stopPending).toBe(true);

    rerender({ isPlaylistLoading: false, isPlaying: false, stop });
    expect(result.current.stopPending).toBe(false);
    rerender({ isPlaylistLoading: true, isPlaying: false, stop });
    await act(async () => result.current.stopPlayback());
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("does not hold back a second Stop while a tune is playing once the first has been answered", async () => {
    const stop = vi.fn(async () => undefined);
    const { result } = renderHook(() => useLaunchStopGuard({ isPlaylistLoading: true, isPlaying: true, stop }));

    await act(async () => result.current.stopPlayback());
    await act(async () => result.current.stopPlayback());
    expect(stop).toHaveBeenCalledTimes(2);
    expect(result.current.stopPending).toBe(false);
  });

  it("shows Stopping until the device answers Stop, and clears it when the request resolves", async () => {
    const answer = deferred();
    const stop = vi.fn(() => answer.promise);
    const { result } = renderHook(() => useLaunchStopGuard({ isPlaylistLoading: false, isPlaying: true, stop }));

    act(() => result.current.stopPlayback());
    expect(result.current.stopping).toBe(true);
    act(() => result.current.stopPlayback());
    expect(stop).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve());
    expect(result.current.stopping).toBe(false);
  });

  it("clears Stopping when the Stop request fails, and logs the failure", async () => {
    const answer = deferred();
    const stop = vi.fn(() => answer.promise);
    const { result } = renderHook(() => useLaunchStopGuard({ isPlaylistLoading: false, isPlaying: true, stop }));

    act(() => result.current.stopPlayback());
    expect(result.current.stopping).toBe(true);

    await act(async () => answer.reject(new Error("reset timed out")));
    expect(result.current.stopping).toBe(false);
    expect(addErrorLog).toHaveBeenCalledWith(
      "Playback: Stop failed",
      expect.objectContaining({ error: "reset timed out" }),
    );
  });
});
