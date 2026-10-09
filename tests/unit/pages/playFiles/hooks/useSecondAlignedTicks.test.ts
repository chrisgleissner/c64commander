/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { msUntilNextSecond, useSecondAlignedTicks } from "@/pages/playFiles/hooks/useSecondAlignedTicks";

describe("msUntilNextSecond", () => {
  it("waits a whole second while the track has no start", () => {
    expect(msUntilNextSecond(null, 5_000)).toBe(1000);
  });

  it("lands just after the next second of the track's elapsed time", () => {
    expect(msUntilNextSecond(10_000, 12_300)).toBe(715);
    expect(msUntilNextSecond(10_000, 12_000)).toBe(1015);
  });

  it("never waits less than a frame or two, even right before a second turns", () => {
    expect(msUntilNextSecond(10_000, 12_990)).toBe(50);
  });

  it("follows a start in the future, which a rebase onto a later position produces", () => {
    expect(msUntilNextSecond(13_250, 12_000)).toBe(265);
  });
});

describe("useSecondAlignedTicks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The elapsed seconds of a track started at `startedAt.current`, at each tick. */
  const ticksOf = (startedAt: { current: number | null }) => {
    const seen: number[] = [];
    const tick = vi.fn(() => {
      seen.push((Date.now() - (startedAt.current ?? 0)) % 1000);
    });
    return { seen, tick };
  };

  it("ticks at once, then just after each second of elapsed time rather than once a second at any phase", () => {
    const startedAt = { current: 100_000 - 2_300 };
    const { seen, tick } = ticksOf(startedAt);
    renderHook(() => useSecondAlignedTicks(tick, true, startedAt));
    vi.advanceTimersByTime(3_100);
    expect(seen).toEqual([300, 15, 15, 15]);
  });

  it("follows a rebase of the track's start, so the ticks stay on the new seconds", () => {
    const startedAt = { current: 100_000 };
    const { seen, tick } = ticksOf(startedAt);
    renderHook(() => useSecondAlignedTicks(tick, true, startedAt));
    vi.advanceTimersByTime(1_100);
    startedAt.current = Date.now() - 400;
    vi.advanceTimersByTime(2_000);
    expect(seen.slice(-2)).toEqual([15, 15]);
  });

  it("does nothing while disabled, and stops when unmounted", () => {
    const startedAt = { current: 100_000 };
    const tick = vi.fn();
    const { rerender, unmount } = renderHook(({ enabled }) => useSecondAlignedTicks(tick, enabled, startedAt), {
      initialProps: { enabled: false },
    });
    vi.advanceTimersByTime(3_000);
    expect(tick).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(tick).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(3_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
