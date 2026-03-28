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

describe("page-shell bounded viewport contract", () => {
  const css = readFileSync(resolve(__dirname, "../../src/index.css"), "utf-8");
  const swipeNavSource = readFileSync(resolve(__dirname, "../../src/components/SwipeNavigationLayer.tsx"), "utf-8");

  it("separates the swipe viewport from the fixed tab bar instead of relying on page padding hacks", () => {
    const start = css.indexOf(".page-shell {");
    let depth = 0;
    let blockEnd = start;
    for (let i = start; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") {
        depth--;
        if (depth === 0) {
          blockEnd = i;
          break;
        }
      }
    }
    const block = css.slice(start, blockEnd);

    expect(css).toMatch(/--app-tab-bar-reserved-height:\s*calc\(\s*5rem\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/);
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/min-height:\s*0/);
    expect(swipeNavSource).toContain('height: "calc(100dvh - var(--app-tab-bar-reserved-height))"');
  });
});
