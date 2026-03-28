/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getInsetsMock = vi.fn<() => Promise<{ top: number; right: number; bottom: number; left: number }>>();
const getPlatformMock = vi.fn<() => string>();
const isNativePlatformMock = vi.fn<() => boolean>();

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    getInsets: getInsetsMock,
  }),
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: getPlatformMock,
  isNativePlatform: isNativePlatformMock,
}));

describe("native safe-area sync", () => {
  const originalDevicePixelRatio = window.devicePixelRatio;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.documentElement.removeAttribute("style");
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 3,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalDevicePixelRatio,
    });
  });

  it("applies rounded Android top and horizontal insets without duplicating the footer inset", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");
    getInsetsMock.mockResolvedValue({
      top: 82.6,
      right: 0.4,
      bottom: 18.2,
      left: 1.2,
    });

    const { syncNativeSafeAreaInsets } = await import("@/lib/native/safeArea");
    const insets = await syncNativeSafeAreaInsets();

    expect(insets).not.toBeNull();
    expect(insets?.top).toBeCloseTo(27.533333333333335, 12);
    expect(insets?.right).toBeCloseTo(0.13333333333333333, 12);
    expect(insets?.bottom).toBe(0);
    expect(insets?.left).toBeCloseTo(0.4, 12);
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-top")).toBe("28px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-right")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-bottom")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-left")).toBe("0px");
  });

  it("uses raw inset values when devicePixelRatio is not positive", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");
    getInsetsMock.mockResolvedValue({
      top: 2.4,
      right: 1.6,
      bottom: 5,
      left: 1.2,
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 0,
    });

    const { syncNativeSafeAreaInsets } = await import("@/lib/native/safeArea");
    const insets = await syncNativeSafeAreaInsets();

    expect(insets).toEqual({ top: 2.4, right: 1.6, bottom: 0, left: 1.2 });
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-top")).toBe("2px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-right")).toBe("2px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-bottom")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-left")).toBe("1px");
  });

  it("clears native inset variables outside Android native builds", async () => {
    isNativePlatformMock.mockReturnValue(false);
    getPlatformMock.mockReturnValue("web");
    document.documentElement.style.setProperty("--native-safe-area-inset-top", "83px");
    document.documentElement.style.setProperty("--native-safe-area-inset-bottom", "18px");

    const { syncNativeSafeAreaInsets } = await import("@/lib/native/safeArea");
    const insets = await syncNativeSafeAreaInsets();

    expect(insets).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-top")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-bottom")).toBe("0px");
  });

  it("clears native inset variables on non-android native platforms", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("ios");
    document.documentElement.style.setProperty("--native-safe-area-inset-top", "83px");
    document.documentElement.style.setProperty("--native-safe-area-inset-left", "12px");

    const { syncNativeSafeAreaInsets } = await import("@/lib/native/safeArea");
    const insets = await syncNativeSafeAreaInsets();

    expect(insets).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-top")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-left")).toBe("0px");
  });

  it("logs and clears the variables when the native lookup fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");
    getInsetsMock.mockRejectedValue(new Error("missing insets"));
    document.documentElement.style.setProperty("--native-safe-area-inset-top", "83px");

    const { syncNativeSafeAreaInsets } = await import("@/lib/native/safeArea");
    const insets = await syncNativeSafeAreaInsets();

    expect(insets).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("Failed to synchronize native safe-area insets", {
      error: expect.any(Error),
    });
    expect(document.documentElement.style.getPropertyValue("--native-safe-area-inset-top")).toBe("0px");
    warnSpy.mockRestore();
  });
});
