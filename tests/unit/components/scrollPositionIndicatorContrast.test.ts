/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../../scripts/compile-styles.mjs";
import { APP_STYLES, type AppStyleColors } from "@/generated/appStyles";

const css = readFileSync(resolve(__dirname, "../../../src/index.css"), "utf-8");
const thumbToken = /\.scroll-position-thumb\s*\{[^}]*background:\s*hsl\(var\(--([a-z-]+)\)\)/.exec(css)?.[1];

const palettes = APP_STYLES.flatMap((style) =>
  (["light", "dark"] as const)
    .filter((mode) => style[mode] !== undefined)
    .map((mode) => ({ name: `${style.id} (${mode})`, colors: style[mode]!.colors })),
);

/** WCAG 1.4.11: a graphical object the reader needs to see meets 3:1 against what is behind it. */
const NON_TEXT_CONTRAST = 3;

describe("scroll position indicator contrast", () => {
  it("is drawn in a palette colour", () => {
    expect(thumbToken).toBeDefined();
  });

  it.each(palettes)("$name meets 3:1 against the page, card and muted surface", ({ colors }) => {
    const thumb = colors[thumbToken as keyof AppStyleColors];
    for (const surface of ["background", "card", "muted-surface"] as const) {
      expect(contrastRatio(thumb, colors[surface]), `against ${surface}`).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
    }
  });
});
