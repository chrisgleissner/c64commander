/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// End-to-end on-device playback through each renderer, run in the app's WebView over CDP.
//
//   CDP_PORT=9333 node tools/sid-engines/android-playback.mjs <tune.sid> [songIndex] [seconds] [seekTo] [renderer,...]
//
// Calls `window.__localSidProbe` (src/lib/playback/localSidProbe.ts), which plays the tune through a
// real LocalSidEngine — renderer, scheduler, sink, and on Android the native audio feed — at volume 0,
// seeks to `seekTo` halfway through, and returns open time, time to first position, seek latency and
// the engine's stats every 500 ms. The app must have on-device playback enabled
// (`c64u_local_engine_enabled` = "1") and its WebView forwarded to CDP_PORT. Prints one JSON object.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [tunePath, songArg = "0", secondsArg = "20", seekArg = "60", renderersArg = "sidplayez,residfp,sidlite"] =
  process.argv.slice(2);
if (!tunePath) {
  console.error("usage: android-playback.mjs <tune.sid> [songIndex] [seconds] [seekTo] [renderer,...]");
  process.exit(2);
}
const request = {
  sid: readFileSync(tunePath).toString("base64"),
  songIndex: Number(songArg),
  seconds: Number(secondsArg),
  seekTo: Number(seekArg),
};

// bughunt-cdp.mjs gives each evaluation 15 s, so the probe is started in one evaluation and its
// result collected by polling.
const evaluate = (script) => {
  const raw = execFileSync("node", [path.join(REPO, "scripts", "bughunt-cdp.mjs"), "eval", script], {
    env: process.env,
    maxBuffer: 1 << 24,
    timeout: 60 * 1000,
  }).toString();
  return raw.trim();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = {};
for (const renderer of renderersArg.split(",")) {
  // Keyed by run, so an earlier probe that outlived its runner cannot be read as this one's result.
  const run = `${renderer}-${Date.now()}`;
  evaluate(`(() => {
    if (typeof window.__localSidProbe !== "function") throw new Error("on-device playback is not enabled in this app");
    window.__localSidProbeOutcome = { run: ${JSON.stringify(run)}, text: null };
    const settle = (text) => { if (window.__localSidProbeOutcome.run === ${JSON.stringify(run)}) window.__localSidProbeOutcome.text = text; };
    window.__localSidProbe(${JSON.stringify({ ...request, renderer })}).then(
      (result) => settle(JSON.stringify(result)),
      (error) => settle(JSON.stringify({ error: String((error && error.stack) || error) })),
    );
    return "started";
  })()`);
  const deadline = Date.now() + (request.seconds + 120) * 1000;
  let outcome = null;
  while (outcome === null) {
    if (Date.now() > deadline) throw new Error(`${renderer}: the probe did not finish`);
    await sleep(2000);
    const text = evaluate(
      `String(window.__localSidProbeOutcome.run === ${JSON.stringify(run)} && window.__localSidProbeOutcome.text)`,
    );
    if (text !== "false" && text !== "null") outcome = text;
  }
  results[renderer] = JSON.parse(outcome);
}
console.log(JSON.stringify(results, null, 2));
