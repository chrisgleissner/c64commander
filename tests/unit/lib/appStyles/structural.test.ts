/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { APP_STYLES, DEFAULT_APP_STYLE_ID, type AppStyleColors } from "@/generated/appStyles";

const REQUIRED_COLOR_KEYS: readonly (keyof AppStyleColors)[] = [
  "background",
  "card",
  "muted-surface",
  "foreground",
  "muted-foreground",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "border",
  "ring",
  "success",
  "warning",
  "destructive",
  "destructive-foreground",
];

const HSL_TRIPLE_PATTERN = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;
const STYLE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Structural completeness over the committed generated table — a hand-edit that dropped a token,
 * used a non-kebab-case id, or left a mode/colour-block mismatch cannot slip through, independent
 * of the compile-time checks in scripts/compile-styles.mjs (spec.md section 9).
 */
describe("appStyles structural completeness", () => {
  it("declares a default_style that exists among the styles", () => {
    expect(APP_STYLES.some((style) => style.id === DEFAULT_APP_STYLE_ID)).toBe(true);
  });

  it("has no duplicate style ids", () => {
    const ids = APP_STYLES.map((style) => style.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(APP_STYLES.map((style) => [style.id, style] as const))("%s: id is kebab-case", (id) => {
    expect(id).toMatch(STYLE_ID_PATTERN);
  });

  it.each(APP_STYLES.map((style) => [style.id, style] as const))(
    "%s: modes and colour blocks agree exactly",
    (_id, style) => {
      expect(style.modes.length).toBeGreaterThan(0);
      expect(style.modes.includes("light")).toBe(style.light !== undefined);
      expect(style.modes.includes("dark")).toBe(style.dark !== undefined);
    },
  );

  const modeTokenBlocks = APP_STYLES.flatMap((style) =>
    (["light", "dark"] as const)
      .filter((mode) => style[mode] !== undefined)
      .map((mode) => ({ label: `${style.id} (${mode})`, tokens: style[mode]! })),
  );

  it("covers all 12 palettes", () => {
    expect(modeTokenBlocks).toHaveLength(12);
  });

  it.each(modeTokenBlocks.map((block) => [block.label, block] as const))(
    "%s: declares every required colour token as an H S%% L%% triple",
    (_label, block) => {
      for (const key of REQUIRED_COLOR_KEYS) {
        expect(block.tokens.colors[key]).toMatch(HSL_TRIPLE_PATTERN);
      }
    },
  );

  it.each(modeTokenBlocks.map((block) => [block.label, block] as const))(
    "%s: edge is hairline, heavy or gloss and edgeWidthPx matches D10 (1 or 2)",
    (_label, block) => {
      expect(["hairline", "heavy", "gloss"]).toContain(block.tokens.edge);
      expect([1, 2]).toContain(block.tokens.edgeWidthPx);
      expect(block.tokens.edgeWidthPx).toBe(block.tokens.edge === "heavy" ? 2 : 1);
    },
  );

  it.each(modeTokenBlocks.map((block) => [block.label, block] as const))(
    "%s: ringStyle is solid, inverse or glow",
    (_label, block) => {
      expect(["solid", "inverse", "glow"]).toContain(block.tokens.ringStyle);
    },
  );

  it("only vault-black declares appBarBand", () => {
    const withBand = modeTokenBlocks.filter((block) => block.tokens.appBarBand !== undefined);
    expect(withBand.map((block) => block.label)).toEqual(["vault-black (dark)"]);
  });
});
