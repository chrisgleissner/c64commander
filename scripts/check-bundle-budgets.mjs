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

const BUDGET_BYTES = 250 * 1024; // 250 KB gzipped, per research R-BUN-1
const distDir = resolve(process.cwd(), "dist", "assets");
const skipIfMissing = process.argv.includes("--skip-if-missing");

const formatKB = (bytes) => (bytes / 1024).toFixed(2) + " KB";

let dirExists = false;
try {
  dirExists = statSync(distDir).isDirectory();
} catch {
  dirExists = false;
}

if (!dirExists) {
  if (skipIfMissing) {
    console.log(`[bundle-budgets] skipping: ${distDir} not built (pass --skip-if-missing)`);
    process.exit(0);
  }
  console.error(`[bundle-budgets] ${distDir} not found. Run \`npm run build\` first.`);
  process.exit(2);
}

const files = readdirSync(distDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => {
    const fullPath = resolve(distDir, name);
    const raw = readFileSync(fullPath);
    const gz = gzipSync(raw, { level: 9 });
    return { name, rawBytes: raw.byteLength, gzBytes: gz.byteLength };
  })
  .sort((a, b) => b.gzBytes - a.gzBytes);

const overBudget = files.filter((f) => f.gzBytes > BUDGET_BYTES);

console.log(`[bundle-budgets] ${files.length} chunks, budget ${formatKB(BUDGET_BYTES)} gzipped`);
for (const f of files.slice(0, 10)) {
  const marker = f.gzBytes > BUDGET_BYTES ? "  ✗ " : "  ✓ ";
  console.log(`${marker}${basename(f.name).padEnd(48)} raw=${formatKB(f.rawBytes).padStart(10)}  gzip=${formatKB(f.gzBytes).padStart(10)}`);
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
