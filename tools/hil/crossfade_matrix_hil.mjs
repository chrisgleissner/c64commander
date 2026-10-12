/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Every crossfade length, on every renderer, at a skip and at a tune's natural end, with the phone
// being used while the transition runs.
//
//   node tools/hil/crossfade_matrix_hil.mjs [--renderers sidplayez,residfp,sidlite]
//     [--crossfades 0,600,1500,3000,4000] [--scenarios skip,end,skip-nav,skip-scroll,skip-volume,end-shade]
//     [--cdp-port 9333] [--device plughw:CARD=SF558,DEV=0] [--out artifacts/crossfade-matrix]
//
// Needs the merge gate's Tone-Low and Tone-High in the playlist (docs/testing/hil-merge-gate.md).
// Each trial captures the PCM the pipeline hands the AudioTrack and grades it with
// crossfade_curve.py, and records the microphone for crossfade_probe.py. The page is driven with
// short synchronous evaluations and every wait happens here: an evaluation that clicked and then
// awaited inside the page was answered "Promise was collected" four times in one gate run.

import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDroidDevice } from "./droidctl_device.mjs";
import { readVolume, restoreVolume, setVolume } from "./phone_volume.mjs";

const execFileAsync = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const RENDERERS = arg("renderers", "sidplayez,residfp,sidlite").split(",");
const CROSSFADES = arg("crossfades", "0,600,1500,3000,4000").split(",").map(Number);
const SCENARIOS = arg("scenarios", "skip,end,skip-nav,skip-scroll,skip-volume,end-shade").split(",");
const CDP_PORT = arg("cdp-port", "9333");
const MIC = arg("device", "plughw:CARD=SF558,DEV=0");
const OUT = path.resolve(
  REPO,
  arg("out", "artifacts/crossfade-matrix"),
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const VOLUME = 3;
const TUNE_SECONDS = 20;
/** As `crossfadeLeadMs` in the app: on the phone the next tune starts this long before the songlength. */
const CROSSFADE_START_MARGIN_MS = 2500;
const leadMs = (crossfadeMs) => Math.min(crossfadeMs + CROSSFADE_START_MARGIN_MS, (TUNE_SECONDS * 1000) / 2);
const LOW = { title: "Tone-Low", hz: 550 };
const HIGH = { title: "Tone-High", hz: 900 };
const KNOWN_SCENARIOS = ["skip", "end", "skip-nav", "skip-scroll", "skip-volume", "end-shade"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const js = async (expression) => {
  const { stdout } = await execFileAsync("node", [path.join(REPO, "scripts", "bughunt-cdp.mjs"), "eval", expression], {
    env: { ...process.env, CDP_PORT },
    maxBuffer: 1 << 22,
    timeout: 20_000,
  });
  const text = stdout.trim().split("\n").pop();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const click = (testId) =>
  js(
    `(()=>{const e=document.querySelector('[data-testid="${testId}"]');if(!e)return "missing";e.click();return "ok"})()`,
  );

const elapsedSeconds = async () => {
  const text = await js(`String(document.querySelector('[data-testid="playback-elapsed"]')?.innerText??"")`);
  const [mins, secs] = String(text).trim().split(":").map(Number);
  return Number.isFinite(mins) && Number.isFinite(secs) ? mins * 60 + secs : null;
};

const currentTitle = () =>
  js(`String(document.querySelector('[data-testid="playback-current-title"]')?.innerText??"").trim()`);

/** The centre of an element in device pixels, for a real touch rather than a synthetic click. */
const devicePoint = async (selector) => {
  const point = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
const r=e.getBoundingClientRect();return {x:Math.round((r.left+r.width/2)*devicePixelRatio),
y:Math.round((r.top+r.height/2+(window.visualViewport?.offsetTop??0))*devicePixelRatio)}})()`);
  if (!point || typeof point !== "object") throw new Error(`${selector} is not on the page`);
  return point;
};

const run = (command, args, timeoutMs = 120_000) =>
  execFileAsync(command, args, { cwd: REPO, timeout: timeoutMs, maxBuffer: 1 << 24 }).then(
    ({ stdout, stderr }) => ({ ok: true, out: `${stdout}${stderr}` }),
    (error) => ({ ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}` }),
  );

const recordMic = (file, seconds) =>
  new Promise((resolve) => {
    const child = spawn("arecord", ["-D", MIC, "-f", "S16_LE", "-r", "48000", "-c", "1", "-d", String(seconds), file]);
    let err = "";
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => resolve({ ok: code === 0, err }));
  });

const pickLocalOutput = async () => {
  if (
    (await js(
      `String(document.querySelector('[data-testid="playback-engine-toggle"]')?.getAttribute("data-engine"))`,
    )) === "local"
  )
    return;
  if ((await click("playback-engine-toggle")) !== "ok") throw new Error("the output button is not on the Play page");
  await sleep(900);
  if ((await click("playback-engine-local")) !== "ok") throw new Error("the This device output option is missing");
  await sleep(1200);
};

const playRow = async (title) => {
  const result = await js(`(()=>{const rows=[...document.querySelectorAll('[data-testid="playlist-item"]')];
const row=rows.find(r=>(r.innerText||"").split(String.fromCharCode(10))[0].trim()===${JSON.stringify(title)});
const play=row?.querySelector('button[aria-label^="Play "]');if(!play)return "missing";play.click();return "ok"})()`);
  if (result !== "ok") throw new Error(`${title} is not in the playlist`);
};

/** Wait until the clock has counted past `atLeast` seconds of the tune now playing. */
const waitForClock = async (atLeast, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const seconds = await elapsedSeconds();
    if (seconds !== null && seconds >= atLeast) return seconds;
    await sleep(250);
  }
  throw new Error(`the clock never reached ${atLeast} s`);
};

const setDefaultDuration = async (text) => {
  const result = await js(`(()=>{const input=document.querySelector('[data-testid="duration-input"]');
if(!input)return "missing";const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event("input",{bubbles:true}));
input.dispatchEvent(new FocusEvent("blur",{bubbles:true}));input.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));
return input.value})()`);
  if (result === "missing") throw new Error("the Default duration field is not on the Play page");
};

const stress = async (device, scenario, seconds) => {
  const until = Date.now() + seconds * 1000;
  const actions = [];
  if (scenario.endsWith("-nav")) {
    const tabs = [];
    for (const id of ["tab-home", "tab-disks", "tab-config", "tab-play"])
      tabs.push(await devicePoint(`[data-testid="${id}"]`));
    while (Date.now() < until) {
      for (const point of tabs) {
        await device.tap(point);
        actions.push("tap");
        await sleep(350);
      }
    }
  } else if (scenario.endsWith("-scroll")) {
    const list = await js(
      `({x:Math.round(innerWidth/2*devicePixelRatio),y:Math.round(innerHeight*0.55*devicePixelRatio)})`,
    );
    while (Date.now() < until) {
      await device.swipe({ x1: list.x, y1: list.y + 300, x2: list.x, y2: list.y - 300, durationMs: 150 });
      await device.swipe({ x1: list.x, y1: list.y - 300, x2: list.x, y2: list.y + 300, durationMs: 150 });
      actions.push("swipe", "swipe");
    }
  } else if (scenario.endsWith("-volume")) {
    while (Date.now() < until) {
      for (const level of [2, 4, VOLUME]) {
        await setVolume(device, level);
        actions.push(`volume ${level}`);
        await sleep(300);
      }
    }
  } else if (scenario.endsWith("-shade")) {
    await device.shell(["cmd", "statusbar", "expand-notifications"]);
    actions.push("shade down");
    await sleep(Math.max(0, until - Date.now()));
    await device.shell(["cmd", "statusbar", "collapse"]);
    actions.push("shade up");
  }
  return actions;
};

/** The current track's underrun count. */
const underruns = async () => {
  const stats = await js(`(async()=>JSON.stringify(await window.Capacitor.Plugins.StreamUdp.readAudioStats({})))()`);
  const parsed = typeof stats === "string" ? JSON.parse(stats) : stats;
  return Number(parsed?.underruns ?? 0);
};

const startCapture = (seconds) =>
  js(`(async()=>{await window.Capacitor.Plugins.StreamUdp.startAudioCapture({seconds:${seconds}});return "ok"})()`);

const pullCapture = async (device, localPath) => {
  const captured = await js(
    `(async()=>JSON.stringify(await window.Capacitor.Plugins.StreamUdp.readAudioCapture({})))()`,
  );
  const parsed = typeof captured === "string" ? JSON.parse(captured) : captured;
  if (!parsed?.bytes || !parsed.path) throw new Error("the pipeline captured no audio");
  await device.call("droid_device.pull_file", { targetId: device.targetId, remotePath: parsed.path, localPath });
};

const trial = async (device, renderer, crossfadeMs, scenario, dir) => {
  mkdirSync(dir, { recursive: true });
  await js(`(()=>{localStorage.setItem("c64u_sid_renderer",${JSON.stringify(renderer)});
localStorage.setItem("c64u_playback_crossfade_ms",${JSON.stringify(String(crossfadeMs))});return 1})()`);
  const atEnd = scenario.startsWith("end");
  await playRow(LOW.title);
  // Into the tune far enough that the first second's start-up is behind the capture.
  // At the natural end the change comes a crossfade's lead before the songlength.
  const endsAtSeconds = TUNE_SECONDS - leadMs(crossfadeMs) / 1000;
  const reached = await waitForClock(atEnd ? Math.floor(endsAtSeconds) - 4 : 2, 45_000);
  // A capture holds the samples written, not wall time: a gap or an underrun between writes is not in
  // it. The microphone hears both, and the track's own underrun count says whether it ran dry.
  const captureSeconds = Math.ceil(10 + crossfadeMs / 1000);
  const micSeconds = Math.ceil(7 + crossfadeMs / 1000);
  const micFile = path.join(dir, "mic.wav");
  const underrunsBefore = await underruns();
  await startCapture(captureSeconds);
  const transitionAt = Date.now() + (atEnd ? Math.max(1000, (endsAtSeconds - reached) * 1000) : 3000);
  // Started shortly before the transition, so a sound in the room long before it is not graded. The clock
  // reads whole seconds, so the change at a natural end is known only to within one of them.
  await sleep(Math.max(0, transitionAt - (atEnd ? 3000 : 2000) - Date.now()));
  const mic = recordMic(micFile, micSeconds);
  await sleep(Math.max(0, transitionAt - Date.now()));
  if (!atEnd && (await click("playlist-next")) !== "ok") throw new Error("the Next control is missing");
  const actions = scenario.includes("-") ? await stress(device, scenario, crossfadeMs / 1000 + 1.5) : [];
  const micResult = await mic;
  await sleep(Math.max(0, transitionAt + (captureSeconds - 3) * 1000 - Date.now()));
  const pcmFile = path.join(dir, "app-pcm.wav");
  await pullCapture(device, pcmFile);
  const underrunsAfter = await underruns();
  const after = await currentTitle();
  await click("playlist-pause");
  await click("tab-play");

  const grade = async (file, extra) => {
    const out = await run("python3", [
      path.join("tools", "hil", "crossfade_curve.py"),
      file,
      ...extra,
      "--crossfade-ms",
      String(crossfadeMs),
      "--low-hz",
      String(LOW.hz),
      "--high-hz",
      String(HIGH.hz),
      "--json",
    ]);
    return JSON.parse(out.out.slice(out.out.indexOf("{"), out.out.lastIndexOf("}") + 1));
  };
  const shape = await grade(pcmFile, []);
  const heard = micResult.ok ? await grade(micFile, ["--mic"]) : null;
  // The volume stress changes the level on purpose; at the microphone that is a dip and a ramp of the
  // wrong length, not a fault. The shape of the fades is graded on the pipeline's PCM, which volume does not touch.
  if (heard && scenario.endsWith("-volume")) {
    heard.faults = heard.faults.filter((fault) => !/dipped|fell away|rose in/.test(fault));
    heard.verdict = heard.faults.length ? "FAULTY" : heard.verdict === "NO TRANSITION" ? "NO TRANSITION" : "SMOOTH";
  }
  // A crossfade plays both tunes through one track, so its count must not move. A clean cut opens a
  // new track with a count of its own, which is reported; the microphone judges that cut.
  const ranDry = crossfadeMs > 0 ? underrunsAfter - underrunsBefore : 0;
  const newTrackUnderruns = crossfadeMs > 0 ? null : underrunsAfter;
  const landed = after.includes(HIGH.title);
  const passed = shape.verdict === "SMOOTH" && landed && heard?.verdict === "SMOOTH" && ranDry === 0;
  return {
    renderer,
    crossfadeMs,
    scenario,
    passed,
    shape,
    heard,
    underruns: ranDry,
    newTrackUnderruns,
    landed,
    after,
    actions: actions.length,
    mic: micResult.ok ? "ok" : micResult.err.trim(),
  };
};

const main = async () => {
  const unknown = SCENARIOS.filter((name) => !KNOWN_SCENARIOS.includes(name));
  if (unknown.length) throw new Error(`unknown scenario(s): ${unknown.join(", ")}`);
  mkdirSync(OUT, { recursive: true });
  const device = await createDroidDevice({});
  const volumeBefore = await readVolume(device);
  const before = await js(`JSON.stringify({renderer:localStorage.getItem("c64u_sid_renderer"),
crossfade:localStorage.getItem("c64u_playback_crossfade_ms"),duration:document.querySelector('[data-testid="duration-input"]')?.value??null})`);
  const saved = typeof before === "string" ? JSON.parse(before) : before;
  const results = [];
  try {
    await setVolume(device, VOLUME);
    await device.shell(["input", "keyevent", "KEYCODE_WAKEUP"]);
    await click("tab-play");
    await sleep(2500);
    await pickLocalOutput();
    await setDefaultDuration(`0:${TUNE_SECONDS}`);
    await sleep(800);
    for (const renderer of RENDERERS) {
      for (const crossfadeMs of CROSSFADES) {
        for (const scenario of SCENARIOS) {
          const dir = path.join(OUT, `${renderer}-${crossfadeMs}-${scenario}`);
          let result;
          try {
            result = await trial(device, renderer, crossfadeMs, scenario, dir);
          } catch (error) {
            result = { renderer, crossfadeMs, scenario, passed: false, error: error.message };
            await click("playlist-pause").catch(() => null);
          }
          results.push(result);
          writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
          const shape = result.shape ?? {};
          console.log(
            [
              result.passed ? "PASS" : "FAIL",
              renderer.padEnd(9),
              String(crossfadeMs).padStart(4),
              scenario.padEnd(11),
              result.error ??
                `out ${shape.fade_out_ms ?? "-"} in ${shape.fade_in_ms ?? "-"} ms, steepest ${shape.fade_out_steepest_x ?? "-"}/${shape.fade_in_steepest_x ?? "-"}x, gap ${shape.gap_ms}, click ${shape.click_db} dB, dip ${shape.dip_db} dB, underruns ${result.underruns}${result.newTrackUnderruns !== null && result.newTrackUnderruns !== undefined ? ` (new track ${result.newTrackUnderruns})` : ""}, mic ${result.heard?.verdict} fall ${result.heard?.fall_ms}/rise ${result.heard?.rise_ms} ms gap ${result.heard?.gap_ms}${[...(shape.faults ?? []), ...(result.heard?.faults ?? [])].length ? ` | ${[...(shape.faults ?? []), ...(result.heard?.faults ?? [])].join("; ")}` : ""}${result.landed ? "" : ` | ended on "${result.after}"`}`,
            ].join("  "),
          );
          await sleep(1500);
        }
      }
    }
  } finally {
    await js(`(()=>{const put=(k,v)=>v===null?localStorage.removeItem(k):localStorage.setItem(k,v);
put("c64u_sid_renderer",${JSON.stringify(saved.renderer)});put("c64u_playback_crossfade_ms",${JSON.stringify(saved.crossfade)});return 1})()`).catch(
      (error) => console.error(`could not restore the renderer and crossfade settings: ${error.message}`),
    );
    if (saved.duration)
      await setDefaultDuration(saved.duration).catch((error) =>
        console.error(`could not restore the default duration: ${error.message}`),
      );
    await restoreVolume(device, volumeBefore).catch((error) =>
      console.error(`could not restore the volume: ${error.message}`),
    );
  }
  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length} of ${results.length} transitions passed; evidence in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
