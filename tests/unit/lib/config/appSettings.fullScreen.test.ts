import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves the variant default-override mechanism end-to-end at the settings layer, and that the
 * default is now gated by the ACTUAL display profile rather than the variant alone.
 *
 * A keypad-first appliance variant (`c64u-remote`) targets a compact handset with no physical
 * navigation buttons, so hiding Android's on-screen navigation bar there loses nothing. The same
 * APK run on a phone or tablet — medium or expanded profile — is a real touchscreen device: its
 * navigation bar must stay, and the status bar (it carries the clock) must stay on every profile.
 * A persisted user choice in Settings still wins over the default regardless of profile.
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

  it("never defaults the status bar hidden, on any profile, even when the variant requests it", async () => {
    const appSettings = await import("@/lib/config/appSettings");
    expect(appSettings.resolveDefaultHideStatusBar("compact")).toBe(false);
    expect(appSettings.resolveDefaultHideStatusBar("medium")).toBe(false);
    expect(appSettings.resolveDefaultHideStatusBar("expanded")).toBe(false);
    expect(appSettings.loadHideStatusBar("compact")).toBe(false);
    expect(appSettings.loadHideStatusBar("medium")).toBe(false);
  });

  it("defaults the navigation bar hidden at compact, matching the variant's request", async () => {
    const appSettings = await import("@/lib/config/appSettings");
    expect(appSettings.resolveDefaultHideNavigationBar("compact")).toBe(true);
    expect(appSettings.loadHideNavigationBar("compact")).toBe(true);
  });

  it("keeps the navigation bar shown at medium/expanded even though the variant requests hiding it", async () => {
    const appSettings = await import("@/lib/config/appSettings");
    expect(appSettings.resolveDefaultHideNavigationBar("medium")).toBe(false);
    expect(appSettings.resolveDefaultHideNavigationBar("expanded")).toBe(false);
    expect(appSettings.loadHideNavigationBar("medium")).toBe(false);
    expect(appSettings.loadHideNavigationBar("expanded")).toBe(false);
  });

  it("lets a persisted user choice override the profile-aware default on every profile", async () => {
    const appSettings = await import("@/lib/config/appSettings");
    appSettings.saveHideStatusBar(true);
    appSettings.saveHideNavigationBar(false);
    expect(appSettings.loadHideStatusBar("compact")).toBe(true);
    expect(appSettings.loadHideStatusBar("medium")).toBe(true);
    expect(appSettings.loadHideNavigationBar("compact")).toBe(false);
    expect(appSettings.loadHideNavigationBar("medium")).toBe(false);
  });
});
