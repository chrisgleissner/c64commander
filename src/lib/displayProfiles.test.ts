import { describe, expect, it } from "vitest";

import {
  getDisplayProfileLayoutTokens,
  resolveDisplayProfile,
  resolveEffectiveDisplayProfile,
} from "@/lib/displayProfiles";

describe("displayProfiles", () => {
  it("resolves width thresholds at the exact profile boundaries", () => {
    expect(resolveDisplayProfile(0)).toBe("medium");
    expect(resolveDisplayProfile(360)).toBe("compact");
    expect(resolveDisplayProfile(361)).toBe("medium");
    expect(resolveDisplayProfile(599)).toBe("medium");
    expect(resolveDisplayProfile(600)).toBe("expanded");
  });

  it("lets an explicit override replace the automatic viewport profile", () => {
    expect(resolveEffectiveDisplayProfile(320, "auto")).toBe("compact");
    expect(resolveEffectiveDisplayProfile(320, "expanded")).toBe("expanded");
    expect(resolveEffectiveDisplayProfile(900, "compact")).toBe("compact");
  });

  it("returns distinct layout tokens for compact and expanded modes", () => {
    expect(getDisplayProfileLayoutTokens("compact")).toMatchObject({
      actionGridColumns: 2,
      isCompactDialog: true,
      modalInset: "1rem",
      pagePaddingX: "0.5rem",
      pagePaddingY: "0.5rem",
      rootFontSize: "16px",
    });
    expect(getDisplayProfileLayoutTokens("medium")).toMatchObject({
      pageMaxWidth: "960px",
      actionGridMinWidth: "0px",
      isCompactDialog: false,
      rootFontSize: "16px",
    });
    expect(getDisplayProfileLayoutTokens("expanded")).toMatchObject({
      actionGridColumns: 4,
      actionGridMinWidth: "9rem",
      pageMaxWidth: "1200px",
      isCompactDialog: false,
      rootFontSize: "17.5px",
    });
  });
});
