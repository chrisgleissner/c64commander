/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// How long each SID renderer takes from a play command to sound at the phone's speaker, measured
// with the microphone.
//
//   node tools/hil/renderer_latency_hil.mjs [--cdp-port 9333] [--mic plughw:CARD=SF558,DEV=0]
//     [--renderers sidplayez,residfp,sidlite] [--repeats 5] [--volume 3] [--out artifacts/renderer-latency]
//
// A generated 550 Hz tune is played through window.__localSidProbe (a real LocalSidEngine) while the
// microphone records. The command is sent over one open DevTools connection, so its send time is
// known to a few milliseconds, and the latency is the tone's onset in the recording minus that send
// time. The recording is counted from when arecord was started, not from its first sample, so the
// absolute figures are low by arecord's start-up delay; the renderers share that error, so their
// differences do not. Media volume is held at --volume (never above 10 of 25) and restored.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectPage } from "./cdp_page.mjs";
import { createDroidDevice } from "./droidctl_device.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const CDP_PORT = Number(arg("cdp-port", "9333"));
const MIC = arg("mic", "plughw:CARD=SF558,DEV=0");
const RENDERERS = arg("renderers", "sidplayez,residfp,sidlite").split(",");
const REPEATS = Number(arg("repeats", "5"));
const MAX_VOLUME = 10;
const VOLUME = Math.min(MAX_VOLUME, Number(arg("volume", "3")));
const OUT = path.resolve(
  REPO,
  arg("out", "artifacts/renderer-latency"),
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const PACKAGE = "uk.gleissner.c64commander";
const RATE = 48000;
const TONE_HZ = 550;
const RECORD_SECONDS = 6;
const LEAD_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ ok: code === 0, out }));
  });

const readVolume = async (device) => {
  const dump = await device.shell(["sh", "-c", "dumpsys audio | grep -A8 -- '- STREAM_MUSIC:'"]);
  const speaker = /\(speaker\): (\d+)/.exec(dump);
  return speaker ? Number(speaker[1]) : null;
};
const setVolume = async (device, target) => {
  for (let tries = 0; tries < 30; tries += 1) {
    const level = await readVolume(device);
    if (level === null) throw new Error("could not read the phone's media volume");
    if (level === target) return;
    await device.pressKey(level < target ? 24 : 25);
    await sleep(250);
  }
  throw new Error(`the phone's media volume would not settle at ${target}`);
};

/** Milliseconds into a 48 kHz mono S16 WAV where the 550 Hz tone first holds for 50 ms. */
const onsetMs = (file) => {
  const data = readFileSync(file);
  const samples = new Int16Array(data.buffer, data.byteOffset + 44, Math.floor((data.length - 44) / 2));
  const window = 480;
  const energies = [];
  for (let start = 0; start + window <= samples.length; start += window) {
    let re = 0;
    let im = 0;
    let total = 0;
    for (let i = 0; i < window; i += 1) {
      const value = samples[start + i] / 32768;
      const phase = (2 * Math.PI * TONE_HZ * (start + i)) / RATE;
      re += value * Math.cos(phase);
      im += value * Math.sin(phase);
      total += value * value;
    }
    energies.push({ tone: (re * re + im * im) / window, total });
  }
  const peak = Math.max(...energies.map((e) => e.tone));
  const threshold = peak / 10;
  for (let index = 0; index + 5 <= energies.length; index += 1) {
    if (energies.slice(index, index + 5).every((e) => e.tone >= threshold)) return (index * window * 1000) / RATE;
  }
  return null;
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const tune = path.join(OUT, "tone-550.sid");
  const generated = await run("node", [
    "scripts/generate-test-sid.mjs",
    "--hz",
    String(TONE_HZ),
    "--waveform",
    "sawtooth",
    "--volume",
    "15",
    "--out",
    tune,
  ]);
  if (!generated.ok) throw new Error(`could not generate the tone tune: ${generated.out}`);
  const sid = readFileSync(tune).toString("base64");
  const device = await createDroidDevice();
  await device.forwardWebview(PACKAGE, CDP_PORT);
  const page = await connectPage(String(CDP_PORT));
  const before = await readVolume(device);
  if (before !== null && before > MAX_VOLUME) throw new Error(`media volume is ${before}, above ${MAX_VOLUME}`);
  const results = [];
  try {
    await setVolume(device, VOLUME);
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      for (const renderer of RENDERERS) {
        const wav = path.join(OUT, `${renderer}-${repeat + 1}.wav`);
        const recording = run("arecord", [
          "-D",
          MIC,
          "-f",
          "S16_LE",
          "-r",
          String(RATE),
          "-c",
          "1",
          "-d",
          String(RECORD_SECONDS),
          wav,
        ]);
        const recordStarted = Date.now();
        await sleep(LEAD_MS);
        const sentAt = Date.now();
        const probe = page.evaluate(
          `window.__localSidProbe(${JSON.stringify({ sid, renderer, seconds: 3, volume: 1 })}).then((r) => JSON.stringify({ openMs: r.openMs, firstPositionMs: r.firstPositionMs }))`,
          30_000,
        );
        const outcome = await probe;
        const recorded = await recording;
        if (!recorded.ok) throw new Error(`the microphone would not record: ${recorded.out.trim()}`);
        const onset = onsetMs(wav);
        const latencyMs = onset === null ? null : onset - (sentAt - recordStarted);
        results.push({ renderer, repeat: repeat + 1, latencyMs, ...outcome });
        console.log(
          `[latency] ${renderer} #${repeat + 1}: ${latencyMs === null ? "no tone heard" : `${Math.round(latencyMs)} ms`}`,
        );
        await sleep(1500);
      }
    }
  } finally {
    if (before !== null) await setVolume(device, Math.min(before, MAX_VOLUME));
    page.close();
    writeFileSync(path.join(OUT, "latency.json"), JSON.stringify(results, null, 2));
  }
  console.log("\nrenderer   median  min  max (ms, command to sound at the microphone)");
  for (const renderer of RENDERERS) {
    const values = results.filter((r) => r.renderer === renderer && r.latencyMs !== null).map((r) => r.latencyMs);
    values.sort((a, b) => a - b);
    const median = values.length ? values[Math.floor(values.length / 2)] : null;
    console.log(
      `${renderer.padEnd(10)} ${median === null ? "—" : Math.round(median)}  ${values.length ? Math.round(values[0]) : "—"}  ${values.length ? Math.round(values[values.length - 1]) : "—"}  (${values.length}/${REPEATS} heard)`,
    );
  }
  console.log(`[latency] wrote ${path.relative(REPO, OUT)}`);
};

main().catch((error) => {
  console.error(`[latency] FAILED: ${error.stack ?? error}`);
  process.exit(1);
});
