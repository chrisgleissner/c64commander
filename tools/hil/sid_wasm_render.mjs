#!/usr/bin/env node
/**
 * Render a tune through the WASM engine the app ships, once per candidate configuration.
 *
 * Scoring lives in `sid_timbre_sweep.py`, which is already calibrated against a control (the
 * correct tune scores 0.159 dB, an unrelated one 3.392 dB). This only produces the WAVs, so
 * there is one metric in the codebase rather than two that can disagree.
 *
 * The reason for going through the WASM engine at all, rather than the `sidplayfp` CLI, is
 * `combinedWaveforms` — the CLI cannot set it, and this rig needs it: the Ultimate's UltiSID
 * is configured as an "8580 Lo" filter curve with *6581* combined waveforms, a hybrid no
 * model-only sweep can express.
 *
 * Configuration has to be applied to a live context, so each candidate loads the tune, applies
 * its settings, then reloads — which rebuilds the context with them in place.
 *
 * Usage:
 *   node tools/hil/sid_wasm_render.mjs --sid tune.sid --out-dir /tmp/renders [--seconds 60]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";

const ENGINE_URL = new URL("../../public/wasm/libsidplayfp/dist/index.js", import.meta.url);

const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

function writeWav(path, pcm, rate, channels) {
  const header = Buffer.alloc(44);
  const bytes = pcm.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  writeFileSync(path, Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, bytes)]));
}

export const CANDIDATES = [
  ["default", {}, {}],
  ["6581", { sidModel: "MOS6581", forceSidModel: true }, {}],
  ["8580", { sidModel: "MOS8580", forceSidModel: true }, {}],
  ["8580-waveforms-strong", { sidModel: "MOS8580", forceSidModel: true }, { combinedWaveforms: "STRONG" }],
  ["8580-waveforms-weak", { sidModel: "MOS8580", forceSidModel: true }, { combinedWaveforms: "WEAK" }],
  ["8580-waveforms-average", { sidModel: "MOS8580", forceSidModel: true }, { combinedWaveforms: "AVERAGE" }],
  ["6581-waveforms-strong", { sidModel: "MOS6581", forceSidModel: true }, { combinedWaveforms: "STRONG" }],
  ["6581-waveforms-average", { sidModel: "MOS6581", forceSidModel: true }, { combinedWaveforms: "AVERAGE" }],
  ["6581-curve-0.0", { sidModel: "MOS6581", forceSidModel: true }, { filter6581Curve: 0.0 }],
  ["6581-curve-0.5", { sidModel: "MOS6581", forceSidModel: true }, { filter6581Curve: 0.5 }],
  ["6581-curve-1.0", { sidModel: "MOS6581", forceSidModel: true }, { filter6581Curve: 1.0 }],
  ["6581-old-caps", { sidModel: "MOS6581", forceSidModel: true }, { old6581Caps: true }],
  ["8580-curve-0.0", { sidModel: "MOS8580", forceSidModel: true }, { filter8580Curve: 0.0 }],
  ["8580-curve-1.0", { sidModel: "MOS8580", forceSidModel: true }, { filter8580Curve: 1.0 }],
];

async function main() {
  const sidPath = arg("--sid");
  const outDir = arg("--out-dir");
  const seconds = Number(arg("--seconds", "60"));
  if (!sidPath || !outDir) {
    console.error("usage: --sid tune.sid --out-dir DIR [--seconds 60]");
    return 1;
  }
  mkdirSync(outDir, { recursive: true });

  const { SidAudioEngine } = await import(ENGINE_URL.href);
  const sid = new Uint8Array(readFileSync(sidPath));

  for (const [name, emulation, filter] of CANDIDATES) {
    const engine = new SidAudioEngine({ sampleRate: 44100, stereo: false, engine: "residfp" });
    try {
      // A context only exists once something is loaded, and both setters require one. Loading
      // twice is the documented way round it: the settings are remembered and re-applied when
      // the second load rebuilds the context.
      await engine.loadSidBuffer(sid, 0);
      if (Object.keys(emulation).length) await engine.setEmulationConfig(emulation);
      if (Object.keys(filter).length) engine.setFilterConfig(filter);
      await engine.loadSidBuffer(sid, 0);

      const pcm = await engine.renderSeconds(seconds);
      const path = join(outDir, `${name}.wav`);
      writeWav(path, pcm, engine.getSampleRate(), engine.getChannels());
      const resolved = engine.getEmulationConfig();
      console.log(`${name.padEnd(24)} -> ${path}  (${resolved.sidModel}, ${pcm.length} samples)`);
    } catch (error) {
      console.log(`${name.padEnd(24)} FAILED: ${error.message}`);
    } finally {
      engine.dispose();
    }
  }
  return 0;
}

main().then((code) => process.exit(code));
