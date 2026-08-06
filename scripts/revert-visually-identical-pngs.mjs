#!/usr/bin/env node
/*
 * Reverts screenshots that differ from a baseline byte-for-byte but not to the eye.
 *
 * Why this is not `revert-identical-pngs.mjs`
 * ------------------------------------------
 * That script compares bytes, which catches the case where a capture reproduced its
 * committed file exactly. It does not catch the far more common one: the same UI
 * rendered on a different machine, where anti-aliasing and font hinting shift a few
 * pixels by a shade. Those files differ in every byte after the PNG header while
 * looking identical, so a whole-corpus regeneration lands ~200 changed files of which
 * only a handful show a real change. Reviewing that diff is not possible.
 *
 * This compares pixels instead, using ImageMagick, and reverts anything whose
 * difference is below a perceptual threshold. What is left is the set a human should
 * actually look at.
 *
 * Usage:
 *   node scripts/revert-visually-identical-pngs.mjs [--baseline <ref>] [--dir <path>]
 *                                                   [--fuzz <pct>] [--threshold <pct>]
 *                                                   [--dry-run]
 *
 * Defaults: baseline origin/main, dir docs/img, fuzz 2%, threshold 0.10% of pixels.
 *
 * A file is KEPT (treated as a real change) when it is new, deleted, differently
 * sized, or when more than `threshold` of its pixels differ by more than `fuzz`.
 * Anything else is restored from the baseline.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const baseline = flag("baseline", "origin/main");
const dir = flag("dir", "docs/img");
const fuzz = Number(flag("fuzz", "2"));
const thresholdPct = Number(flag("threshold", "0.10"));
const dryRun = args.includes("--dry-run");

const git = (gitArgs, options = {}) =>
  execFileSync("git", gitArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });

const changed = git(["diff", "--name-only", `${baseline}...HEAD`, "--", dir])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith(".png"));

// Files changed in the working tree but not yet committed matter too, so a
// regeneration can be pruned before it is staged.
const working = git(["diff", "--name-only", "--", dir])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith(".png"));

const candidates = [...new Set([...changed, ...working])].sort();
if (candidates.length === 0) {
  console.log(`No changed PNGs under ${dir} against ${baseline}.`);
  process.exit(0);
}

const work = mkdtempSync(path.join(tmpdir(), "png-compare-"));
const kept = [];
const reverted = [];
const added = [];

const dimensionsOf = (file) => {
  try {
    return execFileSync("identify", ["-format", "%wx%h", file], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

try {
  for (const file of candidates) {
    if (!existsSync(file)) {
      // Deleted on this branch: a real change, leave it alone.
      kept.push(`${file} (deleted)`);
      continue;
    }

    let baseBytes;
    try {
      baseBytes = execFileSync("git", ["show", `${baseline}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
    } catch {
      added.push(file);
      continue;
    }

    const basePath = path.join(work, "base.png");
    writeFileSync(basePath, baseBytes);

    const beforeSize = dimensionsOf(basePath);
    const afterSize = dimensionsOf(file);
    if (!beforeSize || !afterSize || beforeSize !== afterSize) {
      kept.push(`${file} (${beforeSize} -> ${afterSize})`);
      continue;
    }

    // `compare -metric AE` writes the differing-pixel count to stderr and exits
    // non-zero whenever the images differ at all, so the count is read from the
    // error rather than treated as a failure.
    let differing = 0;
    try {
      execFileSync("compare", ["-metric", "AE", "-fuzz", `${fuzz}%`, basePath, file, "null:"], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      const text = String(error.stderr ?? "").trim();
      const parsed = Number.parseFloat(text.split(/\s+/)[0]);
      if (!Number.isFinite(parsed)) {
        kept.push(`${file} (could not compare: ${text.slice(0, 60)})`);
        continue;
      }
      differing = parsed;
    }

    const [w, h] = afterSize.split("x").map(Number);
    const pct = (differing / (w * h)) * 100;
    if (pct > thresholdPct) {
      kept.push(`${file} (${pct.toFixed(3)}% of pixels)`);
      continue;
    }

    if (!dryRun) git(["checkout", baseline, "--", file]);
    reverted.push(file);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`Baseline ${baseline}, fuzz ${fuzz}%, threshold ${thresholdPct}% of pixels.`);
console.log(`  reverted (no visible change): ${reverted.length}`);
console.log(`  kept (visibly changed):       ${kept.length}`);
console.log(`  new files:                    ${added.length}`);
if (kept.length > 0) {
  console.log("\nVisibly changed:");
  for (const entry of kept) console.log(`  ${entry}`);
}
if (added.length > 0) {
  console.log("\nNew:");
  for (const entry of added) console.log(`  ${entry}`);
}
if (dryRun) console.log("\n(dry run: nothing was reverted)");
