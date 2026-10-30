/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addLog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logging", () => ({ addLog }));

import { useStableCallback } from "@/hooks/useStableCallback";

type Fn = ((value: number) => void) | undefined;

describe("useStableCallback", () => {
  beforeEach(() => {
    addLog.mockClear();
  });

  it("keeps its identity, calls the latest function and returns undefined for undefined", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn, "onTest"), {
      initialProps: { fn: first as Fn },
    });
    const stable = result.current;
    rerender({ fn: second });
    expect(result.current).toBe(stable);
    stable?.(7);
    expect(second).toHaveBeenCalledWith(7);
    expect(first).not.toHaveBeenCalled();
    rerender({ fn: undefined });
    expect(result.current).toBeUndefined();
  });

  it("ignores a call through a wrapper whose callback was withdrawn, and warns once with the callback's name", () => {
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn, "onScrubStep"), {
      initialProps: { fn: vi.fn() as Fn },
    });
    const heldByATimer = result.current!;
    rerender({ fn: undefined });

    expect(() => heldByATimer(5)).not.toThrow();
    expect(() => heldByATimer(5)).not.toThrow();

    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("withdrawn"),
      expect.objectContaining({ callback: "onScrubStep" }),
    );
  });

  it("warns again for a later withdrawal after the callback came back", () => {
    const restored = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn, "onSeek"), {
      initialProps: { fn: vi.fn() as Fn },
    });
    const wrapper = result.current!;
    rerender({ fn: undefined });
    wrapper(1);
    rerender({ fn: restored });
    wrapper(2);
    expect(restored).toHaveBeenCalledWith(2);
    rerender({ fn: undefined });
    wrapper(3);
    expect(addLog).toHaveBeenCalledTimes(2);
  });
});
