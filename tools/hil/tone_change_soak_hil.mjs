#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Change tune on an Ultimate-hosted playlist of two steady tones every few seconds, record the speaker,
 * and measure every gap at the changes.
 *
 * The playlist holds Tone-Low and Tone-High from the Ultimate (the gate's tone tunes, see
 * docs/testing/hil-merge-gate.md). Playback uses the on-device engine, so each change reads or reuses
 * the tune's bytes from the Ultimate and starts the next render, the path issue #526 is about. The
 * recording is graded by tone_gaps.py, which finds gaps to the 20 ms frame; the app's own audio stats
 * (underruns, concealed time) are sampled at each change as the second witness.
 *
 *   node tools/hil/tone_change_soak_hil.mjs --serial <adb serial> --minutes 30 --interval 25 \
 *     --volume 8 --json artifacts/tone-change-soak.json
 *
 * The media volume is set for the run and restored; it never goes above 10 of 25.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHilCdp, sleep } from "./hil_cdp.mjs";
import { MAX_VOLUME, readVolume, setVolume } from "./phone_volume.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const SERIAL = arg("serial", "9B081FFAZ001WX");
const PACKAGE = arg("package", "uk.gleissner.c64commander");
const MINUTES = Number(arg("minutes", "30"));
const INTERVAL_S = Number(arg("interval", "25"));
const VOLUME = Number(arg("volume", "8"));
const MIC = arg("device", "plughw:CARD=SF558,DEV=0");
const PORT = Number(arg("cdp-port", "9381"));
const OUT = arg("json", "artifacts/tone-change-soak.json");
const WAV = arg("wav", OUT.replace(/\.json$/, ".wav"));
if (VOLUME > MAX_VOLUME) throw new Error(`refusing volume ${VOLUME}; the ceiling is ${MAX_VOLUME} of 25`);

const app = createHilCdp({ serial: SERIAL, packageName: PACKAGE, port: PORT });
const device = await app.device();
const original = await readVolume(device);
const click = (testId) =>
  app.evaluate(
    `(()=>{const e=document.querySelector('[data-testid="${testId}"]');if(!e)return "missing";e.click();return "ok"})()`,
  );
const readStats = () =>
  app
    .evaluate(`(async()=>JSON.stringify(await window.Capacitor.Plugins.StreamUdp.readAudioStats({})))()`)
    .catch((error) => ({ error: String(error) }));

const changes = [];
const stats = [];
try {
  await setVolume(device, VOLUME);
  await app.evaluate(`(async()=>{document.querySelector('[data-testid="tab-play"]')?.click();await new Promise(r=>setTimeout(r,2000));
    const t=document.querySelector('[data-testid="playback-engine-toggle"]'); if(t?.dataset.engine!=="local"){t.click();await new Promise(r=>setTimeout(r,900));document.querySelector('[data-testid="playback-engine-local"]')?.click();await new Promise(r=>setTimeout(r,1200));}
    const rep=document.querySelector('[data-testid="playback-repeat"]'); if(rep&&rep.getAttribute("data-state")!=="checked"){rep.click();await new Promise(r=>setTimeout(r,500));}
    const row=document.querySelector('[data-testid="playlist-item"] button[aria-label^="Play "]'); row?.click(); return 1})()`);
  await sleep(8000);

  const recorder = spawn(
    "arecord",
    ["-D", MIC, "-f", "S16_LE", "-r", "48000", "-c", "1", "-d", String(MINUTES * 60 + 5), WAV],
    { stdio: "ignore" },
  );
  const recorderDone = new Promise((resolve) => recorder.on("exit", resolve));
  const startedAt = Date.now();
  while (Date.now() - startedAt < MINUTES * 60_000) {
    await sleep(INTERVAL_S * 1000);
    const at = (Date.now() - startedAt) / 1000;
    changes.push(Number(at.toFixed(2)));
    const result = await click("playlist-next");
    stats.push({ at, click: result, audio: await readStats() });
  }
  await sleep(INTERVAL_S * 1000 / 2);
  await click("playlist-pause");
  await recorderDone;
} finally {
  await setVolume(device, original.level ?? 3).catch((error) =>
    console.error(`could not restore the volume: ${error.message}`),
  );
  app.close();
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ minutes: MINUTES, intervalSeconds: INTERVAL_S, volume: VOLUME, changes, stats, wav: WAV }, null, 1),
);
console.log(`recorded ${WAV}; grade with: python3 tools/hil/tone_gaps.py ${WAV} --changes ${changes.join(",")} --json`);
process.exit(0);
