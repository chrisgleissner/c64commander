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

  it("makes the swipe viewport — never the page-shell scroll box — clear the fixed tab bar", () => {
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
      /--app-tab-bar-frame-height:\s*calc\([\s\S]*?--app-tab-bar-visual-height\)[\s\S]*?--app-tab-bar-safe-area-bottom[\s\S]*?\)/,
    );
    expect(css).not.toMatch(/2\s*\*\s*var\(--app-tab-bar-safe-area-bottom\)/);
    expect(css).toMatch(/--app-tab-bar-reserved-height:\s*var\(--app-tab-bar-frame-height\)\s*;/);
    expect(css).toMatch(/\.tab-bar-frame\s*\{[^}]*min-height:\s*var\(--app-tab-bar-frame-height\)/s);
    expect(css).toMatch(/\.tab-bar-frame\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.tab-bar\s*\{[^}]*min-height:\s*var\(--app-tab-bar-visual-height\)/s);
    expect(css).toMatch(/\.tab-bar\s*\{[^}]*pointer-events:\s*auto/s);
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/min-height:\s*0/);
    // Regression guard for the BUG-066 -> BUG-072 recurrence. The swipe viewport that
    // hosts .page-shell is sized `calc(100dvh - var(--app-tab-bar-reserved-height))`, so it
    // already ends at the fixed tab bar's top. The .page-shell scroll box must NEVER
    // reserve the tab-bar height a second time — not as padding-bottom (BUG-066), not as
    // margin-bottom (BUG-072), not via any property — or a dead gap one tab-bar tall opens
    // below the content and above the tab bar. Two Ralph loops re-introduced this from a
    // false "content sits under the fixed tab bar" premise; this assertion locks out the
    // whole class. (The .page-shell comment must not mention the literal variable name.)
    expect(block).not.toMatch(/--app-tab-bar-reserved-height/);
    expect(block).toMatch(/padding-bottom:\s*var\(--display-profile-page-padding-y\)\s*;/);
    // The tab-bar reservation lives in the swipe viewport — the one correct place.
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

  it("keeps the hardware-key selected-control ring visible over component focus utilities", () => {
    const rule = css.match(/\[data-key-selected="true"\]\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(rule).toMatch(/outline:\s*2px solid hsl\(var\(--ring\)\)\s*!important\s*;/);
    expect(rule).toMatch(/outline-offset:\s*2px\s*!important\s*;/);
    expect(rule).toMatch(/box-shadow:[\s\S]*!important\s*;/);
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
