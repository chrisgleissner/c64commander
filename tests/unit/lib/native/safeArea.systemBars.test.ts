import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => "web"),
}));
vi.mock("@/lib/native/platform", () => platform);

import { setSystemBarsVisibility } from "@/lib/native/safeArea";

describe("setSystemBarsVisibility", () => {
  afterEach(() => vi.clearAllMocks());

  it("no-ops when not on native Android", async () => {
    platform.isNativePlatform.mockReturnValue(false);
    platform.getPlatform.mockReturnValue("web");
    await expect(setSystemBarsVisibility({ statusBar: false, navigationBar: false })).resolves.toBeUndefined();
  });

  it("drives the plugin and resyncs insets on native Android without throwing", async () => {
    platform.isNativePlatform.mockReturnValue(true);
    platform.getPlatform.mockReturnValue("android");
    // The Capacitor web fallback (safeArea.web) is used under jsdom, so the call
    // resolves; we are exercising the native-guard-passed branch + the resync.
    await expect(setSystemBarsVisibility({ statusBar: false, navigationBar: true })).resolves.toBeUndefined();
  });
});
