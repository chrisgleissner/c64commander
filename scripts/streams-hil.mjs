#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * LOCAL Live View HIL gate (spec §14.5) — the mandatory Pixel-4 → Ultimate-64 hardware test, run on
 * the developer's LOCAL build (the machine with the phone on USB and the C64U on the LAN). It is NOT
 * a shared-CI job: it needs the physical rig, so it runs here as part of `./build --stream-hil` (or
 * `npm run test:streams:hil`) after the APK is installed. CI runs only the host gates (stream-gates).
 *
 * Runs both fixtures and aggregates them:
 *   1. tools/hil/hil_stream_fixture.py — streaming gates (fps, CPU, jank, underruns, slot accounting)
 *   2. tools/hil/av_sync_hil.py        — reframed end-to-end latency gates (press→see/hear, A/V offset)
 *
 * Exit (machine-readable, §17): 0 all gates passed, 1 a product gate failed, 2 infra/precondition
 * (no device, C64U unreachable, app not installed) — kept DISTINCT so an infra flake is never a pass.
 */

import { execFileSync, spawnSync } from "node:child_process";

const serial = process.env.HIL_ADB_SERIAL || detectSerial();
const host = process.env.HIL_C64U_HOST || "c64u";
const report = process.env.HIL_REPORT || "ci-artifacts/hil/stream-hil-report.json";

function detectSerial() {
  try {
    const out = execFileSync("adb", ["devices"], { encoding: "utf8" });
    const lines = out
      .split("\n")
      .slice(1)
      .filter((l) => l.includes("\tdevice"));
    // Prefer a real device (9B0* Pixel) over an emulator.
    const real = lines.find((l) => !l.startsWith("emulator-"));
    return (real || lines[0] || "").split("\t")[0].trim();
  } catch {
    return "";
  }
}

if (!serial) {
  console.error("HIL: no ADB device connected. Connect the Pixel 4 over USB (exit 2).");
  process.exit(2);
}

const python = process.env.PYTHON || "python3";
const runFixture = (label, args) => {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(python, args, { stdio: "inherit" });
  if (res.error) {
    console.error(`HIL: could not run ${label}: ${res.error.message}`);
    return 2;
  }
  return res.status ?? 2;
};

console.log(`Live View HIL (local) — device ${serial}, C64U ${host}`);

const streamCode = runFixture("Streaming gates (fps / CPU / jank / slots)", [
  "tools/hil/hil_stream_fixture.py",
  "--serial",
  serial,
  "--host",
  host,
  "--report",
  report,
]);
const latencyCode = runFixture("End-to-end latency gates (press→see/hear, A/V offset)", [
  "tools/hil/av_sync_hil.py",
  "--serial",
  serial,
  "--soak-seconds",
  "30",
  "--taps",
  "10",
]);

// Infra failure (2) on either fixture dominates — never report a product pass on an infra flake.
if (streamCode === 2 || latencyCode === 2) {
  console.error("\nHIL INFRA FAILURE — hardware/precondition problem, product result inconclusive.");
  process.exit(2);
}
const failed = (streamCode !== 0 ? 1 : 0) + (latencyCode !== 0 ? 1 : 0);
console.log(
  `\nLive View HIL: streaming ${streamCode === 0 ? "PASS" : "FAIL"}, latency ${latencyCode === 0 ? "PASS" : "FAIL"}.`,
);
process.exit(failed === 0 ? 0 : 1);
