import { afterEach, describe, expect, it, vi } from "vitest";

const { setSystemBarsVisibility, loadHideStatusBar, loadHideNavigationBar } = vi.hoisted(() => ({
  setSystemBarsVisibility: vi.fn(() => Promise.resolve()),
  loadHideStatusBar: vi.fn(() => false),
  loadHideNavigationBar: vi.fn(() => false),
}));

vi.mock("@/lib/native/safeArea", () => ({ setSystemBarsVisibility }));
vi.mock("@/lib/config/appSettings", () => ({ loadHideStatusBar, loadHideNavigationBar }));

import { applyFullScreenFromSettings } from "@/lib/native/fullScreen";

describe("applyFullScreenFromSettings", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows both bars when neither is hidden", () => {
    loadHideStatusBar.mockReturnValue(false);
    loadHideNavigationBar.mockReturnValue(false);
    applyFullScreenFromSettings();
    expect(setSystemBarsVisibility).toHaveBeenCalledWith({ statusBar: true, navigationBar: true });
  });

  it("hides exactly the bars the settings request (visibility = NOT hidden)", () => {
    loadHideStatusBar.mockReturnValue(true);
    loadHideNavigationBar.mockReturnValue(false);
    applyFullScreenFromSettings();
    expect(setSystemBarsVisibility).toHaveBeenCalledWith({ statusBar: false, navigationBar: true });
  });

  it("hides both bars for full-screen", () => {
    loadHideStatusBar.mockReturnValue(true);
    loadHideNavigationBar.mockReturnValue(true);
    applyFullScreenFromSettings();
    expect(setSystemBarsVisibility).toHaveBeenCalledWith({ statusBar: false, navigationBar: false });
  });
});
