/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioFxAvailable } from "@/lib/audio/useAudioFxAvailable";

const native = vi.hoisted(() => ({
  available: true,
  resolveProbe: null as ((value: boolean) => void) | null,
}));

vi.mock("@/lib/native/audioFx", () => ({
  isAudioFxAvailable: () => native.available,
  probeAudioFx: () =>
    new Promise<boolean>((resolve) => {
      native.resolveProbe = resolve;
    }),
}));

describe("useAudioFxAvailable", () => {
  beforeEach(() => {
    native.available = true;
    native.resolveProbe = null;
  });

  it("reports availability at once and keeps it when the probe agrees", async () => {
    const { result } = renderHook(() => useAudioFxAvailable());
    expect(result.current).toBe(true);
    await act(async () => native.resolveProbe?.(true));
    expect(result.current).toBe(true);
  });

  it("corrects to unavailable when the probe finds the plugin lacks the calls", async () => {
    const { result } = renderHook(() => useAudioFxAvailable());
    expect(result.current).toBe(true);
    await act(async () => native.resolveProbe?.(false));
    expect(result.current).toBe(false);
  });

  it("corrects to available when the probe succeeds after an initial false", async () => {
    native.available = false;
    const { result } = renderHook(() => useAudioFxAvailable());
    expect(result.current).toBe(false);
    await act(async () => native.resolveProbe?.(true));
    expect(result.current).toBe(true);
  });

  it("ignores a probe that resolves after unmount", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useAudioFxAvailable());
    unmount();
    await act(async () => native.resolveProbe?.(false));
    expect(result.current).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
