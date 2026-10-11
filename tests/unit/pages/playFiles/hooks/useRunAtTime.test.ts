/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRunAtTime } from "@/pages/playFiles/hooks/useRunAtTime";

describe("useRunAtTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once when the clock reaches the time, and not before", () => {
    const run = vi.fn();
    renderHook(() => useRunAtTime(run, 52_000));
    vi.advanceTimersByTime(1_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs at once for a time already past", () => {
    const run = vi.fn();
    renderHook(() => useRunAtTime(run, 40_000));
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits again when its timer fires before the clock says the time has come", () => {
    const run = vi.fn();
    renderHook(() => useRunAtTime(run, 52_000));
    vi.setSystemTime(49_990);
    vi.advanceTimersByTime(2_000);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("follows a new time and never runs for null", () => {
    const run = vi.fn();
    const { rerender } = renderHook(({ atMs }: { atMs: number | null }) => useRunAtTime(run, atMs), {
      initialProps: { atMs: 52_000 as number | null },
    });
    rerender({ atMs: 55_000 });
    vi.advanceTimersByTime(4_000);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    rerender({ atMs: null });
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
