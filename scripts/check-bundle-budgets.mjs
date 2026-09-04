#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Bundle budget guard. Fails CI / local lint when any production JS chunk
// exceeds the gzipped size cap, so the vendor-chunk split landed in the
// responsiveness stabilization plan does not silently regress.
//
// Usage:
//   node scripts/check-bundle-budgets.mjs           # checks dist/assets/*.js
//   node scripts/check-bundle-budgets.mjs --skip-if-missing
//
// Exit codes:
//   0  — all chunks within budget (or dist not built and --skip-if-missing)
//   1  — at least one chunk over budget
//   2  — dist not built and --skip-if-missing not passed

import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";

export const BUDGET_BYTES = 250 * 1024; // 250 KB gzipped, per research R-BUN-1

export const formatKB = (bytes) => (bytes / 1024).toFixed(2) + " KB";

export const isDirectory = (dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** Every `.js` chunk in `dir`, gzipped at level 9, largest compressed first. */
export const measureChunks = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => {
      const raw = readFileSync(resolve(dir, name));
      return { name, rawBytes: raw.byteLength, gzBytes: gzipSync(raw, { level: 9 }).byteLength };
    })
    .sort((a, b) => b.gzBytes - a.gzBytes);

export const findOverBudget = (files, budget = BUDGET_BYTES) => files.filter((file) => file.gzBytes > budget);

const main = () => {
  const distDir = resolve(process.cwd(), "dist", "assets");
  const skipIfMissing = process.argv.includes("--skip-if-missing");

  if (!isDirectory(distDir)) {
    if (skipIfMissing) {
      console.log(`[bundle-budgets] skipping: ${distDir} not built (pass --skip-if-missing)`);
      process.exit(0);
    }
    console.error(`[bundle-budgets] ${distDir} not found. Run \`npm run build\` first.`);
    process.exit(2);
  }

  const files = measureChunks(distDir);

  // A dist/assets that holds no JavaScript chunk means the build did not produce
  // what this budget is meant to measure, so treat it as a failure rather than
  // reporting "0 chunks" and passing.
  if (files.length === 0) {
    console.error(`[bundle-budgets] ${distDir} contains no .js chunk, so nothing was measured.`);
    process.exit(2);
  }

  const overBudget = findOverBudget(files);

  console.log(`[bundle-budgets] ${files.length} chunks, budget ${formatKB(BUDGET_BYTES)} gzipped`);
  for (const f of files.slice(0, 10)) {
    const marker = f.gzBytes > BUDGET_BYTES ? "  ✗ " : "  ✓ ";
    console.log(
      `${marker}${basename(f.name).padEnd(48)} raw=${formatKB(f.rawBytes).padStart(10)}  gzip=${formatKB(f.gzBytes).padStart(10)}`,
    );
  }

  if (overBudget.length > 0) {
    console.error(`\n[bundle-budgets] ${overBudget.length} chunk(s) exceed the ${formatKB(BUDGET_BYTES)} gzipped cap:`);
    for (const f of overBudget) {
      console.error(`  - ${f.name}: ${formatKB(f.gzBytes)} gzipped (over by ${formatKB(f.gzBytes - BUDGET_BYTES)})`);
    }
    console.error("\nFix by adding the offending package(s) to vite.config.ts manualChunks().");
    process.exit(1);
  }

  process.exit(0);
};

// `import.meta.url` is percent-encoded and a raw path is not, so comparing the two directly
// makes this never match in a checkout whose path contains a space or any other encoded
// character — and the gate would then exit 0 having checked nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
