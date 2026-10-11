/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Every SID renderer on the phone against the C64 and against itself, heard through a microphone.
//
//   node tools/hil/renderer_accuracy_hil.mjs [--host c64u] [--password pwd] [--cdp-port 9333]
//     [--mic plughw:CARD=SF558,DEV=0] [--seconds 12] [--volume 5] [--renderers sidplayez,residfp,sidlite]
//     [--tunes <path>[#song],...] [--no-c64] [--out artifacts/renderer-accuracy]
//     [--ez-render android/app/build/intermediates/libsidplayez-host/out/ez_render] [--roms <dir>]
//
// For each tune: the C64 plays it (REST upload) while the microphone records and its own audio stream
// is captured off the wire, then the phone plays it
// once per renderer through window.__localSidProbe, while the microphone records and the app's own
// pipeline captures what it hands the AudioTrack. tools/hil/renderer_accuracy.py then grades the
// takes. One sound at a time, so the microphone never hears both machines. Phone media volume is held
// at --volume (never above 10 of 25) and restored. The Ultimate's audio and video streams are stopped
// at the start, so a mirror cannot play the C64 through the phone, and are left stopped.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDroidDevice } from "./droidctl_device.mjs";
import { MAX_VOLUME, readVolume, restoreVolume, setVolume } from "./phone_volume.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const HOST = arg("host", "c64u");
const PASSWORD = arg("password", "pwd");
const CDP_PORT = Number(arg("cdp-port", "9333"));
const MIC = arg("mic", "plughw:CARD=SF558,DEV=0");
const SECONDS = Number(arg("seconds", "12"));
const VOLUME = Number(arg("volume", "5"));
const RENDERERS = arg("renderers", "sidplayez,residfp,sidlite").split(",");
const WITH_C64 = !argv.includes("--no-c64");
const HVSC = process.env.HVSC ?? path.join(process.env.HOME ?? "", "dev/c64/C64Music");
const DEFAULT_TUNES = [
  "tests/fixtures/tone-ladder.sid",
  "tests/fixtures/sid-engines/filter-6581.sid",
  "tests/fixtures/sid-engines/waveforms-8580.sid",
  "tests/fixtures/sid-engines/two-sid.sid",
  `${HVSC}/MUSICIANS/L/Laxity/A_Trace_of_Space.sid`,
  `${HVSC}/MUSICIANS/J/Jammer/Ad_Astra.sid`,
].join(",");
const TUNES = arg("tunes", DEFAULT_TUNES)
  .split(",")
  .map((spec) => {
    const [file, song = "0"] = spec.split("#");
    const absolute = path.resolve(REPO, file);
    return { path: absolute, song: Number(song), stem: path.basename(absolute, ".sid") };
  });
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.resolve(REPO, arg("out", "artifacts/renderer-accuracy"), RUN);
const PACKAGE = "uk.gleissner.c64commander";
/** How long a probe tune plays before recording starts, so every renderer is past its open. */
const LEAD_IN_SECONDS = 4;
/** How long the probe plays on after the recording, so the capture is read from an open pipeline. */
const TAIL_SECONDS = 6;

if (VOLUME > MAX_VOLUME) throw new Error(`--volume ${VOLUME} is above the ${MAX_VOLUME} of 25 ceiling`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => console.log(`[accuracy] ${line}`);

const run = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, env: { ...process.env, CDP_PORT: String(CDP_PORT) } });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ ok: code === 0, out }));
  });

const js = async (expression) => {
  const result = await run("node", [path.join("scripts", "bughunt-cdp.mjs"), "eval", expression]);
  if (!result.ok) throw new Error(`CDP evaluation failed: ${result.out.trim().slice(-300)}`);
  return result.out.trim();
};

const recordMic = async (file, seconds) => {
  const result = await run("arecord", [
    "-D",
    MIC,
    "-f",
    "S16_LE",
    "-r",
    "48000",
    "-c",
    "1",
    "-d",
    String(seconds),
    file,
  ]);
  if (!result.ok)
    throw new Error(`the microphone would not record: ${result.out.trim().split("\n").slice(-2).join(" | ")}`);
};

// ---- the C64 -------------------------------------------------------------------------------------

const c64 = async (method, route, body) => {
  const response = await fetch(`http://${HOST}${route}`, {
    method,
    headers: PASSWORD ? { "X-Password": PASSWORD } : {},
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} on ${HOST}: HTTP ${response.status} ${text.slice(0, 200)}`);
  return text;
};

/** Resume, then reset: a reset alone leaves a paused machine frozen with the tune in memory. */
const silenceC64 = async () => {
  await c64("PUT", "/v1/machine:resume").catch((error) => log(`resume before reset: ${error.message}`));
  await c64("PUT", "/v1/machine:reset");
};

const STREAM_DESTINATION = "239.0.1.65:11001";

/** The Ultimate's own audio, off the wire: its SID output before a speaker or the room touches it. */
const captureC64Stream = (file) =>
  run("python3", [
    "-c",
    "import sys; sys.path.insert(0, 'tools/hil'); from lan_iface import local_lan_address; print(local_lan_address())",
  ]).then((iface) =>
    run("python3", [
      "tools/hil/capture_mirror_pcm.py",
      "--seconds",
      String(SECONDS),
      "--out",
      file,
      "--iface",
      iface.out.trim(),
    ]),
  );

const playOnC64 = async (tune) => {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(tune.path)]), `${tune.stem}.sid`);
  await c64("POST", `/v1/runners:sidplay?songnr=${tune.song + 1}`, form);
};

// ---- the phone -----------------------------------------------------------------------------------

const startProbe = async (tune, renderer, runId) => {
  const sid = readFileSync(tune.path).toString("base64");
  const request = { sid, songIndex: tune.song, renderer, seconds: LEAD_IN_SECONDS + SECONDS + TAIL_SECONDS, volume: 1 };
  const started = await js(`(() => {
    if (typeof window.__localSidProbe !== "function") return "on-device playback is not enabled in this app";
    window.__accuracyOutcome = { run: ${JSON.stringify(runId)}, text: null };
    const settle = (text) => { if (window.__accuracyOutcome.run === ${JSON.stringify(runId)}) window.__accuracyOutcome.text = text; };
    window.__localSidProbe(${JSON.stringify(request)}).then(
      (result) => settle(JSON.stringify({ renderer: result.renderer, started: result.started, final: result.final, fallbackSidModel: result.fallbackSidModel, romsAvailable: result.romsAvailable })),
      (error) => settle(JSON.stringify({ error: String((error && error.stack) || error) })),
    );
    return "started";
  })()`);
  if (started !== "started") throw new Error(started);
};

const awaitProbe = async (runId) => {
  const deadline = Date.now() + (LEAD_IN_SECONDS + SECONDS + 60) * 1000;
  while (Date.now() < deadline) {
    const text = await js(
      `String(window.__accuracyOutcome.run === ${JSON.stringify(runId)} && window.__accuracyOutcome.text)`,
    );
    if (text !== "false" && text !== "null") return JSON.parse(text);
    await sleep(1000);
  }
  throw new Error(`${runId}: the probe did not finish`);
};

const pullCapture = async (device, localPath) => {
  const captured = JSON.parse(
    await js(`(async()=>JSON.stringify(await window.Capacitor.Plugins.StreamUdp.readAudioCapture({})))()`),
  );
  if (!captured?.bytes || !captured.path) throw new Error("the pipeline captured no audio");
  await device.call("droid_device.pull_file", { targetId: device.targetId, remotePath: captured.path, localPath });
  return captured;
};

const playOnPhone = async (device, tune, renderer) => {
  const runId = `${tune.stem}-${renderer}-${Date.now()}`;
  await startProbe(tune, renderer, runId);
  await sleep(LEAD_IN_SECONDS * 1000);
  await js(`(async()=>{await window.Capacitor.Plugins.StreamUdp.startAudioCapture({seconds:${SECONDS}});return 1})()`);
  await recordMic(path.join(OUT, `${tune.stem}.${renderer}.mic.wav`), SECONDS);
  // While the probe still plays: its engine closes the pipeline, and the capture with it, when it ends.
  await pullCapture(device, path.join(OUT, `${tune.stem}.${renderer}.pcm.wav`));
  const outcome = await awaitProbe(runId);
  if (outcome.error) throw new Error(`${tune.stem} on ${renderer}: ${outcome.error}`);
  if (!outcome.started) throw new Error(`${tune.stem} on ${renderer}: the tune did not start on the phone`);
  const engineRenderer = outcome.final?.renderer;
  if (engineRenderer && engineRenderer !== renderer) {
    throw new Error(`${tune.stem}: asked for ${renderer}, the engine played ${engineRenderer}`);
  }
  return {
    underruns: outcome.final?.audioUnderruns ?? null,
    renderMsPerSec: outcome.final?.renderMsPerSec ?? null,
    fallbackSidModel: outcome.fallbackSidModel ?? null,
    romsAvailable: outcome.romsAvailable ?? null,
  };
};

// ---- the run -------------------------------------------------------------------------------------

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const device = await createDroidDevice();
  await device.forwardWebview(PACKAGE, CDP_PORT);
  const before = await readVolume(device);
  if (before.level !== null && before.level > MAX_VOLUME) {
    throw new Error(`the phone's media volume is ${before.level}, above ${MAX_VOLUME}; lower it first`);
  }
  log(`phone media volume ${before.level}, holding ${VOLUME} for the run`);
  const manifest = { run: RUN, host: WITH_C64 ? HOST : null, seconds: SECONDS, volume: VOLUME, tunes: [], phone: {} };
  try {
    await setVolume(device, VOLUME);
    if (WITH_C64) {
      // A mirror left streaming would carry the C64 out of the phone's speaker as well.
      for (const stream of ["audio", "video"]) {
        await c64("PUT", `/v1/streams/${stream}:stop`).catch((error) => log(`stop ${stream} stream: ${error.message}`));
      }
    }
    for (const tune of TUNES) {
      const entry = { ...tune, render_seconds: LEAD_IN_SECONDS + SECONDS + 10 };
      manifest.tunes.push(entry);
      if (WITH_C64) {
        log(`${tune.stem}: on ${HOST}`);
        try {
          await c64("PUT", `/v1/streams/audio:start?ip=${encodeURIComponent(STREAM_DESTINATION)}`);
          await playOnC64(tune);
          await sleep(1500);
          const [, stream] = await Promise.all([
            recordMic(path.join(OUT, `${tune.stem}.c64.wav`), SECONDS),
            captureC64Stream(path.join(OUT, `${tune.stem}.c64stream.wav`)),
          ]);
          if (!stream.ok)
            log(`${tune.stem}: the C64's audio stream could not be captured: ${stream.out.trim().slice(-200)}`);
        } finally {
          await silenceC64();
          await c64("PUT", "/v1/streams/audio:stop").catch((error) => log(`stop audio stream: ${error.message}`));
        }
        await sleep(1000);
      }
      for (const renderer of RENDERERS) {
        log(`${tune.stem}: on the phone, ${renderer}`);
        manifest.phone[`${tune.stem}.${renderer}`] = await playOnPhone(device, tune, renderer);
        await sleep(1000);
      }
      writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    }
  } finally {
    await restoreVolume(device, before, log);
    writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  const ezRender = arg("ez-render", "android/app/build/intermediates/libsidplayez-host/out/ez_render");
  const roms = arg("roms", path.join(process.env.HOME ?? "", "dev/c64/roms"));
  const graded = await run("python3", [
    path.join("tools", "hil", "renderer_accuracy.py"),
    OUT,
    "--ez-render",
    path.resolve(REPO, ezRender),
    ...(roms ? ["--roms", roms] : []),
  ]);
  console.log(graded.out);
  if (!graded.ok) throw new Error("grading failed");
  log(`wrote ${path.relative(REPO, OUT)}`);
};

main().catch((error) => {
  console.error(`[accuracy] FAILED: ${error.stack ?? error}`);
  process.exit(1);
});
