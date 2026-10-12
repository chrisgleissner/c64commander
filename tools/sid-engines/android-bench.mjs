/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// On-device SID renderer and PCM transport benchmark, run inside the app's WebView over CDP.
//
//   CDP_PORT=9333 node tools/sid-engines/android-bench.mjs <tune.sid> [songIndex] [seconds] [--legacy-only]
//
// The WebView must already be forwarded to CDP_PORT (droidctl forward_webview). Measures, for the
// same tune and output rate:
//   - libSidplayEZ: renderer creation, tune open, render cost per second of audio (native timing and
//     the wall time of each bridge call), via the SidAudio plugin;
//   - reSIDfp and SIDLite: module load, open and render cost per second of audio, in a Web Worker as
//     the app runs them;
//   - PCM transport, per second of audio: the JavaScript main-thread time and the bytes and calls that
//     cross into native code, for the binary port, the base64 fallback, and the previous release's
//     path (S16 -> planar float -> S16 with gain -> base64 -> StreamUdp.writeAudioTrack), the last
//     replayed with the same code it ran.
// Every PCM write is silence, so nothing is heard. Prints one JSON object.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [tunePath, songArg = "0", secondsArg = "20", ...flags] = process.argv.slice(2);
if (!tunePath) {
  console.error("usage: android-bench.mjs <tune.sid> [songIndex] [seconds] [--legacy-only]");
  process.exit(2);
}
const tune = readFileSync(tunePath).toString("base64");
const song = Number(songArg);
const seconds = Number(secondsArg);
const legacyOnly = flags.includes("--legacy-only");

const run = `bench-${Date.now()}`;
const pageScript = `(async () => {
  const P = window.Capacitor.Plugins;
  const RATE = 48000, CHUNK = 0.5, SECONDS = ${seconds};
  const TUNE = ${JSON.stringify(tune)};
  const SONG = ${song};
  const out = { userAgent: navigator.userAgent, seconds: SECONDS };
  const now = () => performance.now();
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  // ── libSidplayEZ ──
  if (!${legacyOnly} && P.SidAudio) {
    const ez = {};
    const d = await P.SidAudio.describe();
    ez.available = d.sidplayezAvailable;
    ez.binaryPort = d.binaryPortInstalled;
    ez.abi = d.abi;
    if (d.sidplayezAvailable) {
      let t = now();
      const { renderer } = await P.SidAudio.createRenderer({ background: false });
      ez.createMs = now() - t;
      t = now();
      const opened = await P.SidAudio.openTune({ renderer, sid: TUNE, songIndex: SONG, sampleRate: RATE, sidModel: "MOS8580" });
      ez.openMs = now() - t;
      ez.nativeConstructMs = opened.constructMs;
      ez.nativeLoadMs = opened.loadMs;
      const nativeMs = [], callMs = [], ids = [];
      for (let done = 0; done < SECONDS; done += CHUNK) {
        t = now();
        const r = await P.SidAudio.render({ renderer, seconds: CHUNK });
        callMs.push(now() - t);
        nativeMs.push(r.renderMs);
        ids.push(r.bufferId);
      }
      await P.SidAudio.releaseBuffers({ bufferIds: ids });
      ez.renderMsPerSecond = nativeMs.reduce((a, b) => a + b, 0) / SECONDS;
      ez.renderCallMsMedian = median(callMs);
      ez.realtimeFactor = 1000 / ez.renderMsPerSecond;
      await P.SidAudio.disposeRenderer({ renderer });
    }
    out.sidplayez = ez;
  }

  // ── WASM renderers, in a worker as the app runs them ──
  const wasm = async (engine) => {
    const source = \`
      let Engine;
      onmessage = async (e) => {
        const { tune, song, seconds, engine } = e.data;
        const t0 = performance.now();
        Engine ??= (await import("\${location.origin}/wasm/libsidplayfp/dist/index.js")).SidAudioEngine;
        const t1 = performance.now();
        const player = new Engine({ sampleRate: 48000, stereo: true, engine });
        await player.setSystemROMs(null, null, null);
        await player.loadSidBuffer(Uint8Array.from(atob(tune), (c) => c.charCodeAt(0)), song);
        await player.setEmulationConfig({ sidModel: "MOS8580" });
        const t2 = performance.now();
        let renderMs = 0;
        for (let done = 0; done < seconds; done += 0.5) {
          const s = performance.now();
          await player.renderSeconds(0.5);
          renderMs += performance.now() - s;
        }
        player.dispose();
        postMessage({ moduleMs: t1 - t0, openMs: t2 - t1, renderMsPerSecond: renderMs / seconds });
      };\`;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), { type: "module" });
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ tune: TUNE, song: SONG, seconds: SECONDS, engine });
    });
    worker.terminate();
    return { ...result, realtimeFactor: 1000 / result.renderMsPerSecond };
  };
  if (!${legacyOnly}) {
    out.residfp = await wasm("residfp");
    out.sidlite = await wasm("sidlite");
  }

  // ── PCM transport, one second of silence per measurement, in 0.5 s chunks as the engine sends ──
  const FRAMES = RATE * CHUNK;
  const chunks = Math.round(SECONDS / CHUNK);
  const toBase64 = (bytes) => { let b = ""; for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(b); };
  const transport = {};
  if (!${legacyOnly} && P.SidAudio) {
    const serial = 900000;
    await P.SidAudio.openSession({ serial, sampleRate: RATE, bufferMs: 15000, maxRingMs: 20000, trackBursts: 16, primeMs: 600 });
    await P.SidAudio.setGain({ gain: 0 });
    let seq = 0;
    const port = window.c64SidAudioPort;
    if (port) {
      let js = 0;
      for (let i = 0; i < chunks; i += 1) {
        const buffer = new ArrayBuffer(24 + FRAMES * 4);
        const t = now();
        const v = new DataView(buffer);
        v.setUint32(0, 0x50343643, true); v.setUint32(4, 1, true); v.setUint32(8, serial, true);
        v.setUint32(12, ++seq, true); v.setUint32(16, FRAMES, true);
        port.postMessage(buffer);
        js += now() - t;
      }
      transport.binaryPort = { jsMsPerSecond: js / SECONDS, bytesPerSecond: (24 + FRAMES * 4) / CHUNK, callsPerSecond: 1 / CHUNK };
    }
    let js = 0, wall = 0;
    for (let i = 0; i < chunks; i += 1) {
      const pcm = new Int16Array(FRAMES * 2);
      const t = now();
      const data = toBase64(new Uint8Array(pcm.buffer));
      const sent = P.SidAudio.enqueuePcm({ serial, seq: ++seq, data });
      js += now() - t;
      await sent;
      wall += now() - t;
      transport.base64BytesPerSecond = data.length / CHUNK;
    }
    transport.base64Fallback = { jsMsPerSecond: js / SECONDS, wallMsPerSecond: wall / SECONDS, bytesPerSecond: transport.base64BytesPerSecond, callsPerSecond: 1 / CHUNK };
    delete transport.base64BytesPerSecond;
    await P.SidAudio.close({ serial });
  }
  // The previous release's path, as it ran: the scheduler's planar float buffer, the sink's
  // interleave with both gains, base64, and a bridge call per 4 s slice — here one per chunk.
  {
    const pcm = new Int16Array(FRAMES * 2);
    let js = 0, delivered = 0;
    for (let i = 0; i < chunks; i += 1) {
      const t = now();
      const planar = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
      for (let c = 0; c < 2; c += 1) for (let f = 0; f < FRAMES; f += 1) planar[c][f] = pcm[f * 2 + c] / 32768;
      const s16 = new Int16Array(FRAMES * 2);
      let g = 1, m = 1;
      for (let f = 0; f < FRAMES; f += 1) for (let c = 0; c < 2; c += 1) {
        const value = Math.max(-1, Math.min(1, planar[c][f] * g * m));
        s16[f * 2 + c] = Math.round(value * (value < 0 ? 32768 : 32767));
      }
      const data = toBase64(new Uint8Array(s16.buffer));
      js += now() - t;
      // Capacitor's plugin proxy answers every method name, so only a call that resolves shows the
      // method exists: on a build without it (this branch retired it) the rejection is the answer.
      if (await P.StreamUdp.writeAudioTrack({ data }).then(() => true, () => false)) delivered += 1;
    }
    transport.previousRelease = { jsMsPerSecond: js / SECONDS, bytesPerSecond: Math.ceil((FRAMES * 4) / 3) * 4 / CHUNK, bridgeCallsDelivered: delivered, bridgeCallsAttempted: chunks };
  }
  out.transport = transport;
  return JSON.stringify(out);
})()`;

// bughunt-cdp gives one evaluation 15 s, far less than a benchmark takes, so the page runs it in the
// background and this polls for the result, keyed by run so a stale benchmark is never read as this one.
const evaluate = (script) =>
  execFileSync("node", [path.join(REPO, "scripts", "bughunt-cdp.mjs"), "eval", script], {
    env: process.env,
    maxBuffer: 1 << 24,
    timeout: 60 * 1000,
  })
    .toString()
    .trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

evaluate(`(() => {
  window.__sidBenchOutcome = { run: ${JSON.stringify(run)}, text: null };
  const settle = (text) => { if (window.__sidBenchOutcome.run === ${JSON.stringify(run)}) window.__sidBenchOutcome.text = text; };
  ${pageScript}.then(settle, (error) => settle(JSON.stringify({ error: String((error && error.stack) || error) })));
  return "started";
})()`);
const deadline = Date.now() + 15 * 60 * 1000;
let outcome = null;
while (outcome === null) {
  if (Date.now() > deadline) throw new Error("the benchmark did not finish within 15 minutes");
  await sleep(2000);
  const text = evaluate(
    `String(window.__sidBenchOutcome.run === ${JSON.stringify(run)} && window.__sidBenchOutcome.text)`,
  );
  if (text !== "false" && text !== "null") outcome = text;
}
console.log(JSON.stringify(JSON.parse(outcome), null, 2));
