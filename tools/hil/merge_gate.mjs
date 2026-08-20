#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The hardware merge gate: what a Pixel 4 and a real Ultimate have to agree on before a PR lands.
 *
 * WHY THIS EXISTS AS ONE COMMAND
 *
 * The properties below have all shipped broken at least once while every automated test was
 * green, because each of them lives somewhere CI cannot go: a real Wi-Fi link, a real speaker,
 * a real AudioTrack, a real CIA. They were checked by hand, in different orders, with different
 * stimuli, and the results were compared against memories of previous runs. That is not a gate.
 * This runs them in a fixed order with fixed stimuli, prints one table, and exits non-zero if
 * anything regressed.
 *
 * WHAT IT COVERS, AND WHY EACH ONE NEEDS HARDWARE
 *
 *   preflight   The rig itself: phone attached, Ultimate answering, WebView reachable, and the
 *               speaker neither muted nor loud. Every later stage misreads a bad rig as a defect.
 *   input       A held direction keeps moving the C64, and the key-to-direction mapping survives
 *               rotation. Needs the CIA at the far end of the relay.
 *   wire        What the Ultimate SENDS, measured on the host's own link. Rules the network in or
 *               out BEFORE anything is blamed on the app — the single most common wrong turn here.
 *   av-clarity  The tone ladder as it comes out of the phone's speaker, graded per note for
 *               length, pitch, dropouts and progression. Needs a microphone in the room.
 *   av-latency  How long a sound takes to get from the Ultimate to the air. Needs both at once.
 *   sid-remote  A SID played by the Ultimate, heard through the mirror.
 *   sid-local   The same tune rendered by the on-device engine. The two paths reach the speaker
 *               through different code and have sounded materially different before.
 *   crossfade   The join between two tunes: seamless, gapped, hard cut or ragged. A moving piece
 *               of music cannot settle this and neither can listening once.
 *
 * AUDIO DISCIPLINE — this runs in someone's room
 *
 * Every audible second here is heard by whoever is sitting next to the phone. So:
 *
 *   - The phone is set to {@link GATE_VOLUME} of 25 for the run and put back afterwards, and the
 *     gate REFUSES to run above {@link MAX_VOLUME}. The graders are band-limited to 300-6000 Hz,
 *     where the room's noise floor is ~30 dB below its broadband value, so a quiet phone still
 *     measures (AGENTS.md records 27 dB median SNR at volume 10 with the mic at the grille).
 *   - Each stage plays for only as long as its grader needs, and the C64 is SILENCED between
 *     stages rather than left running. The total audible time is reported at the end so it can
 *     be argued down.
 *   - `--quiet-check` runs everything that makes no sound and skips the rest, for iterating on a
 *     non-audio change without disturbing anyone.
 *
 * USAGE
 *
 *   node tools/hil/merge_gate.mjs [--host c64u] [--iface <host ip>] [--only input,wire]
 *                                [--quiet-check] [--volume 5] [--json artifacts/hil-gate.json]
 *
 * Requires: the branch's APK installed and foregrounded on the attached Pixel, `adb forward`
 * pointed at its WebView (see the `hil-attach` skill), the Ultimate reachable, and a microphone
 * in front of the phone for the audio stages.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const HOST = arg("host", "c64u");
const PASSWORD = arg("password", "pwd");
const CDP_PORT = arg("cdp-port", "9333");
const IFACE = arg("iface", "");
const JSON_OUT = arg("json", "");
const QUIET = flag("quiet-check");
const ONLY = arg("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The volume the audible stages run at, and the ceiling the gate will not cross.
 *
 * The ceiling is not a tuning parameter. Someone sits next to this phone, and an earlier agent
 * raised the volume to improve a measurement and had to be stopped. If a grader cannot read a
 * signal at this level, the answer is a better grader or a closer microphone.
 */
const GATE_VOLUME = Number(arg("volume", "5"));
const MAX_VOLUME = 10;

/** The Ultimate answers 401 to every call when it has a password and the header is absent. */
const authHeaders = PASSWORD ? { "X-Password": PASSWORD } : {};

/** Forwarded to every child that talks to the Ultimate, so one `--password` covers the whole run. */
const passwordArgs = PASSWORD ? ["--password", PASSWORD] : [];

const MIC_DEVICE = arg("device", "plughw:CARD=SF558,DEV=0");
const TMP = arg("tmp", "/tmp");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = (args) => execFileAsync("adb", args, { maxBuffer: 1 << 22 });

const run = async (command, args, { timeoutMs = 600_000, env } = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: REPO,
      timeout: timeoutMs,
      maxBuffer: 1 << 24,
      env: { ...process.env, ...env },
    });
    return { ok: true, out: `${stdout}${stderr}` };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}` };
  }
};

const js = async (expression) => {
  const { stdout } = await execFileAsync("node", [path.join(REPO, "scripts", "bughunt-cdp.mjs"), "eval", expression], {
    env: { ...process.env, CDP_PORT },
    maxBuffer: 1 << 22,
  });
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return stdout.trim();
  }
};

/**
 * Put Listen and Watch where a stage needs them.
 *
 * The audible stages grade what comes out of the speaker, so they need Listen on — and the
 * clarity stage needs Watch on too, because contention with the video multicast is the condition
 * it exists to catch. A fresh install starts with both off, so a gate that assumed the mirror was
 * already live graded silence and reported it as a parse failure.
 */
/** Read Listen and Watch without changing them, so the run can put them back. */
const readMirror = async () => {
  const state = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
q("tab-home")?.click();await wait(1800);
const card=q("live-view-card"); if(!card) return JSON.stringify({error:"the Live View card is not on Home"});
card.scrollIntoView({block:"center"});await wait(300);
return JSON.stringify({audio:q("av-audio-toggle")?.getAttribute("aria-pressed")==="true",
  video:q("av-video-toggle")?.getAttribute("aria-pressed")==="true"});})()`);
  if (state.error) throw new Error(state.error);
  return { audio: state.audio, video: state.video };
};

const setMirror = async ({ video, audio }) => {
  const state = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
q("remote-input-restore-chrome")?.click();await wait(300);
q("remote-input-close")?.click();await wait(800);
q("tab-home")?.click();await wait(2000);
const card=q("live-view-card");
if(!card) return JSON.stringify({error:"the Live View card is not on Home"});
card.scrollIntoView({block:"center"});await wait(400);
for(const [id,want] of [["av-audio-toggle",${audio}],["av-video-toggle",${video}]]){
  const b=q(id); if(!b) return JSON.stringify({error:id+" is not on the card"});
  if((b.getAttribute("aria-pressed")==="true")!==want){b.click();await wait(3000);}
}
return JSON.stringify({audio:q("av-audio-toggle")?.getAttribute("aria-pressed"),
  video:q("av-video-toggle")?.getAttribute("aria-pressed")});})()`);
  if (state.error) throw new Error(state.error);
  if ((state.audio === "true") !== audio || (state.video === "true") !== video) {
    throw new Error(`the mirror would not go to audio=${audio} video=${video} (got ${state.audio}/${state.video})`);
  }
  // The pipeline needs a moment to open its socket and start filling before anything is graded.
  await sleep(3000);
};

/**
 * Put the C64 back to a silent BASIC prompt, so nothing plays while nothing is measuring.
 *
 * A failure here is reported rather than swallowed, and loudly: it means the machine is still
 * making a sound in someone's room, and it means the next audible stage is grading a stimulus on
 * top of whatever the last one left running. The run continues — a stage that cannot silence the
 * C64 is not a reason to abandon the stages that do not need it — but the reason is on the record.
 */
const silenceC64 = async () => {
  try {
    const response = await fetch(`http://${HOST}/v1/machine:reset`, { method: "PUT", headers: authHeaders });
    if (!response.ok) throw new Error(`machine:reset -> HTTP ${response.status}`);
  } catch (error) {
    console.error(
      `  WARN could not silence the C64 — it may still be playing, and the next audible stage ` +
        `is grading on top of it: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
  await sleep(2500);
};

const readVolume = async () => {
  const { stdout } = await adb(["shell", "dumpsys", "audio"]);
  const block = stdout.split("- STREAM_MUSIC:")[1] ?? "";
  const muted = /Muted:\s*true/.test(block.split("- STREAM")[0] ?? "");
  const index = Number(/streamVolume:(\d+)/.exec(block)?.[1] ?? "-1");
  const speaker = Number(/Current:.*?\(speaker\):\s*(\d+)/.exec(block)?.[1] ?? "-1");
  return { muted, index, speaker };
};

/**
 * Step the volume with the hardware keys rather than `cmd media_session volume --set`.
 *
 * Measured on the Pixel 4: `--set` reports "will set volume to index=N" and leaves the stream
 * where it was when the stream is muted, so a run that trusted it played at whatever the phone
 * happened to be on — which is how this gate once ran at 11 of 25 in someone's room.
 */
const setVolume = async (target) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { muted, index } = await readVolume();
    if (!muted && index === target) return;
    await adb(["shell", "input", "keyevent", index < target || muted ? "24" : "25"]);
    await sleep(250);
  }
  throw new Error(`could not set the media volume to ${target}`);
};

/**
 * Read a verdict out of `audio_e2e_probe.py run`, or refuse to.
 *
 * Exported and pure so the refusal can be tested: this is the one place where a gate that
 * measured nothing could quietly report success, and the failure mode is invisible on a good
 * day. NOT keyed on the probe's exit code — it exits non-zero for its own strict "clean or
 * breaking up" verdict, which is a stricter bar than this gate's thresholds. What has to be true
 * is that its analysis ran to the end, and the VERDICT line is the last thing it prints.
 */
export const gradeClarityOutput = (text) => {
  if (!/^VERDICT\s+\S/m.test(text)) {
    throw new Error(`the probe did not finish its analysis: ${text.trim().split("\n").slice(-3).join(" | ")}`);
  }
  const read = (pattern, label) => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`could not read ${label} from the output`);
    return Number(match[1]);
  };
  // The probe prints "defective notes  N of M" or "defective notes  none of M". Both are read;
  // ABSENT is neither, and must not be taken as a perfect run.
  const verdict = /defective notes\s+(none|\d+) of/.exec(text);
  if (!verdict) throw new Error("the probe printed no defect verdict");
  return {
    bursts: read(/bursts read\s+(\d+)/, "bursts read"),
    sequenceErrors: read(/sequence errors (\d+)/, "sequence errors"),
    dropouts: read(/DROPOUTS\s+([\d.]+)%/, "dropouts"),
    defective: verdict[1] === "none" ? 0 : Number(verdict[1]),
  };
};

/**
 * The two generated tunes the playback stages are graded against, and the pitch each holds.
 *
 * Real music cannot settle any of these questions — a listener cannot tell a stall from a rest,
 * and neither can a detector — so the stimulus is two tunes that each hold one steady tone. The
 * pitches are far apart and not an octave (an octave shares harmonics, and one tone is then
 * mistaken for the other), and both are where a phone speaker actually works.
 *
 * They have to be on the Ultimate and in the app's playlist before the gate runs; see
 * docs/testing/hil-merge-gate.md. The stages check and say so rather than grading whatever
 * happens to be queued, because grading an unknown tune is how a green run means nothing.
 */
const TONE_TUNES = [
  { title: "Tone-Low", hz: 550 },
  { title: "Tone-High", hz: 1850 },
];
const TONE_SECONDS = 10;

/**
 * The playback stages run louder than the clarity stage, and still under the ceiling.
 *
 * A generated SID holding one tone is far quieter at the microphone than the barcode stimulus —
 * measured at -73 dBFS against the barcode's comfortable margin at the same volume — and at that
 * level the presence test drifts in and out and reports a healthy pipeline as full of dropouts.
 * `MAX_VOLUME` is still an absolute refusal; this only spends the headroom below it.
 */
const TONE_VOLUME = Math.min(MAX_VOLUME, Number(arg("tone-volume", "10")));
const CROSSFADE_SECONDS = 12;

const results = [];
let audibleSeconds = 0;
/** The rig as preflight found it, so the run can put it back however it ends. */
let initialVolume = null;
let initialMirror = null;

/** A stage this gate is supposed to have and does not yet. Never counted as a pass. */
const pending = (name, what) => {
  if (ONLY.length && !ONLY.includes(name)) return;
  results.push({ name, status: "pending", detail: what });
};

const stage = async (name, audible, body) => {
  if (ONLY.length && !ONLY.includes(name)) return;
  if (QUIET && audible) {
    results.push({ name, status: "skipped", detail: "audible stage, --quiet-check" });
    console.log(`\n=== ${name}: skipped (audible) ===`);
    return;
  }
  console.log(`\n=== ${name} ===`);
  const startedAt = Date.now();
  try {
    const detail = await body();
    results.push({ name, status: "pass", detail: detail ?? "", seconds: (Date.now() - startedAt) / 1000 });
    console.log(`  PASS ${detail ?? ""}`);
  } catch (error) {
    results.push({ name, status: "fail", detail: String(error.message ?? error) });
    console.error(`  FAIL ${error.message ?? error}`);
  }
  if (audible) await silenceC64();
};

/** Grade one number out of a tool's output, so a stage fails on the value rather than the exit code. */
const number = (text, pattern, label) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`could not read ${label} from the output`);
  return Number(match[1]);
};

/** Record the microphone for `seconds` into `path`, and fail loudly rather than silently. */
const recordMic = async (path, seconds) => {
  const result = await run("arecord", [
    "-D",
    MIC_DEVICE,
    "-f",
    "S16_LE",
    "-r",
    "48000",
    "-c",
    "1",
    "-d",
    String(seconds),
    path,
  ]);
  if (!result.ok)
    throw new Error(`the microphone would not record: ${result.out.trim().split("\n").slice(-2).join(" | ")}`);
};

/**
 * Put the app on the Play tab with the two tone tunes queued, and say what is missing if they
 * are not. Returns the playlist titles so a stage can index into them.
 */
const readPlaylist = async () => {
  const state = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
q("tab-play")?.click();await wait(2500);
return JSON.stringify({titles:[...document.querySelectorAll('[data-testid="playlist-item"]')]
  .map(e=>(e.innerText||"").split(String.fromCharCode(10))[0].trim()),
  play:!!q("playlist-play"),next:!!q("playlist-next"),engine:!!q("playback-engine-toggle")});})()`);
  const missing = TONE_TUNES.map((t) => t.title).filter((title) => !state.titles?.includes(title));
  if (missing.length) {
    throw new Error(
      `the playlist does not hold ${missing.join(" and ")}. The playback stages grade a known tone, ` +
        `not whatever happens to be queued — see docs/testing/hil-merge-gate.md for how to prepare them ` +
        `(playlist now: ${(state.titles ?? []).join(", ") || "empty"})`,
    );
  }
  if (!state.engine) throw new Error("the Listen-on control is not on the Play page");
  return state.titles;
};

/**
 * Play the first tone tune on one engine and grade what reaches the microphone.
 *
 * The engine is chosen through the shipped control rather than by writing storage, because "the
 * same tune on the other path" is only a meaningful comparison if both paths were reached the way
 * a user reaches them.
 */
const gradePlayback = async (engine, label) => {
  const titles = await readPlaylist();
  const index = titles.indexOf(TONE_TUNES[0].title);
  const started = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
const e=q("playback-engine-${engine}");
if(!e) return JSON.stringify({error:"the ${label} engine option is not on the page"});
e.click();await wait(1500);
const items=document.querySelectorAll('[data-testid="playlist-item"]');
const item=items[${index}]; if(!item) return JSON.stringify({error:"the tune left the playlist"});
// Start THIS row, not "the current track". The row Play button calls
// startPlaylist(playlist, index); the transport play button is a toggle that STOPS when
// something is already playing, which is why these stages recorded a clock frozen at 0:00.
const rowPlay=item.querySelector('button[aria-label^="Play "]');
if(!rowPlay) return JSON.stringify({error:"the row has no Play button"});
rowPlay.click();await wait(4000);
return JSON.stringify({engine:q("playback-engine-${engine}")?.getAttribute("aria-pressed"),
  elapsed:q("playback-elapsed")?.innerText??null});})()`);
  if (started.error) throw new Error(started.error);
  if (started.engine !== "true") throw new Error(`the ${label} engine did not take`);
  if (started.elapsed === "0:00") {
    throw new Error(`${label}: the transport says playing but the clock has not moved off 0:00`);
  }

  const wav = path.join(TMP, `sid-${engine}.wav`);
  await recordMic(wav, TONE_SECONDS);
  await js(`(()=>{document.querySelector('[data-testid="playlist-pause"]')?.click();return 1})()`);

  const graded = await run("python3", [
    path.join("tools", "hil", "steady_tone_grade.py"),
    wav,
    "--hz",
    String(TONE_TUNES[0].hz),
    "--json",
  ]);
  const report = JSON.parse((/\{.*\}/s.exec(graded.out) ?? ["{}"])[0]);
  if (!report.verdict) throw new Error(`the grader printed no verdict: ${graded.out.trim().slice(-200)}`);
  if (report.verdict === "NO TONE") {
    throw new Error(`${label}: nothing was playing — ${report.faults.join("; ")}`);
  }
  if (report.verdict === "TOO QUIET TO GRADE") {
    throw new Error(`${label}: cannot be measured on this rig — ${report.faults.join("; ")}`);
  }
  if (report.verdict !== "clean") throw new Error(`${label}: ${report.faults.join("; ")}`);
  return `${label}: tone present ${(report.present_fraction * 100).toFixed(1)}%, ${report.cents >= 0 ? "+" : ""}${report.cents} cents, longest gap ${report.longest_gap_ms} ms`;
};

/**
 * Record one track change and grade the join.
 *
 * The recording has to span the change with both tunes audible either side of it, so the skip is
 * fired from here while `arecord` is already running rather than before it.
 */
const gradeCrossfade = async () => {
  const titles = await readPlaylist();
  const index = titles.indexOf(TONE_TUNES[0].title);
  const started = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
q("playback-engine-local")?.click();await wait(1200);
const items=document.querySelectorAll('[data-testid="playlist-item"]');
const item=items[${index}]; if(!item) return JSON.stringify({error:"the tune left the playlist"});
// See the note in the sid-remote/sid-local starter: start the row, never the transport toggle.
const rowPlay=item.querySelector('button[aria-label^="Play "]');
if(!rowPlay) return JSON.stringify({error:"the row has no Play button"});
rowPlay.click();await wait(4000);
return JSON.stringify({elapsed:q("playback-elapsed")?.innerText??null});})()`);
  if (started.error) throw new Error(started.error);

  const wav = path.join(TMP, "crossfade.wav");
  const recording = run("arecord", [
    "-D",
    MIC_DEVICE,
    "-f",
    "S16_LE",
    "-r",
    "48000",
    "-c",
    "1",
    "-d",
    String(CROSSFADE_SECONDS),
    wav,
  ]);
  // Far enough in that the outgoing tune is established, far enough from the end that the incoming
  // one is too — the grader needs both sides of the join.
  await sleep((CROSSFADE_SECONDS * 1000) / 2);
  await js(`(()=>{document.querySelector('[data-testid="playlist-next"]')?.click();return 1})()`);
  const recorded = await recording;
  if (!recorded.ok) throw new Error(`the microphone would not record: ${recorded.out.trim().slice(-160)}`);
  await js(`(()=>{document.querySelector('[data-testid="playlist-pause"]')?.click();return 1})()`);

  const graded = await run("python3", [
    path.join("tools", "hil", "crossfade_probe.py"),
    wav,
    "--low-hz",
    String(TONE_TUNES[0].hz),
    "--high-hz",
    String(TONE_TUNES[1].hz),
    "--json",
  ]);
  // `crossfade_probe.py --json` prints a top-level ARRAY, one entry per recording. Parsing from
  // the first "{" to the last "}" happened to work for a single recording and would have silently
  // mis-parsed the moment a second one was passed; and there is no `recordings` key to fall back
  // on. Take the array and read the one entry that was asked for.
  const first = graded.out.indexOf("[");
  if (first < 0) throw new Error(`the grader printed no JSON: ${graded.out.trim().slice(-240)}`);
  const parsed = JSON.parse(graded.out.slice(first));
  const report = Array.isArray(parsed) ? parsed[0] : parsed;
  const verdict = report?.verdict;
  if (!verdict) throw new Error(`the grader printed no verdict: ${graded.out.trim().slice(-240)}`);
  if (!/SEAMLESS/i.test(verdict)) throw new Error(`the join graded "${verdict}"`);
  return `join graded "${verdict}"`;
};

const preflight = async () => {
  const { stdout: devices } = await adb(["devices"]);
  const attached = devices.split("\n").filter((l) => /\tdevice$/.test(l));
  if (attached.length === 0) throw new Error("no adb device attached");

  const version = await fetch(`http://${HOST}/v1/version`, { headers: authHeaders });
  if (!version.ok) throw new Error(`the Ultimate at ${HOST} answered HTTP ${version.status}`);

  const page = await js("(()=>JSON.stringify({route:location.pathname,hidden:document.hidden}))()");
  if (typeof page !== "object") throw new Error("the WebView is not reachable over CDP — re-run adb forward");
  if (page.hidden) throw new Error("the WebView is hidden; run `adb shell wm dismiss-keyguard` and foreground the app");

  const volume = await readVolume();
  if (volume.speaker > MAX_VOLUME) {
    throw new Error(
      `the phone's speaker volume is ${volume.speaker} of 25; this gate will not run above ${MAX_VOLUME}`,
    );
  }
  // Remembered here rather than at the first audible stage, because `--only` and a mid-run failure
  // both mean that stage may never be reached — and the phone is then left wherever the gate put it.
  initialVolume = volume.index;
  initialMirror = await readMirror();
  return (
    `device ${attached.length}, route ${page.route}, speaker volume ${volume.speaker}, ` +
    `mirror audio=${initialMirror.audio} video=${initialMirror.video}`
  );
};

/**
 * Put the phone back the way it was found: its own volume, and its own Listen and Watch.
 *
 * Both matter beyond tidiness. A phone left at the gate volume misleads the next person to sit
 * next to it, and a mirror left running keeps the Ultimate pushing two multicast streams into the
 * room's Wi-Fi — which is exactly the traffic the next measurement is trying to characterise.
 */
const restoreRig = async () => {
  try {
    if (initialVolume !== null) await setVolume(initialVolume);
    if (initialMirror !== null) await setMirror(initialMirror);
  } catch (error) {
    console.error(
      `  WARN could not put the rig back as it was found: ` +
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
};

const main = async () => {
  console.log(`HIL merge gate — Ultimate ${HOST}, phone volume ${GATE_VOLUME}/25${QUIET ? ", quiet check" : ""}`);
  if (GATE_VOLUME > MAX_VOLUME) {
    console.error(`refusing to run at volume ${GATE_VOLUME}: the ceiling is ${MAX_VOLUME} (see the header)`);
    process.exit(2);
  }

  await stage("preflight", false, preflight);
  if (results.some((r) => r.name === "preflight" && r.status === "fail")) {
    console.error("\npreflight failed; nothing after it would mean anything");
    process.exit(2);
  }

  await stage("input", false, async () => {
    const hold = await run("node", [
      path.join("tools", "hil", "joystick_hold_hil.mjs"),
      "--host",
      HOST,
      ...passwordArgs,
    ]);
    if (!hold.ok) throw new Error(`held direction: ${hold.out.trim().split("\n").slice(-3).join(" | ")}`);
    const rotation = await run("node", [
      path.join("tools", "hil", "joystick_rotation_hil.mjs"),
      "--host",
      HOST,
      ...passwordArgs,
      "--layouts",
      "classicT9",
      "--rotations",
      "0,90",
    ]);
    if (!rotation.ok) throw new Error(`rotation: ${rotation.out.trim().split("\n").slice(-3).join(" | ")}`);
    const moved = number(hold.out, /kept moving rather than stopping after one cell\s+\((\d+) cells\)/, "cells moved");
    return `held direction moved ${moved} cells; ${number(rotation.out, /(\d+)\/\d+ checks passed/, "rotation checks")} rotation checks passed`;
  });

  // The sender, on the host's own link. Silent: it only listens.
  await stage("wire", false, async () => {
    const args = [path.join("tools", "hil", "av_stream_flow.py"), "--seconds", "8"];
    if (IFACE) args.push("--iface", IFACE);
    const audio = await run("python3", args);
    if (!audio.ok) throw new Error(`audio group: ${audio.out.trim().split("\n").slice(-2).join(" | ")}`);
    const loss = number(audio.out, /sequence loss: \d+ packets \(([\d.]+)%\)/, "sequence loss");
    const p99 = number(audio.out, /p99\s+([\d.]+)/, "inter-arrival p99");
    if (loss > 0.1) throw new Error(`the Ultimate itself is dropping ${loss}% of the audio stream`);
    return `sender loss ${loss}%, inter-arrival p99 ${p99} ms`;
  });

  await stage("av-clarity", true, async () => {
    await setVolume(GATE_VOLUME);
    // Both feeds: the failure this stage exists to catch is the audio losing to the video on the
    // same Wi-Fi link, which a listen-only run cannot see.
    await setMirror({ video: true, audio: true });
    audibleSeconds += 20;
    const probe = await run("python3", [
      path.join("tools", "hil", "audio_e2e_probe.py"),
      "run",
      "--host",
      HOST,
      "--password",
      PASSWORD,
      "--seconds",
      "20",
    ]);
    const { bursts, sequenceErrors, dropouts, defective } = gradeClarityOutput(probe.out);
    if (bursts < 40) throw new Error(`only ${bursts} tones reached the microphone — is the phone Listening?`);
    if (sequenceErrors > 0)
      throw new Error(`${sequenceErrors} tones arrived out of order: the ladder did not progress correctly`);
    // A verdict, not a threshold pulled from the air: this is the level the pipeline reaches with
    // the picture off, so anything worse is the app or the link, not the stimulus.
    if (defective / bursts > 0.1) throw new Error(`${defective} of ${bursts} notes defective`);
    if (dropouts > 1) throw new Error(`${dropouts}% of held tone dropped out`);
    return `${bursts} tones, ${defective} defective, ${dropouts}% dropout`;
  });

  await stage("av-latency", true, async () => {
    await setVolume(GATE_VOLUME);
    await setMirror({ video: true, audio: true });
    audibleSeconds += 10;
    await run("python3", [
      path.join("tools", "hil", "audio_e2e_probe.py"),
      "play",
      "--host",
      HOST,
      "--password",
      PASSWORD,
    ]);
    await sleep(2000);
    const args = [path.join("tools", "hil", "mirror_audio_latency_hil.py"), "--seconds", "8"];
    if (IFACE) args.push("--iface", IFACE);
    const probe = await run("python3", args);
    const strength = number(probe.out, /correlation ([\d.]+) at/, "correlation strength");
    const latency = number(probe.out, /LATENCY\s+(\d+) ms/, "latency");
    if (strength < 0.3) throw new Error(`the microphone and the wire barely correlate (${strength})`);
    return `${latency} ms wire -> speaker (correlation ${strength})`;
  });

  // The same tune, rendered two ways, graded by one instrument in one room. The two paths share
  // nothing after the tune is chosen and have sounded materially different before, so they are run
  // back to back rather than at different times.
  await stage("sid-remote", true, async () => {
    await setVolume(TONE_VOLUME);
    await setMirror({ video: false, audio: true });
    audibleSeconds += TONE_SECONDS;
    return await gradePlayback("c64", "Remote");
  });

  await stage("sid-local", true, async () => {
    await setVolume(TONE_VOLUME);
    // The on-device engine does not need the mirror, and leaving it on would put the Ultimate's
    // copy of the same tone into the room alongside it — one microphone cannot separate them.
    await setMirror({ video: false, audio: false });
    audibleSeconds += TONE_SECONDS;
    return await gradePlayback("local", "Local");
  });

  await stage("crossfade", true, async () => {
    await setVolume(TONE_VOLUME);
    await setMirror({ video: false, audio: false });
    audibleSeconds += CROSSFADE_SECONDS;
    return await gradeCrossfade();
  });

  await restoreRig();

  const failed = results.filter((r) => r.status === "fail");
  const notCovered = results.filter((r) => r.status === "pending");
  console.log(`\n${"stage".padEnd(14)} result`);
  for (const r of results) console.log(`${r.name.padEnd(14)} ${r.status}${r.detail ? `  ${r.detail}` : ""}`);
  console.log(`\naudible time: ~${audibleSeconds}s`);
  if (notCovered.length) {
    console.log(`NOT YET COVERED: ${notCovered.map((r) => r.name).join(", ")} — this run does not clear them`);
  }

  if (JSON_OUT) {
    await mkdir(path.dirname(path.resolve(REPO, JSON_OUT)), { recursive: true });
    await writeFile(
      path.resolve(REPO, JSON_OUT),
      `${JSON.stringify({ host: HOST, results, audibleSeconds }, null, 2)}\n`,
    );
    console.log(`wrote ${JSON_OUT}`);
  }

  if (failed.length) {
    console.error(`\n${failed.length} stage(s) failed: ${failed.map((f) => f.name).join(", ")}`);
    process.exit(1);
  }
};

/** Run only as a command. Importing this module (the parser test does) must not start a gate. */
const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  main().catch((error) => {
    console.error(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(2);
  });
}
