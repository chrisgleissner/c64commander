#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Live View streaming CI gate orchestrator (spec §17). Runs the layered HOST gates that must pass on
 * every eligible build and produces a concise, machine-readable summary + exit code:
 *
 *   Layer A/B  deterministic core + recorded-stream replay + concealment (audio + video slots)
 *   Layer  F   no-drift soak (accelerated) + committed-threshold guard
 *   Layer  C   host micro-benchmark relative-regression gate
 *
 * The Pixel-4 → Ultimate-64 HIL gate (Layer E, §14.5) is NOT run here: it needs the physical rig
 * (phone on USB + C64U on the LAN), so it runs on the LOCAL build instead — `./build --stream-hil`
 * (or `npm run test:streams:hil`). Shared CI runs only these host gates; this orchestrator records
 * the HIL gate as "local-build gate" so it is never conflated with the host result (§1.5, §22).
 *
 * Exit: 0 all host gates passed, 1 a gate failed, 2 orchestration error.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const stages = [
  {
    id: "core-replay-concealment",
    title: "Deterministic core + replay + concealment (§14.1/§14.2/§8.1/§9)",
    cmd: ["npx", ["vitest", "run", "tests/unit/streams/", "tests/unit/ci/streamPerfThresholds.test.ts"]],
  },
  {
    id: "host-benchmark",
    title: "Host micro-benchmark regression gate (§14.3/§16.4)",
    cmd: ["node", ["scripts/assert-stream-perf.mjs"]],
  },
];

const results = [];
for (const stage of stages) {
  process.stdout.write(`\n=== ${stage.title} ===\n`);
  const started = Date.now();
  try {
    execFileSync(stage.cmd[0], stage.cmd[1], { stdio: "inherit" });
    results.push({ ...stage, ok: true, ms: Date.now() - started });
  } catch {
    results.push({ ...stage, ok: false, ms: Date.now() - started });
  }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

// Human-readable + GitHub step summary (machine-consumable table).
const lines = [
  "## Live View streaming gates",
  "",
  "| Gate | Result | Time |",
  "| --- | --- | ---: |",
  ...results.map((r) => `| ${r.title} | ${r.ok ? "✅ pass" : "❌ FAIL"} | ${(r.ms / 1000).toFixed(1)}s |`),
  `| Pixel-4 → Ultimate-64 HIL (§14.5) | 🔌 local-build gate (\`./build --stream-hil\`) | — |`,
  "",
  failed === 0
    ? "Host gates green. The mandatory Pixel-4 → C64U HIL runs on the LOCAL build (`./build --stream-hil` / `npm run test:streams:hil`), not in shared CI."
    : `**${failed} host gate(s) failed.**`,
];
const summary = lines.join("\n");
console.log(`\n${summary}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  } catch {
    /* summary is best-effort */
  }
}

process.exit(failed === 0 ? 0 : 1);
