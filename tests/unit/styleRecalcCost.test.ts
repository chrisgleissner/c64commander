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

const css = readFileSync(resolve(__dirname, "../../src/index.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

const reducedMotionBlock = /:root\.c64-motion-reduced\s*:is\(([\s\S]*?)\)\s*\{/.exec(css);
const coveredBy = (reducedMotionBlock?.[1] ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const UTILITY_NAME_PATTERNS = ["animate-", "transition", "duration-"];

const rulesDeclaringMotion = () => {
  const withoutKeyframes = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const rules: string[] = [];
  for (const match of withoutKeyframes.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = match;
    if (!/(^|;)\s*(transition|animation)(-[a-z-]+)?\s*:/.test(body)) continue;
    if (selector.includes("c64-motion-reduced")) continue;
    // An element selector cannot reach a pseudo-element; those carry their own reduced-motion rule.
    rules.push(
      ...selector
        .split(",")
        .map((part) => part.trim())
        .filter((part) => !part.includes("::")),
    );
  }
  return rules;
};

const isCovered = (selector: string) => {
  if (UTILITY_NAME_PATTERNS.some((pattern) => selector.includes(pattern))) return true;
  const rightmost =
    selector
      .split(/\s+|>|~|\+/)
      .filter(Boolean)
      .at(-1) ?? "";
  return coveredBy.some((entry) => {
    if (entry === ":focus-visible") return rightmost.includes(":focus-visible");
    if (entry.startsWith("[")) return rightmost.includes(entry.replace(/\]$/, ""));
    return new RegExp(`${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(rightmost);
  });
};

describe("reduced motion scope", () => {
  it("is limited to elements that declare motion instead of matching every element", () => {
    expect(reducedMotionBlock).not.toBeNull();
    expect(css).not.toMatch(/:root\.c64-motion-reduced\s+\*/);
  });

  it("covers every rule in index.css that declares a transition or an animation", () => {
    const rules = rulesDeclaringMotion();
    expect(rules.length).toBeGreaterThan(5);
    const uncovered = rules.filter((selector) => !isCovered(selector));
    expect(uncovered, "add these to the :root.c64-motion-reduced :is(...) list").toEqual([]);
  });

  it("still covers inline transitions, such as the page swipe track's", () => {
    expect(coveredBy).toContain('[style*="transition"]');
    expect(coveredBy).toContain('[style*="animation"]');
  });
});

describe("class attribute selectors in index.css", () => {
  it("only ever test the element itself, never an ancestor or an earlier sibling", () => {
    // On a parent, [class~=] made every class change anywhere restyle the subtree below it: an
    // unrelated class toggle on <body> cost 19 ms on a Pixel 4, and 0.1 ms once the parent test was a
    // class selector. On the element itself it only ever restyles that element.
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((match) => match[1].replace(/\s+/g, " ").trim());
    const offenders = selectors.filter((selector) => /\[class~=[^\]]*\]\)?\s*[>~+ ]\s*[^\s,{]/.test(selector));
    expect(offenders).toEqual([]);
  });
});
