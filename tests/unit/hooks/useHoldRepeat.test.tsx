/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoldRepeat } from "@/hooks/useHoldRepeat";

describe("useHoldRepeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once immediately on start, then repeats after the initial delay", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useHoldRepeat(cb));

    act(() => result.current.start());
    expect(cb).toHaveBeenCalledTimes(1); // immediate

    act(() => vi.advanceTimersByTime(400)); // initial delay elapses, interval not yet ticked
    expect(cb).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(300)); // three 100ms repeat ticks
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it("stops repeating (and cancels a pending initial delay) on stop", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useHoldRepeat(cb));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(600)); // past the delay, a couple of ticks
    const count = cb.mock.calls.length;

    act(() => result.current.stop());
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).toHaveBeenCalledTimes(count);
  });

  it("honors custom initial delay and repeat interval", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useHoldRepeat(cb, { initialDelayMs: 200, repeatIntervalMs: 50 }));

    act(() => result.current.start());
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(200 + 50 * 4));
    expect(cb).toHaveBeenCalledTimes(5);
  });

  it("cleans up its timers on unmount so a held control can't fire against a gone component", () => {
    const cb = vi.fn();
    const { result, unmount } = renderHook(() => useHoldRepeat(cb));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(500));
    const count = cb.mock.calls.length;

    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).toHaveBeenCalledTimes(count);
  });

  it("always uses the latest callback without re-creating start/stop", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useHoldRepeat(cb), { initialProps: { cb: first } });
    const startBefore = result.current.start;

    rerender({ cb: second });
    expect(result.current.start).toBe(startBefore); // stable identity

    act(() => result.current.start());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
