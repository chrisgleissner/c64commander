/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { useLaunchStopGuard } from "@/pages/playFiles/hooks/useLaunchStopGuard";

describe("useLaunchStopGuard", () => {
  it("sends one Stop for a launch, then sends Stop again once that launch has unwound", () => {
    const stop = vi.fn(async () => undefined);
    const { result, rerender } = renderHook((props) => useLaunchStopGuard(props), {
      initialProps: { isPlaylistLoading: true, isPlaying: false, stop },
    });

    act(() => result.current.stopPlayback());
    act(() => result.current.stopPlayback());
    act(() => result.current.stopPlayback());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.stopPending).toBe(true);

    rerender({ isPlaylistLoading: false, isPlaying: false, stop });
    expect(result.current.stopPending).toBe(false);
    rerender({ isPlaylistLoading: true, isPlaying: false, stop });
    act(() => result.current.stopPlayback());
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("does not hold back Stop while a tune is playing", () => {
    const stop = vi.fn(async () => undefined);
    const { result } = renderHook(() => useLaunchStopGuard({ isPlaylistLoading: true, isPlaying: true, stop }));

    act(() => result.current.stopPlayback());
    act(() => result.current.stopPlayback());
    expect(stop).toHaveBeenCalledTimes(2);
    expect(result.current.stopPending).toBe(false);
  });
});
