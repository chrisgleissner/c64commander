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

describe("page-shell TabBar clearance", () => {
  const css = readFileSync(resolve(__dirname, "../../src/index.css"), "utf-8");

  it("page-shell padding-bottom clears the fixed TabBar plus safe-area inset", () => {
    // The .page-shell rule must include padding-bottom with ≥5rem plus
    // safe-area-inset-bottom to prevent content from being hidden behind
    // the fixed TabBar. This regression test locks the fix.
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
    expect(block).toContain("padding-bottom");
    expect(block).toMatch(/padding-bottom:\s*var\(--app-tab-bar-reserved-height\)/);
  });
});
