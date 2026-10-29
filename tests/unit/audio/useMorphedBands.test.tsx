/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MORPH_MS, useMorphedBands } from "@/lib/audio/tone/useMorphedBands";

const FLAT = new Array<number>(10).fill(0);
const BASS = [6, 6, 5, 3, 1, 0, 0, 0, 0, 0];

describe("useMorphedBands", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove("c64-motion-reduced");
  });

  const render = (initial: readonly number[], animate = true) => {
    const immediate = { current: false };
    const hook = renderHook(({ bands }) => useMorphedBands(bands, animate, immediate), {
      initialProps: { bands: initial },
    });
    return { ...hook, immediate };
  };

  it("morphs from the old curve to the new one without overshooting, then lands exactly on it", () => {
    const { result, rerender } = render(FLAT);
    rerender({ bands: BASS });
    expect(result.current).toEqual(FLAT);
    act(() => vi.advanceTimersByTime(MORPH_MS / 3));
    const midway = result.current[0];
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(6);
    act(() => vi.advanceTimersByTime(MORPH_MS));
    expect(result.current).toEqual(BASS);
    expect(Math.max(...result.current)).toBe(6);
  });

  it("draws a change marked immediate at once and clears the mark", () => {
    const { result, rerender, immediate } = render(FLAT);
    immediate.current = true;
    rerender({ bands: BASS });
    expect(result.current).toEqual(BASS);
    expect(immediate.current).toBe(false);
  });

  it("draws every change at once under reduced motion or when animation is off", () => {
    document.documentElement.classList.add("c64-motion-reduced");
    const reduced = render(FLAT);
    reduced.rerender({ bands: BASS });
    expect(reduced.result.current).toEqual(BASS);

    document.documentElement.classList.remove("c64-motion-reduced");
    const still = render(FLAT, false);
    still.rerender({ bands: BASS });
    expect(still.result.current).toEqual(BASS);
  });

  it("restarts from where it is when the target changes mid-morph and stops its frames on unmount", () => {
    const { result, rerender, unmount } = render(FLAT);
    rerender({ bands: BASS });
    act(() => vi.advanceTimersByTime(MORPH_MS / 2));
    const partway = [...result.current];
    rerender({ bands: FLAT });
    expect(result.current).toEqual(partway);
    unmount();
    expect(() => vi.advanceTimersByTime(MORPH_MS)).not.toThrow();
  });
});
