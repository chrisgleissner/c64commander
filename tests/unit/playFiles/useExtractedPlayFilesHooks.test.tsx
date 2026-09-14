import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_DEVICE_ID_KEY } from "@/pages/playFiles/playFilesUtils";
import * as logging from "@/lib/logging";
import { useAddItemsOverlayState } from "@/pages/playFiles/hooks/useAddItemsOverlayState";
import { useImportNavigationGuards } from "@/pages/playFiles/hooks/useImportNavigationGuards";
import { useResolvedPlaybackDeviceId } from "@/pages/playFiles/hooks/useResolvedPlaybackDeviceId";

const registerNavigationGuard = vi.fn(() => vi.fn());

vi.mock("@/lib/navigation/navigationGuards", () => ({
  registerNavigationGuard: (...args: unknown[]) => registerNavigationGuard(...args),
}));

describe("extracted PlayFiles hooks", () => {
  beforeEach(() => {
    localStorage.clear();
    registerNavigationGuard.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("manages add-items overlay state transitions", () => {
    const { result, rerender } = renderHook(
      ({ browserOpen, addItemsProgressStatus }) => useAddItemsOverlayState({ browserOpen, addItemsProgressStatus }),
      {
        initialProps: {
          browserOpen: false,
          addItemsProgressStatus: "idle" as const,
        },
      },
    );

    expect(result.current.addItemsSurface).toBe("dialog");
    expect(result.current.isImportNavigationBlocked).toBe(false);

    act(() => {
      result.current.handleAutoConfirmStart();
    });
    expect(result.current.addItemsSurface).toBe("page");
    expect(result.current.showAddItemsOverlay).toBe(true);
    expect(result.current.isImportNavigationBlocked).toBe(true);

    rerender({ browserOpen: false, addItemsProgressStatus: "scanning" as const });
    expect(result.current.addItemsSurface).toBe("page");

    rerender({ browserOpen: false, addItemsProgressStatus: "idle" as const });
    expect(result.current.addItemsSurface).toBe("page");

    act(() => {
      result.current.setIsAddingItems(false);
    });
    rerender({ browserOpen: false, addItemsProgressStatus: "idle" as const });
    expect(result.current.addItemsSurface).toBe("dialog");

    rerender({ browserOpen: true, addItemsProgressStatus: "idle" as const });
    expect(result.current.addItemsSurface).toBe("dialog");
  });

  it("registers and cleans up import navigation guards only when blocked", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { rerender, unmount } = renderHook(({ blocked }) => useImportNavigationGuards(blocked), {
      initialProps: { blocked: false },
    });

    expect(registerNavigationGuard).not.toHaveBeenCalled();

    rerender({ blocked: true });
    expect(registerNavigationGuard).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("resolves and persists playback device ids", () => {
    localStorage.setItem(LAST_DEVICE_ID_KEY, "stored-device");

    const { result, rerender } = renderHook(({ deviceInfoId }) => useResolvedPlaybackDeviceId(deviceInfoId), {
      initialProps: { deviceInfoId: null as string | null },
    });

    expect(result.current).toBe("stored-device");

    rerender({ deviceInfoId: "device-123" });
    expect(result.current).toBe("device-123");
    expect(localStorage.getItem(LAST_DEVICE_ID_KEY)).toBe("device-123");
  });

  // Demo Mode's simulated device used to be remembered, so "MOCK-C64U" outlived Demo Mode.
  it("does not remember the simulated device's id", () => {
    localStorage.setItem(LAST_DEVICE_ID_KEY, "real-device");

    const { result } = renderHook(() => useResolvedPlaybackDeviceId("MOCK-C64U", true));

    expect(result.current).toBe("MOCK-C64U");
    expect(localStorage.getItem(LAST_DEVICE_ID_KEY)).toBe("real-device");
  });

  it("forgets a simulated device id stored by an earlier build", () => {
    localStorage.setItem(LAST_DEVICE_ID_KEY, "MOCK-C64U");

    const { result } = renderHook(() => useResolvedPlaybackDeviceId(null));

    expect(result.current).toBe("default");
    expect(localStorage.getItem(LAST_DEVICE_ID_KEY)).toBeNull();
  });

  it("logs persistence errors when storing the playback device id fails", () => {
    const addErrorLogSpy = vi.spyOn(logging, "addErrorLog").mockImplementation(() => undefined);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("write failed");
    });

    const { result } = renderHook(() => useResolvedPlaybackDeviceId("device-456"));

    expect(result.current).toBe("device-456");
    expect(setItemSpy).toHaveBeenCalled();
    expect(addErrorLogSpy).toHaveBeenCalledWith("Failed to persist last known device id", {
      error: "write failed",
    });
  });

  it("falls back to the default device id when localStorage is unavailable", () => {
    const originalLocalStorage = globalThis.localStorage;
    // @ts-expect-error branch coverage: simulate missing storage in this environment
    delete globalThis.localStorage;

    const { result } = renderHook(() => useResolvedPlaybackDeviceId(null));

    expect(result.current).toBe("default");

    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  });
});
