import { afterEach, describe, expect, it, vi } from "vitest";

const { platform, plugin } = vi.hoisted(() => ({
  platform: { isNativePlatform: vi.fn(() => false), getPlatform: vi.fn(() => "web") },
  plugin: {
    getInsets: vi.fn(async () => ({ top: 0, right: 0, bottom: 0, left: 0 })),
    setSystemBarsVisibility: vi.fn(async () => undefined),
    setSystemBarsAppearance: vi.fn(async () => undefined),
  },
}));
vi.mock("@/lib/native/platform", () => platform);
vi.mock("@capacitor/core", () => ({ registerPlugin: () => plugin }));

import { setSystemBarsVisibility, syncNativeSystemBarAppearance } from "@/lib/native/safeArea";

describe("setSystemBarsVisibility", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not call the plugin when not on native Android", async () => {
    platform.isNativePlatform.mockReturnValue(false);
    platform.getPlatform.mockReturnValue("web");
    await setSystemBarsVisibility({ statusBar: false, navigationBar: false });
    expect(plugin.setSystemBarsVisibility).not.toHaveBeenCalled();
  });

  it("drives the plugin with the options and resyncs insets on native Android", async () => {
    platform.isNativePlatform.mockReturnValue(true);
    platform.getPlatform.mockReturnValue("android");
    const opts = { statusBar: false, navigationBar: true };
    await setSystemBarsVisibility(opts);
    expect(plugin.setSystemBarsVisibility).toHaveBeenCalledWith(opts);
    expect(plugin.getInsets).toHaveBeenCalled(); // syncNativeSafeAreaInsets() resync
  });

  it("swallows a plugin failure (logs a warning) and still resyncs", async () => {
    platform.isNativePlatform.mockReturnValue(true);
    platform.getPlatform.mockReturnValue("android");
    plugin.setSystemBarsVisibility.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(setSystemBarsVisibility({ statusBar: true, navigationBar: true })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(plugin.getInsets).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("syncNativeSystemBarAppearance", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not call the plugin when not on native Android", async () => {
    platform.isNativePlatform.mockReturnValue(false);
    platform.getPlatform.mockReturnValue("web");
    await syncNativeSystemBarAppearance("light");
    expect(plugin.setSystemBarsAppearance).not.toHaveBeenCalled();
  });

  it("requests dark icons (light bars) for the light theme on native Android", async () => {
    platform.isNativePlatform.mockReturnValue(true);
    platform.getPlatform.mockReturnValue("android");
    await syncNativeSystemBarAppearance("light");
    expect(plugin.setSystemBarsAppearance).toHaveBeenCalledWith({ light: true });
  });

  it("requests light icons (dark bars) for the dark theme on native Android", async () => {
    platform.isNativePlatform.mockReturnValue(true);
    platform.getPlatform.mockReturnValue("android");
    await syncNativeSystemBarAppearance("dark");
    expect(plugin.setSystemBarsAppearance).toHaveBeenCalledWith({ light: false });
  });

  it("swallows a plugin failure and logs a warning", async () => {
    platform.isNativePlatform.mockReturnValue(true);
    platform.getPlatform.mockReturnValue("android");
    plugin.setSystemBarsAppearance.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(syncNativeSystemBarAppearance("light")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
