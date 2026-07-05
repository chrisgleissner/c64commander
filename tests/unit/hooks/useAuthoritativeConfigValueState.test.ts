/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useDeviceBoundSlider", () => ({
  resolveDeviceBoundSliderWatchdogMs: () => 1000,
}));

import {
  isAuthoritativeConfigValueEqual,
  useAuthoritativeConfigValueState,
} from "@/hooks/useAuthoritativeConfigValueState";

describe("isAuthoritativeConfigValueEqual", () => {
  it("returns true for identical strings", () => {
    expect(isAuthoritativeConfigValueEqual("foo", "foo")).toBe(true);
  });

  it("returns true for identical numbers", () => {
    expect(isAuthoritativeConfigValueEqual(4, 4)).toBe(true);
  });

  it("returns true when whitespace differs around a single token", () => {
    // The original CPU Speed freeze shipped " 4" from the device for a
    // committed `"4"`; strict Object.is left pending stuck.
    expect(isAuthoritativeConfigValueEqual("4", " 4")).toBe(true);
    expect(isAuthoritativeConfigValueEqual(" foo ", "foo")).toBe(true);
  });

  it("returns true for number / numeric-string drift", () => {
    expect(isAuthoritativeConfigValueEqual(4, "4")).toBe(true);
    expect(isAuthoritativeConfigValueEqual("4", 4)).toBe(true);
    expect(isAuthoritativeConfigValueEqual("4", " 4 ")).toBe(true);
  });

  it("does not coerce multi-token strings to numbers", () => {
    // "1 2 3" must not parseFloat to 1 and equal numeric 1.
    expect(isAuthoritativeConfigValueEqual("1 2 3", 1)).toBe(false);
  });

  it("returns false for genuinely different values", () => {
    expect(isAuthoritativeConfigValueEqual("foo", "bar")).toBe(false);
    expect(isAuthoritativeConfigValueEqual(4, 5)).toBe(false);
    expect(isAuthoritativeConfigValueEqual("4", "5")).toBe(false);
  });

  it("treats empty / whitespace-only strings as not-numeric", () => {
    expect(isAuthoritativeConfigValueEqual("", 0)).toBe(false);
    expect(isAuthoritativeConfigValueEqual("   ", 0)).toBe(false);
  });

  it("does not equate NaN with 0 via numeric coercion", () => {
    // tryParseNumeric returns null for NaN; the string-trim fallback then
    // compares "NaN" vs "0" which differ.
    expect(isAuthoritativeConfigValueEqual(Number.NaN, 0)).toBe(false);
  });
});

describe("useAuthoritativeConfigValueState watchdog (HARD9-052)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears a pin whose device echo never arrives once the watchdog window elapses", () => {
    // Regression: an HTTP-successful write whose value never echoes back
    // (device reboots/drops before persisting, reconciliation refetch never
    // lands) stayed latched forever - the row showed the never-applied
    // value and stayed disabled for as long as the page stayed mounted.
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "NTSC");
    });
    expect(result.current.pending).toEqual({ "Video::Mode": true });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.pending).toEqual({});
    expect(result.current.values).toEqual({});
  });

  it("keeps a pin latched before the watchdog window elapses", () => {
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "NTSC");
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.pending).toEqual({ "Video::Mode": true });
  });

  it("does not fire the watchdog after the entry is cleared by a real device echo", () => {
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "NTSC");
    });
    act(() => {
      result.current.clearEntry("Video::Mode");
    });

    // The watchdog timer that was armed on replaceEntry must not resurrect
    // (or error trying to clear) an entry that is already gone.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.pending).toEqual({});
  });

  it("cancels the watchdog for cleared entries on clearAll (routing-epoch reset)", () => {
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "NTSC");
    });
    act(() => {
      result.current.clearAll();
    });
    act(() => {
      result.current.replaceEntry("Turbo::Control", "Manual");
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Only the still-pending post-clearAll entry's own watchdog should have
    // fired; nothing should throw or resurrect the cleared entry.
    expect(result.current.pending).toEqual({});
  });
});

describe("useAuthoritativeConfigValueState restoreEntry race (HARD9-086)", () => {
  it("does not resurrect a stale pin (delete) when a newer write has already superseded it", () => {
    // Regression: pick A (pin A, write A), quickly pick B (pin B, write B
    // queued). Write A fails - its own rollback used to unconditionally
    // delete the pin, flipping the UI to the stale device value while B was
    // still in flight, even though B's own pin should still be authoritative.
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "A");
    });
    act(() => {
      result.current.replaceEntry("Video::Mode", "B");
    });

    act(() => {
      result.current.restoreEntry("Video::Mode", undefined, "A");
    });

    expect(result.current.values).toEqual({ "Video::Mode": "B" });
  });

  it("does not clobber a newer pin when an older write's rollback tries to restore a prior value", () => {
    // If B also fails after A already rolled back (in the old code), B's
    // rollback would re-pin A - a value the device never accepted - latched
    // until an accidental echo or remount. Simulated here by having B's
    // rollback run after C has already superseded it: it must not resurrect
    // A over C's pin either.
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "A");
    });
    act(() => {
      result.current.replaceEntry("Video::Mode", "B");
    });
    act(() => {
      result.current.replaceEntry("Video::Mode", "C");
    });

    act(() => {
      result.current.restoreEntry("Video::Mode", { value: "A" }, "B");
    });

    expect(result.current.values).toEqual({ "Video::Mode": "C" });
  });

  it("still applies the rollback when no newer write has superseded it", () => {
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "A");
    });

    act(() => {
      result.current.restoreEntry("Video::Mode", undefined, "A");
    });

    expect(result.current.values).toEqual({});
  });

  it("still restores to a prior value when no newer write has superseded it", () => {
    const { result } = renderHook(() => useAuthoritativeConfigValueState());

    act(() => {
      result.current.replaceEntry("Video::Mode", "A");
    });
    act(() => {
      result.current.replaceEntry("Video::Mode", "B");
    });

    act(() => {
      result.current.restoreEntry("Video::Mode", { value: "A" }, "B");
    });

    expect(result.current.values).toEqual({ "Video::Mode": "A" });
  });
});
