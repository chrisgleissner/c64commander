#!/usr/bin/env node
/*
 * Fails the build when a component sets a font size smaller than the smallest step
 * the display-profile scale knows how to compensate.
 *
 * Why this exists
 * ---------------
 * `src/index.css` scales the named type steps up on the compact profile, so on the
 * smallest screens `text-xs` renders at 16px, `text-sm` at 18px and so on. An
 * arbitrary size written as `text-[9px]` opts out of that entirely: it renders at 9px
 * on every profile, including the smallest screen where it is needed most. That is
 * roughly 1.4mm of text, which is not comfortably readable for an adult with ordinary
 * age-related long sight.
 *
 * `text-[11px]` is the one arbitrary size the stylesheet compensates (to 0.9rem on
 * compact, so 14.4px), which makes it the floor. Anything smaller is a mistake rather
 * than a decision, so it is rejected here instead of being caught later by
 * `playwright/smallScreenErgonomics.spec.ts` - a lint failure names the file and line,
 * where the layout test only reports that some text on some page was too small.
 *
 * Prefer a scale step (`text-xs` and up). Reach for `text-[11px]` only when a dense
 * surface genuinely needs it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve("src");
const MIN_ARBITRARY_PX = 11;
const PATTERN = /text-\[(\d+(?:\.\d+)?)px\]/g;
const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

const walk = (dir) => {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else if (EXTENSIONS.has(path.extname(full))) {
      entries.push(full);
    }
  }
  return entries;
};

const violations = [];

for (const file of walk(SRC_DIR)) {
  const source = readFileSync(file, "utf8");
  source.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(PATTERN)) {
      const px = Number.parseFloat(match[1]);
      if (px < MIN_ARBITRARY_PX) {
        violations.push({
          file: path.relative(process.cwd(), file),
          line: index + 1,
          value: match[0],
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `Font sizes below ${MIN_ARBITRARY_PX}px are not allowed: they bypass the compact-profile\n` +
      "type scale and stay tiny on the smallest supported screen.\n" +
      "Use a scale step (text-xs and up), or text-[11px] if a dense surface needs it.\n",
  );
  for (const { file, line, value } of violations) {
    console.error(`  ${file}:${line}  ${value}`);
  }
  process.exit(1);
}

console.log(`Font size floor: no arbitrary sizes below ${MIN_ARBITRARY_PX}px.`);
