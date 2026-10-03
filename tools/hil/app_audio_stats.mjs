#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What the app's native audio pipeline says about itself while something else measures it.
 *
 * Samples `StreamUdp.readAudioStats()` over CDP every `--interval` ms — the same read the device-
 * safety governor makes, without `reset`, so it disturbs nothing — and writes every sample with the
 * host's wall clock, so it can be laid against a microphone or wire capture taken at the same time.
 *
 * The fields that decide whether a latency reading is the pipeline or the instrument:
 *   bufferedMs      jitter ring plus the AudioTrack's own buffer: the app's share of wire-to-air
 *   jitterBufferMs  the ring alone
 *   targetJitterMs  the depth the pipeline is steering toward
 *   concealedMs, droppedBytes, underruns   cumulative; a step during a capture is an event in it
 *
 * Runs until `--seconds` pass or it receives SIGTERM/SIGINT, then writes `--out` and prints one
 * summary line. The file is also rewritten every 20 samples, so a run that is killed hard still
 * leaves what it had.
 *
 * Usage:
 *   node tools/hil/app_audio_stats.mjs --out stats.json [--cdp-port 9333] [--interval 250] [--seconds 20]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectPage } from "./cdp_page.mjs";

const READ_STATS = `(async()=>{const p=window.Capacitor?.Plugins?.StreamUdp;
if(!p||typeof p.readAudioStats!=="function") return JSON.stringify({error:"StreamUdp.readAudioStats is not available"});
return JSON.stringify(await p.readAudioStats({}));})()`;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

/** min / median / max of the depth fields, and how much each cumulative counter grew over the run. */
export const summarizeAudioStats = (samples) => {
  const ok = samples.filter((sample) => sample.stats && !sample.stats.error);
  const range = (field) => {
    const values = ok.map((sample) => sample.stats[field]).filter((value) => typeof value === "number");
    return values.length ? { min: Math.min(...values), median: median(values), max: Math.max(...values) } : null;
  };
  const growth = (field) => {
    const values = ok.map((sample) => sample.stats[field]).filter((value) => typeof value === "number");
    return values.length ? values[values.length - 1] - values[0] : null;
  };
  return {
    samples: samples.length,
    failed: samples.length - ok.length,
    bufferedMs: range("bufferedMs"),
    jitterBufferMs: range("jitterBufferMs"),
    targetJitterMs: range("targetJitterMs"),
    concealedMsGrowth: growth("concealedMs"),
    droppedBytesGrowth: growth("droppedBytes"),
    underrunsGrowth: growth("underruns"),
  };
};

const formatRange = (range) =>
  range ? `${range.min.toFixed(0)}/${range.median.toFixed(0)}/${range.max.toFixed(0)}` : "n/a";

const main = async () => {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const out = arg("out", "");
  if (!out) {
    console.error("usage: app_audio_stats.mjs --out stats.json [--cdp-port 9333] [--interval 250] [--seconds N]");
    process.exit(2);
  }
  const intervalMs = Number(arg("interval", "250"));
  const seconds = Number(arg("seconds", "0"));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const page = await connectPage(arg("cdp-port", "9333"));
  const samples = [];
  const startedAt = Date.now();
  const write = () =>
    fs.writeFileSync(
      out,
      `${JSON.stringify({ startedAtMs: startedAt, intervalMs, summary: summarizeAudioStats(samples), samples }, null, 1)}\n`,
    );

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping && (seconds <= 0 || Date.now() - startedAt < seconds * 1000)) {
    const at = Date.now();
    try {
      samples.push({ hostEpochMs: at, stats: await page.evaluate(READ_STATS, 5_000) });
    } catch (error) {
      console.error(`WARN readAudioStats failed at ${new Date(at).toISOString()}: ${error.stack ?? error.message}`);
      samples.push({ hostEpochMs: at, stats: { error: String(error.message ?? error) } });
    }
    if (samples.length % 20 === 0) write();
    const wait = intervalMs - (Date.now() - at);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  page.close();
  write();
  const summary = summarizeAudioStats(samples);
  console.log(
    `app audio stats: ${summary.samples} samples (${summary.failed} failed), bufferedMs min/median/max ` +
      `${formatRange(summary.bufferedMs)}, jitterBufferMs ${formatRange(summary.jitterBufferMs)}, ` +
      `target ${formatRange(summary.targetJitterMs)}, concealed +${summary.concealedMsGrowth ?? "n/a"} ms, ` +
      `dropped +${summary.droppedBytesGrowth ?? "n/a"} B, underruns +${summary.underrunsGrowth ?? "n/a"} -> ${out}`,
  );
};

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`app_audio_stats: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  });
}
