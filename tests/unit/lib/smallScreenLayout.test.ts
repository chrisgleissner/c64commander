/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  getDisplayProfileLayoutTokens,
  resolveAutomaticDisplayProfile,
  resolveDisplayProfile,
} from "@/lib/displayProfiles";

/**
 * Small-screen layout contract for a compact 3.25" / 480x640 panel and narrower
 * fallback viewports. jsdom has no layout engine, so this asserts the
 * deterministic display-profile selection and the fluid-width token contract
 * that structurally prevents horizontal overflow; pixel-accurate rendering is
 * covered by the Playwright screenshot suite.
 */
describe("small-screen layout — compact 480x640 panel + narrow fallbacks", () => {
  it("selects the expected profile for each required viewport width", () => {
    // The brief's required viewport widths.
    expect(resolveDisplayProfile(480)).toBe("medium"); // 480x640 portrait width
    expect(resolveDisplayProfile(640)).toBe("expanded"); // 640x480 landscape width
    expect(resolveDisplayProfile(360)).toBe("compact"); // 360x480
    expect(resolveDisplayProfile(320)).toBe("compact"); // 320x480 narrow fallback
  });

  it("classifies the compact 480x640 panel from viewport + physical screen", () => {
    // Portrait: 480 wide viewport on a 480x640 panel -> medium.
    expect(resolveAutomaticDisplayProfile(480, 480, 640)).toBe("medium");
    // Landscape: 640 wide viewport on a 640x480 panel -> short edge 480 -> expanded by width.
    expect(resolveAutomaticDisplayProfile(640, 640, 480)).toBe("expanded");
  });

  it("uses fluid, non-overflowing widths on the smallest screens", () => {
    const compact = getDisplayProfileLayoutTokens("compact");
    // Fluid widths cannot exceed the viewport.
    expect(compact.pageMaxWidth).toBe("100%");
    expect(compact.readingMaxWidth).toBe("100%");
    // Dialogs span the viewport width (with inset), never a fixed width wider than it.
    expect(compact.modalMaxWidth).toBe("100dvw");
    // Avoid dense multi-column action grids on tiny screens.
    expect(compact.actionGridColumns).toBeLessThanOrEqual(2);
    // Content keeps gutters rather than sitting flush to the edges.
    expect(compact.pagePaddingX).not.toBe("0");
    expect(compact.modalInset).not.toBe("0");
  });

  it("keeps every profile's dialog inset and page gutters defined", () => {
    for (const profile of ["compact", "medium", "expanded"] as const) {
      const tokens = getDisplayProfileLayoutTokens(profile);
      expect(tokens.modalInset, `${profile}.modalInset`).toBeTruthy();
      expect(tokens.pagePaddingX, `${profile}.pagePaddingX`).toBeTruthy();
      expect(tokens.actionGridColumns, `${profile}.actionGridColumns`).toBeGreaterThan(0);
    }
  });
});
