/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Renders a tune through libsidplayfp-wasm with the same call sequence as the app's worker
// (src/lib/playback/localSid.worker.ts), for the cross-engine comparison.
//
//   node render-wasm.mjs <residfp|sidlite> <tune.sid> <songIndex> <seconds> <sampleRate> <6581|8580> <out.raw> [kernal basic]

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { SidAudioEngine } from "libsidplayfp-wasm";

const [engineName, tunePath, songArg, secondsArg, rateArg, modelArg, outPath, kernalPath, basicPath] =
  process.argv.slice(2);
if (!outPath || !["residfp", "sidlite"].includes(engineName)) {
  console.error("usage: render-wasm.mjs <residfp|sidlite> <tune.sid> <songIndex> <seconds> <rate> <6581|8580> <out.raw> [kernal basic]");
  process.exit(2);
}

const startedAt = performance.now();
const engine = new SidAudioEngine({ sampleRate: Number(rateArg), stereo: true, engine: engineName });
const constructedAt = performance.now();
await engine.setSystemROMs(
  kernalPath ? new Uint8Array(readFileSync(kernalPath)) : null,
  basicPath ? new Uint8Array(readFileSync(basicPath)) : null,
  null,
);
await engine.loadSidBuffer(new Uint8Array(readFileSync(tunePath)), Number(songArg));
const sidModel = modelArg === "6581" ? "MOS6581" : "MOS8580";
// POWER_ON_DELAY renders the same tune from a different power-on state, which run_matrix.py uses
// to measure how far reSIDfp's own output moves when nothing but the start-up phase changes.
const powerOnDelay = process.env.POWER_ON_DELAY ? { powerOnDelay: Number(process.env.POWER_ON_DELAY) } : {};
if (engine.getEmulationConfig?.()?.sidModel !== sidModel || process.env.POWER_ON_DELAY) {
  await engine.setEmulationConfig({ sidModel, ...powerOnDelay });
}
const loadedAt = performance.now();
const seconds = Number(secondsArg);
const chunks = [];
let rendered = 0;
while (rendered < seconds) {
  const want = Math.min(0.5, seconds - rendered);
  const pcm = await engine.renderSeconds(want);
  if (!pcm || pcm.length === 0) break;
  chunks.push(pcm);
  rendered += want;
}
const renderedAt = performance.now();
const total = chunks.reduce((n, c) => n + c.length, 0);
const all = new Int16Array(total);
let offset = 0;
for (const chunk of chunks) {
  all.set(chunk, offset);
  offset += chunk.length;
}
writeFileSync(outPath, Buffer.from(all.buffer, all.byteOffset, all.byteLength));
console.log(
  JSON.stringify({
    engine: engineName,
    frames: total / engine.getChannels(),
    sampleRate: engine.getSampleRate(),
    channels: engine.getChannels(),
    constructMs: constructedAt - startedAt,
    loadMs: loadedAt - constructedAt,
    renderMs: renderedAt - loadedAt,
    tuneInfo: engine.getTuneInfo(),
  }),
);
engine.dispose();
