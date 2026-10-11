/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// The on-device playback HIL suites, run once per SID renderer.
//
//   node tools/hil/renderer_feature_matrix.mjs [--host c64u] [--cdp-port 9333]
//     [--renderers sidplayez,residfp,sidlite] [--suites gate,parity,sweep] [--out artifacts/renderer-matrix]
//
// For each renderer: select it in the app, then run
//   gate    tools/hil/merge_gate.mjs --only preflight,sid-local,crossfade (pitch, continuity, crossfade)
//   parity  tools/hil/playback_parity_hil.ts --routes phone (play, pause, resume, scrub, seek, rewind, stop)
//   sweep   tools/hil/release_sweep_hil.mjs --only network-drop,screen-off (Wi-Fi off, screen off)
// and read the app's log for which renderer each tune actually opened on, so a silent fallback to
// another renderer fails the run instead of passing as the one asked for.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const HOST = arg("host", "c64u");
const CDP_PORT = arg("cdp-port", "9333");
const RENDERERS = arg("renderers", "sidplayez,residfp,sidlite").split(",");
const SUITES = arg("suites", "gate,parity,sweep").split(",");
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.resolve(REPO, arg("out", "artifacts/renderer-matrix"), RUN);

const SUITE_COMMANDS = {
  gate: (dir) => [
    "node",
    [
      "tools/hil/merge_gate.mjs",
      "--host",
      HOST,
      "--cdp-port",
      CDP_PORT,
      "--only",
      "preflight,sid-local,crossfade",
      "--json",
      path.join(dir, "gate.json"),
      "--keep-dir",
      path.join(dir, "gate-runs"),
    ],
  ],
  parity: (dir) => [
    "npx",
    [
      "tsx",
      "tools/hil/playback_parity_hil.ts",
      "--hosts",
      HOST,
      "--routes",
      "phone",
      "--json",
      path.join(dir, "parity.json"),
    ],
  ],
  sweep: (dir) => [
    "node",
    [
      "tools/hil/release_sweep_hil.mjs",
      "--hosts",
      HOST,
      "--cdp-port",
      CDP_PORT,
      "--only",
      "network-drop,screen-off",
      "--json",
      path.join(dir, "sweep.json"),
    ],
  ],
};

const run = (command, args, logFile) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, env: { ...process.env, CDP_PORT } });
    let out = "";
    const take = (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => {
      if (logFile) writeFileSync(logFile, out);
      resolve({ ok: code === 0, out });
    });
  });

const js = async (expression) => {
  const result = await run("node", [path.join("scripts", "bughunt-cdp.mjs"), "eval", expression]);
  if (!result.ok) throw new Error(`CDP evaluation failed: ${result.out.trim().slice(-300)}`);
  return result.out.trim();
};

/** Select `renderer` and turn on the debug log that names each tune's renderer; returns the phone's clock. */
const selectRenderer = async (renderer) => {
  const state = JSON.parse(
    await js(`(() => {
      localStorage.setItem("c64u_sid_renderer", ${JSON.stringify(renderer)});
      localStorage.setItem("c64u_debug_logging_enabled", "true");
      return JSON.stringify({ renderer: localStorage.getItem("c64u_sid_renderer"), now: Date.now() });
    })()`),
  );
  if (state.renderer !== renderer) throw new Error(`the app would not take ${renderer}`);
  return state.now;
};

/** Which renderers the app opened tunes on since `since` (the phone's clock). */
const openedRenderers = async (since) =>
  JSON.parse(
    await js(`JSON.stringify([...new Set(JSON.parse(localStorage.getItem("c64u_app_logs") || "[]")
      .filter((entry) => entry.message === "Local SID engine opened" && Date.parse(entry.timestamp) >= ${since})
      .map((entry) => entry.details && entry.details.renderer))])`),
  );

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const before = await js(`String(localStorage.getItem("c64u_sid_renderer"))`);
  const debugBefore = await js(`String(localStorage.getItem("c64u_debug_logging_enabled"))`);
  const results = [];
  try {
    for (const renderer of RENDERERS) {
      for (const suite of SUITES) {
        const dir = path.join(OUT, renderer, suite);
        mkdirSync(dir, { recursive: true });
        const since = await selectRenderer(renderer);
        console.log(`\n[matrix] ${renderer} / ${suite}`);
        const [command, args] = SUITE_COMMANDS[suite](dir);
        const outcome = await run(command, args, path.join(dir, "output.log"));
        const opened = await openedRenderers(since);
        const fellBack = opened.filter((name) => name !== renderer);
        const result = {
          renderer,
          suite,
          passed: outcome.ok && opened.length > 0 && fellBack.length === 0,
          suitePassed: outcome.ok,
          opened,
        };
        results.push(result);
        writeFileSync(path.join(OUT, "matrix.json"), JSON.stringify(results, null, 2));
      }
    }
  } finally {
    await js(`(() => {
      const restore = (key, value) => value === "null" ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      restore("c64u_sid_renderer", ${JSON.stringify(before)});
      restore("c64u_debug_logging_enabled", ${JSON.stringify(debugBefore)});
      return 1;
    })()`).catch((error) => console.error(`[matrix] could not restore the renderer setting: ${error.message}`));
  }
  console.log("\nrenderer   suite   result  opened on");
  for (const r of results) {
    const verdict = r.passed ? "pass" : r.suitePassed ? "FALLBACK" : "FAIL";
    console.log(`${r.renderer.padEnd(10)} ${r.suite.padEnd(7)} ${verdict.padEnd(7)} ${r.opened.join(",") || "none"}`);
  }
  console.log(`\nwrote ${path.relative(REPO, OUT)}`);
  if (results.some((r) => !r.passed)) process.exit(1);
};

main().catch((error) => {
  console.error(`[matrix] FAILED: ${error.stack ?? error}`);
  process.exit(1);
});
