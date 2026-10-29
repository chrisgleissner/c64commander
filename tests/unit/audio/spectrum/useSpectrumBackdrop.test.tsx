/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => ({ active: true }));
const native = vi.hoisted(() => ({
  setSpectrumDemand: vi.fn(async () => true),
  readSpectrum: vi.fn(async () => ({ active: true, sequence: 1, bands: new Array(48).fill(-20) })),
}));
vi.mock("@/hooks/usePageActivity", () => ({ usePageActivity: () => page.active }));
vi.mock("@/lib/native/audioFx", () => native);

import { BACKDROP_BANDS, BACKDROP_OWNER, useSpectrumBackdrop } from "@/lib/audio/spectrum/useSpectrumBackdrop";

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("useSpectrumBackdrop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    page.active = true;
    native.setSpectrumDemand.mockClear();
    native.readSpectrum.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("asks for the analyser while wanted and returns smoothed levels", async () => {
    const { result } = renderHook(() => useSpectrumBackdrop(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(native.setSpectrumDemand).toHaveBeenLastCalledWith(BACKDROP_OWNER, true);
    expect(result.current).toHaveLength(BACKDROP_BANDS);
  });

  it("releases its demand and returns null once it is no longer wanted", async () => {
    const { result, rerender } = renderHook(({ wanted }) => useSpectrumBackdrop(wanted), {
      initialProps: { wanted: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ wanted: false });
    expect(native.setSpectrumDemand).toHaveBeenLastCalledWith(BACKDROP_OWNER, false);
    expect(result.current).toBeNull();
    const reads = native.readSpectrum.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(native.readSpectrum.mock.calls.length).toBe(reads);
  });

  it("releases its demand while the app is hidden and asks again when it shows", async () => {
    const { result } = renderHook(() => useSpectrumBackdrop(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => setHidden(true));
    expect(native.setSpectrumDemand).toHaveBeenLastCalledWith(BACKDROP_OWNER, false);
    expect(result.current).toBeNull();
    act(() => setHidden(false));
    expect(native.setSpectrumDemand).toHaveBeenLastCalledWith(BACKDROP_OWNER, true);
  });

  it("never asks while its page is off screen", () => {
    page.active = false;
    renderHook(() => useSpectrumBackdrop(true));
    expect(native.setSpectrumDemand).not.toHaveBeenCalled();
  });
});
