import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves the variant default-override mechanism end-to-end at the settings layer:
 * a build variant that sets `runtime.default_hide_*` makes the app default to
 * full-screen with no user action, while a persisted user choice still wins.
 */
vi.mock("@/generated/variant", () => ({
  variant: {
    runtime: {
      defaultDisplayProfile: "auto",
      defaultT9InputEnabled: false,
      defaultHideStatusBar: true,
      defaultHideNavigationBar: true,
      endpoints: {},
    },
  },
}));

describe("appSettings full-screen variant default override", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults full-screen ON when the build variant requests it", async () => {
    const appSettings = await import("@/lib/config/appSettings");
    expect(appSettings.DEFAULT_HIDE_STATUS_BAR).toBe(true);
    expect(appSettings.DEFAULT_HIDE_NAVIGATION_BAR).toBe(true);
    expect(appSettings.loadHideStatusBar()).toBe(true);
    expect(appSettings.loadHideNavigationBar()).toBe(true);
  });

  it("lets a persisted user choice override the variant default", async () => {
    const appSettings = await import("@/lib/config/appSettings");
    appSettings.saveHideStatusBar(false);
    appSettings.saveHideNavigationBar(false);
    expect(appSettings.loadHideStatusBar()).toBe(false);
    expect(appSettings.loadHideNavigationBar()).toBe(false);
  });
});
