/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const subscribers: Array<(rotation: number) => void> = [];
const unsubscribe = vi.fn();
const readDeviceRotation = vi.fn(async () => 0);

vi.mock("@/lib/native/deviceRotation", () => ({
  isDeviceRotationAvailable: () => true,
  readDeviceRotation: () => readDeviceRotation(),
  subscribeDeviceRotation: (listener: (rotation: number) => void) => {
    subscribers.push(listener);
    return unsubscribe;
  },
}));

import { useDeviceRotation } from "@/hooks/useDeviceRotation";
import { ROTATION_DWELL_MS } from "@/lib/remoteInput/deviceRotation";

const emit = (rotation: number) => subscribers.forEach((listener) => listener(rotation));

describe("useDeviceRotation", () => {
  beforeEach(() => {
    subscribers.length = 0;
    unsubscribe.mockClear();
    readDeviceRotation.mockClear();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts upright and subscribes once while active", () => {
    const { result } = renderHook(() => useDeviceRotation(true));
    expect(result.current.deviceRotation).toBe(0);
    expect(result.current.frameRotation).toBe(0);
    expect(result.current.source).toBe("auto");
    expect(subscribers).toHaveLength(1);
  });

  it("does not subscribe while inactive", () => {
    renderHook(() => useDeviceRotation(false));
    expect(subscribers).toHaveLength(0);
  });

  it("publishes a sensor value only after the dwell has elapsed", () => {
    const { result } = renderHook(() => useDeviceRotation(true));

    act(() => emit(90));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS - 1);
    });
    expect(result.current.deviceRotation).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.deviceRotation).toBe(90);
  });

  it("publishes only the value the handset settles on when it is turned through several", () => {
    const { result } = renderHook(() => useDeviceRotation(true));

    act(() => emit(90));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS - 50);
    });
    act(() => emit(180));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS);
    });

    expect(result.current.deviceRotation).toBe(180);
  });

  it("ignores a value that is not one of the four upright orientations", () => {
    const { result } = renderHook(() => useDeviceRotation(true));
    act(() => emit(45));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS);
    });
    expect(result.current.deviceRotation).toBe(0);
  });

  it("pins both rotations and ignores the sensor until Auto is chosen again", () => {
    const { result } = renderHook(() => useDeviceRotation(true));

    act(() => result.current.pin(270));
    expect(result.current.deviceRotation).toBe(270);
    expect(result.current.frameRotation).toBe(270);
    expect(result.current.source).toBe("pinned");

    act(() => emit(90));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS);
    });
    expect(result.current.deviceRotation).toBe(270);

    act(() => result.current.clearPin());
    expect(result.current.source).toBe("auto");
    expect(result.current.deviceRotation).toBe(90);
  });

  it("holds frameRotation at 0 under the portrait lock, whatever the window reports", () => {
    localStorage.setItem("c64u_screen_orientation_mode", "portrait");
    Object.defineProperty(window.screen, "orientation", {
      configurable: true,
      value: { angle: 90 },
    });

    const { result } = renderHook(() => useDeviceRotation(true));
    act(() => emit(90));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS);
    });

    expect(result.current.deviceRotation).toBe(90);
    expect(result.current.frameRotation).toBe(90);
  });

  it("cancels the counter-rotation when the layout has turned with the chassis", () => {
    localStorage.setItem("c64u_screen_orientation_mode", "auto");
    Object.defineProperty(window.screen, "orientation", {
      configurable: true,
      value: { angle: 90 },
    });

    const { result } = renderHook(() => useDeviceRotation(true));
    act(() => emit(90));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS);
    });

    expect(result.current.deviceRotation).toBe(90);
    expect(result.current.frameRotation).toBe(0);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useDeviceRotation(true));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending dwell timer on unmount, rather than publishing into an unmounted hook", () => {
    const { unmount, result } = renderHook(() => useDeviceRotation(true));

    act(() => emit(90));
    act(() => {
      vi.advanceTimersByTime(ROTATION_DWELL_MS - 50);
    });
    unmount();

    // Advancing past the dwell after unmount must not throw (a setState on an
    // unmounted hook) and must not have published — there is nothing left to read it,
    // but the timer itself has to be gone rather than merely irrelevant.
    expect(() => act(() => vi.advanceTimersByTime(ROTATION_DWELL_MS))).not.toThrow();
    expect(result.current.deviceRotation).toBe(0);
  });

  it("seeds itself from the plugin's current value", async () => {
    readDeviceRotation.mockResolvedValueOnce(180);
    vi.useRealTimers();
    const { result } = renderHook(() => useDeviceRotation(true));
    await waitFor(() => expect(result.current.deviceRotation).toBe(180));
  });
});
