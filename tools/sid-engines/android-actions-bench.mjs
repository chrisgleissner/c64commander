/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// How long the actions a listener takes cost on the phone, per SID renderer, measured end to end.
//
//   CDP_PORT=9333 node tools/sid-engines/android-actions-bench.mjs [--renderers sidplayez,residfp,sidlite]
//     [--tunes <path>[#song][=label],...] [--hvsc ~/dev/c64/C64Music] [--out artifacts/sid-actions]
//
// Through window.__localSidProbe (a real LocalSidEngine, silent), for every tune and renderer:
//   play     30 s of playback: open, first position, CPU per second of audio, event-loop lag
//   whole    pre-render the whole tune (HVSC song length) beside playback, then seek to 3/4 of it,
//            which the finished pre-render answers; and the CPU that took
//   seek     from 35 s to 90 s with no pre-render (the renderer replays up to it), then a skip: the
//            next tune opened on the same engine
// CPU is the user and system time of the app process and the WebView's renderer process, read from
// /proc on the phone through droidctl. Writes actions.json and actions.md.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDroidDevice } from "../hil/droidctl_device.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const HVSC = arg("hvsc", process.env.HVSC ?? path.join(process.env.HOME ?? "", "dev/c64/C64Music"));
const RENDERERS = arg("renderers", "sidplayez,residfp,sidlite").split(",");
const DEFAULT_TUNES = [
  "MUSICIANS/H/Hubbard_Rob/Commando.sid=1SID",
  "MUSICIANS/A/A-Man/Phat_Frog_2SID.sid=2SID",
  "MUSICIANS/C/Chiummo_Gaetano/A_Walk_in_the_Countryside_3SID.sid=3SID",
  "DEMOS/A-F/Devils_ReSIDence_3SID.sid=3SID demo",
].join(",");
const TUNES = arg("tunes", DEFAULT_TUNES)
  .split(",")
  .map((spec) => {
    const [location, label] = spec.split("=");
    const [file, song = "0"] = location.split("#");
    const absolute = path.isAbsolute(file) ? file : path.join(HVSC, file);
    return { path: absolute, song: Number(song), label: label ?? path.basename(file, ".sid") };
  });
const OUT = path.resolve(REPO, arg("out", "artifacts/sid-actions"), new Date().toISOString().replace(/[:.]/g, "-"));
const PACKAGE = "uk.gleissner.c64commander";
const CLOCK_TICKS_PER_SECOND = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (script) =>
  execFileSync("node", [path.join(REPO, "scripts", "bughunt-cdp.mjs"), "eval", script], {
    env: process.env,
    maxBuffer: 1 << 24,
    timeout: 60 * 1000,
  })
    .toString()
    .trim();

/** The tune's length from HVSC's Songlengths, or null when it is not listed. */
const songLengthSeconds = (file, song) => {
  const md5 = createHash("md5").update(readFileSync(file)).digest("hex");
  const table = readFileSync(path.join(HVSC, "DOCUMENTS", "Songlengths.md5"), "utf8");
  const line = table.split("\n").find((row) => row.startsWith(`${md5}=`));
  const entry = line
    ?.slice(md5.length + 1)
    .trim()
    .split(/\s+/)[song];
  if (!entry) return null;
  const [minutes, seconds] = entry.split(":");
  return Number(minutes) * 60 + Number(seconds);
};

const runProbe = async (request) => {
  const run = `actions-${Date.now()}`;
  const started = evaluate(`(() => {
    if (typeof window.__localSidProbe !== "function") return "on-device playback is not enabled in this app";
    window.__actionsOutcome = { run: ${JSON.stringify(run)}, text: null };
    const settle = (text) => { if (window.__actionsOutcome.run === ${JSON.stringify(run)}) window.__actionsOutcome.text = text; };
    window.__localSidProbe(${JSON.stringify(request)}).then(
      (result) => { delete result.samples; settle(JSON.stringify(result)); },
      (error) => settle(JSON.stringify({ error: String((error && error.stack) || error) })),
    );
    return "started";
  })()`);
  if (started !== "started") throw new Error(started);
  const deadline = Date.now() + (request.seconds + 120) * 1000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const text = evaluate(
      `String(window.__actionsOutcome.run === ${JSON.stringify(run)} && window.__actionsOutcome.text)`,
    );
    if (text !== "false" && text !== "null") {
      const outcome = JSON.parse(text);
      if (outcome.error) throw new Error(outcome.error);
      return outcome;
    }
  }
  throw new Error(`the probe did not finish within ${request.seconds + 120} s`);
};

/** CPU seconds used so far by the app process and the WebView renderer process. */
const cpuSeconds = async (device) => {
  const out = await device.shell([
    "sh",
    "-c",
    // The WebView renderer is named after the WebView package; matching on names, not command lines,
    // keeps this shell out of the list.
    `for p in $(pidof ${PACKAGE}) $(ps -A -o PID=,NAME= | awk '$2 ~ /webview:sandboxed_process/ {print $1}'); do echo "$p $(cat /proc/$p/stat)"; done`,
  ]);
  let ticks = 0;
  const processes = [];
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const fields = line.slice(line.lastIndexOf(")") + 2).split(" ");
    ticks += Number(fields[11]) + Number(fields[12]);
    processes.push(line.split(" ")[0]);
  }
  return { seconds: ticks / CLOCK_TICKS_PER_SECOND, processes };
};

const measured = async (device, request) => {
  const before = await cpuSeconds(device);
  const wallStart = Date.now();
  const outcome = await runProbe(request);
  const after = await cpuSeconds(device);
  return {
    ...outcome,
    cpuSeconds: after.seconds - before.seconds,
    wallSeconds: (Date.now() - wallStart) / 1000,
    processes: after.processes,
  };
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const device = await createDroidDevice();
  await device.forwardWebview(PACKAGE, Number(process.env.CDP_PORT ?? 9333));
  const rows = [];
  for (const tune of TUNES) {
    const sid = readFileSync(tune.path).toString("base64");
    const length = songLengthSeconds(tune.path, tune.song) ?? 180;
    for (const renderer of RENDERERS) {
      console.log(`[actions] ${tune.label} on ${renderer}`);
      const base = { sid, songIndex: tune.song, renderer, volume: 0 };
      const play = await measured(device, { ...base, seconds: 30 });
      const whole = await measured(device, {
        ...base,
        seconds: 900,
        prerenderSeconds: length,
        untilPrerendered: true,
        seekAfterPrerender: Math.round(length * 0.75),
      });
      // The seek is made halfway through, so 70 s leaves the slowest renderer 35 s to land it.
      const seek = await measured(device, { ...base, seconds: 70, seekTo: 90, next: { sid, songIndex: tune.song } });
      rows.push({
        tune: tune.label,
        file: path.basename(tune.path),
        lengthSeconds: length,
        renderer,
        play,
        whole,
        seek,
      });
      writeFileSync(path.join(OUT, "actions.json"), JSON.stringify(rows, null, 2));
      await sleep(2000);
    }
  }
  // The 30 s of playback render 50 s of audio: the look-ahead fills as well.
  const renderedSeconds = (outcome) => outcome.final.positionSeconds + outcome.final.bufferedSeconds;
  const ms = (value) => (value === null || value === undefined ? "—" : `${Math.round(value)}`);
  const s = (value) => (value === null || value === undefined ? "—" : (value / 1000).toFixed(1));
  const lines = [
    "| Tune | Renderer | Open (ms) | First position (ms) | CPU per s of audio rendered (ms) | Lag p95 (ms) | Whole pre-render (s) | CPU meanwhile, with playback (s) | Seek in pre-render (ms) | Seek 0:35 to 1:30, no pre-render (ms) | Skip, open (ms) | Skip, first position (ms) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.tune} (${Math.round(row.lengthSeconds)} s) | ${row.renderer} | ${ms(row.play.openMs)} | ${ms(row.play.firstPositionMs)} | ` +
        `${ms((row.play.cpuSeconds * 1000) / renderedSeconds(row.play))} | ${row.play.eventLoopLagMs.p95.toFixed(1)} | ${s(row.whole.prerenderMs)} | ` +
        `${row.whole.cpuSeconds.toFixed(1)} | ${ms(row.whole.cachedSeekLatencyMs)} | ${ms(row.seek.seekLatencyMs)} | ` +
        `${ms(row.seek.nextOpenMs)} | ${ms(row.seek.nextFirstPositionMs)} |`,
    );
  }
  writeFileSync(path.join(OUT, "actions.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`[actions] wrote ${path.relative(REPO, OUT)}`);
};

main().catch((error) => {
  console.error(`[actions] FAILED: ${error.stack ?? error}`);
  process.exit(1);
});
