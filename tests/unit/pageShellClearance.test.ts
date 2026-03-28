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
import { getDisplayProfileLayoutTokens } from "@/lib/displayProfiles";

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

    expect(css).toMatch(/--app-tab-bar-safe-area-bottom:\s*var\(--safe-area-inset-bottom\)\s*;/);
    expect(css).toMatch(/--app-tab-bar-visual-height:\s*3\.5rem\s*;/);
    expect(css).toMatch(
      /--app-tab-bar-reserved-height:\s*calc\(\s*var\(--app-tab-bar-visual-height\)\s*\+\s*var\(--app-tab-bar-safe-area-bottom\)\s*\)/,
    );
    expect(css).toMatch(/\.tab-bar-frame\s*\{[^}]*min-height:\s*var\(--app-tab-bar-reserved-height\)/s);
    expect(css).toMatch(/\.tab-bar\s*\{[^}]*min-height:\s*var\(--app-tab-bar-visual-height\)/s);
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/min-height:\s*0/);
    expect(swipeNavSource).toContain('height: "calc(100dvh - var(--app-tab-bar-reserved-height))"');
  });

  it("derives shared top and bottom safe-area variables from both CSS env values and native insets", () => {
    expect(css).toMatch(
      /--safe-area-inset-top:\s*max\(env\(safe-area-inset-top,\s*0px\),\s*var\(--native-safe-area-inset-top\)\)/,
    );
    expect(css).toMatch(
      /--safe-area-inset-bottom:\s*max\(env\(safe-area-inset-bottom,\s*0px\),\s*var\(--native-safe-area-inset-bottom\)\)/,
    );
  });

  it("keeps the initial page handoff tighter than the general page rhythm", () => {
    expect(getDisplayProfileLayoutTokens("compact").pagePaddingTop).toBe("0.5rem");
    expect(getDisplayProfileLayoutTokens("medium").pagePaddingTop).toBe("0.75rem");
    expect(getDisplayProfileLayoutTokens("expanded").pagePaddingTop).toBe("0.875rem");
    expect(Number.parseFloat(getDisplayProfileLayoutTokens("medium").pagePaddingTop)).toBeLessThan(
      Number.parseFloat(getDisplayProfileLayoutTokens("medium").pagePaddingY),
    );
  });
});
