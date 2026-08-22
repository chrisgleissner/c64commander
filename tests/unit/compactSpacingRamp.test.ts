/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Nothing else in the suite notices these rules being deleted: the layout specs assert that
 * content fits and type is large enough, and both stay true when a page just gets longer.
 * Asserted here is their shape — what they may reach, and what they may not touch.
 */
describe("compact profile spacing ramp", () => {
  const css = readFileSync(resolve(__dirname, "../../src/index.css"), "utf-8");
  const rampStart = css.indexOf("The compact profile's spacing ramp");
  const ramp = css.slice(rampStart);

  it("still finds the block these assertions are about", () => {
    expect(rampStart).toBeGreaterThan(-1);
  });

  it("rewrites the eight dominant spacing utilities on the compact profile", () => {
    for (const utility of ["p-4", "p-3", "py-3", "py-4", "gap-3", "gap-4", "space-y-3", "space-y-4"]) {
      expect(ramp, `${utility} is no longer rewritten on compact`).toContain(`[class~="${utility}"]`);
    }
    // One rhythm, not a rescaled ramp: every rewritten vertical value is 8px.
    expect(ramp).toMatch(/padding-block:\s*0\.5rem/);
    expect(ramp).toMatch(/row-gap:\s*0\.5rem/);
    expect(ramp).toMatch(/margin-top:\s*0\.5rem/);
  });

  it("reaches page content only", () => {
    const selectors = ramp.match(/^:root\[data-display-profile="compact"\][\s\S]*?\{/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      const scoped = selector.includes(".page-shell") || selector.includes(".tab-bar");
      expect(scoped, `unscoped compact spacing selector: ${selector.replace(/\s+/g, " ")}`).toBe(true);
    }
  });

  it("leaves horizontal separation between neighbouring controls alone", () => {
    // `gap-*` sets both axes; only the row gap may be rewritten, or two controls side by
    // side move closer together and become easier to confuse under a thumb.
    expect(ramp).not.toMatch(/column-gap:/);
    expect(ramp).not.toMatch(/^\s*gap:/m);
    // `px-*` is part of how large a control is to hit.
    expect(ramp).not.toContain('[class~="px-');
  });

  it("keeps the tab bar's frame reservation in step with the bar it draws", () => {
    // The bar's own content on compact is 49.1px: a 44.1px tab item, 2px of rail padding
    // above and below, and the 1px border. The reservation must stay above that or the
    // fixed bar covers the last row of the page.
    expect(css).toMatch(/:root\[data-display-profile="compact"\][\s\S]*?--app-tab-bar-visual-height:\s*2\.8125rem/);
    expect(ramp).toMatch(
      /:root\[data-display-profile="compact"\]\s*\.tab-bar\s*\{[^}]*padding-bottom:\s*var\(--app-chrome-rail-padding-y\)/,
    );
    const reservedPx = 2.8125 * 16 + 0.25 * 16 + 1;
    expect(reservedPx).toBeGreaterThan(49.1);
  });
});
