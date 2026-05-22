import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRemoteFonts, GOOGLE_FONTS_STYLESHEET } from "@/lib/startup/fontLoading";
import { isNativePlatform } from "@/lib/native/platform";

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: vi.fn(() => false),
}));

describe("fontLoading", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.mocked(isNativePlatform).mockReset();
    vi.mocked(isNativePlatform).mockReturnValue(false);
  });

  it("does not start remote Google Fonts requests on native startup", () => {
    vi.mocked(isNativePlatform).mockReturnValue(true);

    expect(loadRemoteFonts(document)).toBe(false);
    expect(document.head.querySelector(`link[href="${GOOGLE_FONTS_STYLESHEET}"]`)).toBeNull();
  });

  it("keeps web font loading for browser builds", () => {
    expect(loadRemoteFonts(document)).toBe(true);

    const link = document.head.querySelector("link");
    expect(link).toBeInstanceOf(HTMLLinkElement);
    expect((link as HTMLLinkElement).href).toBe(GOOGLE_FONTS_STYLESHEET);
    expect((link as HTMLLinkElement).rel).toBe("stylesheet");
  });
});
