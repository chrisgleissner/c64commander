/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../../../scripts/compile-styles.mjs";
import { APP_STYLES, type AppStyleColors, type AppStyleMode } from "@/generated/appStyles";

/**
 * The same gate this file guards is also enforced at compile time (scripts/compile-styles.mjs),
 * but that only runs when the YAML source changes. This test runs over the committed generated
 * table itself, so a hand-edit of src/generated/appStyles.ts that skipped the compiler cannot slip
 * through (spec.md section 9: "enforced twice ... so a hand-edit of the generated file cannot slip
 * through").
 */
const CONTRAST_GATES: readonly [keyof AppStyleColors, keyof AppStyleColors, number][] = [
  ["foreground", "card", 4.5],
  ["foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["primary", "card", 3],
  ["success", "card", 4.5],
  ["warning", "card", 4.5],
  ["destructive", "card", 4.5],
  ["ring", "card", 3],
  ["ring", "muted-surface", 3],
  ["border", "card", 1.5],
];

const palettes: { styleId: string; mode: AppStyleMode; colors: AppStyleColors }[] = APP_STYLES.flatMap((style) =>
  (["light", "dark"] as const)
    .filter((mode) => style[mode] !== undefined)
    .map((mode) => ({ styleId: style.id, mode, colors: style[mode]!.colors })),
);

describe("appStyles contrast gates (spec.md section 9)", () => {
  it("has 12 palettes to gate", () => {
    expect(palettes).toHaveLength(12);
  });

  it.each(palettes)("$styleId ($mode) passes every contrast gate", ({ colors }) => {
    for (const [subjectKey, backgroundKey, minimum] of CONTRAST_GATES) {
      const ratio = contrastRatio(colors[subjectKey], colors[backgroundKey]);
      expect(ratio, `${subjectKey}/${backgroundKey} contrast`).toBeGreaterThanOrEqual(minimum);
    }
  });

  it.each(palettes)("$styleId ($mode) never sets --ring equal to --border", ({ colors }) => {
    expect(colors.ring).not.toBe(colors.border);
  });
});
