import { describe, expect, it } from "vitest";

import {
  getDisplayProfileLayoutTokens,
  resolveAutomaticDisplayProfile,
  resolveAutomaticDisplayProfileWidth,
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

  it("uses the device short edge as a floor for automatic profile resolution", () => {
    expect(resolveAutomaticDisplayProfileWidth(353, 393, 851)).toBe(393);
    expect(resolveAutomaticDisplayProfile(353, 393, 851)).toBe("medium");
    expect(resolveAutomaticDisplayProfile(320, 320, 640)).toBe("compact");
    expect(resolveAutomaticDisplayProfile(829, 393, 829)).toBe("expanded");
  });

  it("returns distinct layout tokens for compact and expanded modes", () => {
    expect(getDisplayProfileLayoutTokens("compact")).toMatchObject({
      actionGridColumns: 2,
      isCompactDialog: true,
      modalInset: "1rem",
      pagePaddingX: "0.5rem",
      pagePaddingY: "0.5rem",
      pagePaddingTop: "0.5rem",
      rootFontSize: "18px",
    });
    expect(getDisplayProfileLayoutTokens("medium")).toMatchObject({
      pageMaxWidth: "960px",
      actionGridMinWidth: "0px",
      isCompactDialog: false,
      pagePaddingTop: "0.75rem",
      rootFontSize: "19.2px",
    });
    expect(getDisplayProfileLayoutTokens("expanded")).toMatchObject({
      actionGridColumns: 4,
      actionGridMinWidth: "9rem",
      pageMaxWidth: "1200px",
      isCompactDialog: false,
      pagePaddingTop: "0.875rem",
      rootFontSize: "21px",
    });
  });
});

/**
 * The root type size is not a taste setting: it decides the visual angle a reader actually gets,
 * and that depends on how physically large a CSS pixel is on each profile's hardware. This asserts
 * the RULE rather than the numbers, so changing a root size fails here unless it still clears the
 * comfortable-reading threshold for the reader this app targets.
 */
describe("root type size clears the comfortable-reading threshold on each profile's hardware", () => {
  // Cap height measured from the app's rendered glyphs on device.
  const CAP_RATIO = 0.71;
  // A reader at 20/40 - roughly average corrected sight in the 50-60 age range - is at threshold
  // near 10 arcminutes and comfortable from about 20.
  const COMFORTABLE_ARCMIN = 20;

  const mmPerCssPx = (diagonalInches: number, pxWide: number, pxTall: number, dpr: number) =>
    (dpr / (Math.hypot(pxWide, pxTall) / diagonalInches)) * 25.4;

  const arcminutes = (rootPx: number, mmPerPx: number, distanceMm: number) =>
    ((Math.atan((rootPx * CAP_RATIO * mmPerPx) / (2 * distanceMm)) * 2 * 180) / Math.PI) * 60;

  const hardware = {
    // The 3.25in 480x640 handset this profile exists for; hdpi gives the WebView DPR 1.5.
    compact: { mmPerPx: mmPerCssPx(3.25, 480, 640, 1.5), distanceMm: 300 },
    // The 5.7in 1080x2280 phone the app is developed against.
    medium: { mmPerPx: mmPerCssPx(5.7, 1080, 2280, 2.75), distanceMm: 300 },
    // A 10.1in 1200x1920 tablet, held further away. An assumption, unlike the other two.
    expanded: { mmPerPx: mmPerCssPx(10.1, 1200, 1920, 1.5), distanceMm: 400 },
  } as const;

  for (const profile of ["compact", "medium", "expanded"] as const) {
    it(`${profile} is legible at its own viewing distance`, () => {
      const root = Number.parseFloat(getDisplayProfileLayoutTokens(profile).rootFontSize);
      const { mmPerPx, distanceMm } = hardware[profile];
      expect(arcminutes(root, mmPerPx, distanceMm)).toBeGreaterThanOrEqual(COMFORTABLE_ARCMIN);
    });
  }

  it("does not make a denser screen carry SMALLER type than a roomier one", () => {
    // Medium was 16px against compact's 17px, despite almost identical physical pixels - a phone
    // with more room to spend was the harder one to read.
    const compact = Number.parseFloat(getDisplayProfileLayoutTokens("compact").rootFontSize);
    const medium = Number.parseFloat(getDisplayProfileLayoutTokens("medium").rootFontSize);
    const expanded = Number.parseFloat(getDisplayProfileLayoutTokens("expanded").rootFontSize);
    expect(medium).toBeGreaterThanOrEqual(compact);
    expect(expanded).toBeGreaterThanOrEqual(medium);
  });
});
