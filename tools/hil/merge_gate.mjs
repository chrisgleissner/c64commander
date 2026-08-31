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
 *   search-latency
 *               Keystroke to painted list in the search overlay, 120 samples, p95 under 100 ms.
 *               Needs the real handset: a shared CI runner cannot settle a latency budget.
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
import { percentile } from "./percentile.mjs";

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

/*
 * Every adb call carries -s. Through this helper the gate runs `input keyevent`,
 * which changes the phone's media volume, and `wm size`; with a CI emulator
 * attached alongside the phone, a bare adb call can pick the wrong one.
 * ANDROID_SERIAL is honoured so the environment variable adb itself respects
 * also works here.
 */
const SERIAL = arg("serial", process.env.ANDROID_SERIAL ?? "");
const adb = (args) => {
  // Checked here, not at module load: this file exports pure parsers that unit
  // tests import on a machine with no device and no serial set.
  if (!SERIAL) {
    throw new Error("merge_gate: --serial <serial> (or ANDROID_SERIAL) is required; refusing to pick a device");
  }
  return execFileAsync("adb", ["-s", SERIAL, ...args], { maxBuffer: 1 << 22 });
};

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

/** The balanced `open`..`close` span starting at `from`, ignoring brackets inside strings. */
const sliceBalanced = (text, from, open, close) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  throw new Error("the grader's JSON never closed");
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
/**
 * Read Listen and Watch without changing them, so the run can put them back.
 *
 * The card has to be OPENED first, the same way setMirror already does it: Live View is a
 * collapsible card, its toggles are not in the tree while it is closed, and Home now also draws
 * every device card closed while nothing is connected. A card left closed reported the toggles as
 * missing, which reads as a broken build rather than as a rig that is not talking to its machine.
 */
const readMirror = async () => {
  const state = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
q("tab-home")?.click();await wait(1800);
const card=q("live-view-card"); if(!card) return JSON.stringify({error:"the Live View card is not on Home"});
card.scrollIntoView({block:"center"});await wait(300);
if(card.getAttribute("data-force-closed")==="true")
  return JSON.stringify({error:"Home is in its offline arrangement, so the Live View card cannot open - the rig is not connected to its C64"});
const toggle=card.querySelector('button[aria-expanded="false"][aria-controls]');
if(toggle){toggle.click();await wait(800);card.scrollIntoView({block:"center"});await wait(400);}
const audio=q("av-audio-toggle"), video=q("av-video-toggle");
if(!audio||!video) return JSON.stringify({error:"the mirror toggles are not on the Live View card"});
return JSON.stringify({audio:audio.getAttribute("aria-pressed")==="true",
  video:video.getAttribute("aria-pressed")==="true"});})()`);
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
if(card.getAttribute("data-force-closed")==="true")
  return JSON.stringify({error:"Home is in its offline arrangement, so the Live View card cannot open - the rig is not connected to its C64"});
// Live View is a collapsible card and is closed on a first visit, so the mirror toggles are not
// in the tree until it is opened. The toggle is a button that says it is not expanded.
const toggle=card.querySelector('button[aria-expanded="false"][aria-controls]');
if(toggle){toggle.click();await wait(800);card.scrollIntoView({block:"center"});await wait(400);}
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
 * Leave the ROOM silent, so nothing plays while nothing is measuring.
 *
 * Two sources, and resetting the C64 only covers one of them. On-device playback renders on the
 * PHONE, so a stage that ended with a tune playing there — or that failed before its own pause —
 * left it playing through every stage that followed. Measured: with the phone still playing the
 * 550 Hz tone, a "room noise" recording read -16.1 dBFS RMS with 549.7 Hz as its loudest content,
 * and the crossfade grader answered "INCONCLUSIVE — the low tone is only 1.0x its own noise" on a
 * join that had graded SEAMLESS minutes earlier.
 *
 * A failure here is reported rather than swallowed, and loudly: it means something is still making
 * a sound in someone's room, and it means the next audible stage is grading a stimulus on top of
 * it. The run continues — a stage that cannot silence the rig is not a reason to abandon the
 * stages that do not need it — but the reason is on the record.
 */
const silenceC64 = async () => {
  // The phone first: it is the source a machine reset cannot reach.
  await js(`(()=>{document.querySelector('[data-testid="playlist-pause"]')?.click();return 1})()`).catch(() => {});
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
 * The high tone was 1850 Hz and is now 900. This runs next to somebody for a minute at a time, and
 * a sustained sawtooth up there is genuinely unpleasant to sit beside — reason enough on its own.
 * The graders lose nothing: 550 and 900 are a ratio of 1.64, so neither is an octave, a fifth or a
 * fourth of the other, and 550's second harmonic at 1100 Hz stays clear of the +-6% window the
 * pitch check draws around 900 (846-954 Hz).
 *
 * They have to be on the Ultimate and in the app's playlist before the gate runs; see
 * docs/testing/hil-merge-gate.md. The stages check and say so rather than grading whatever
 * happens to be queued, because grading an unknown tune is how a green run means nothing.
 */
const TONE_TUNES = [
  { title: "Tone-Low", hz: 550 },
  { title: "Tone-High", hz: 900 },
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
/** The Ultimate's own master volume, which the app mutes on pause. */
let initialMasterVolume = null;

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
    if (audible) await ensureMachineAudible();
    const detail = await body();
    results.push({ name, status: "pass", detail: detail ?? "", seconds: (Date.now() - startedAt) / 1000 });
    console.log(`  PASS ${detail ?? ""}`);
  } catch (error) {
    results.push({ name, status: "fail", detail: String(error.message ?? error) });
    console.error(`  FAIL ${error.message ?? error}`);
  }
  // After EVERY stage, not only the audible ones. `input` loads a probe program and leaves it
  // running, and the stages after it then measured on top of it: `av-clarity` read "0 tone bursts
  // found" and `sid-remote` read an empty room in a full run, while both passed on their own
  // minutes earlier on the same rig. A stage has to start from a known machine, and the only thing
  // that guarantees that is resetting after whatever ran last, whether or not it made a sound.
  await silenceC64();
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
  if (!state.engine) {
    // The control renders only while a SID is the CURRENT item, and after a fresh install, or
    // after any stage that launched something else, nothing is current. That is rig state rather
    // than a defect, and leaving it to be arranged by hand is how three stages sat unrunnable:
    // every attempt reported a missing control instead of grading anything.
    const nudged = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
const rows=document.querySelectorAll('[data-testid="playlist-item"]');
const play=rows[0]?.querySelector('button[aria-label^="Play "]');
if(!play) return JSON.stringify({engine:false});
play.click();await wait(4000);
q("playlist-pause")?.click();await wait(800);
return JSON.stringify({engine:!!q("playback-engine-toggle")});})()`);
    if (!nudged.engine) {
      throw new Error(
        "the Listen-on control is not on the Play page, and starting the first tune did not bring it back",
      );
    }
  }
  return state.titles;
};

/**
 * Play the first tone tune on one engine and grade what reaches the microphone.
 *
 * The engine is chosen through the shipped control rather than by writing storage, because "the
 * same tune on the other path" is only a meaningful comparison if both paths were reached the way
 * a user reaches them.
 */
/** What the output button's `data-engine` reads once each option has been chosen. */
const OUTPUT_ENGINE = {
  "playback-engine-local": "local",
  "playback-engine-c64": "c64",
  "playback-listen-both": "both",
};

/**
 * A JS fragment that clicks one of the three output destinations, opening the chooser first.
 *
 * The destinations used to be three buttons sitting on the page, and the stages clicked one of
 * them directly. They are now options inside a popover anchored to the output button on the
 * volume row, so an option is not in the DOM until that button has been clicked — and a stage
 * that goes straight for the option id reads "the option is not on the page" while the control
 * is right there. Defines `pickOutput(id, label)`, which returns null or an error string.
 */
const PICK_OUTPUT = `const pickOutput=async(id,label)=>{
  let e=q(id);
  if(!e){
    const t=q("playback-engine-toggle");
    if(!t) return "the output button is not on the page";
    t.click();await wait(900);
    e=q(id);
  }
  if(!e) return "the "+label+" output option is not on the page";
  e.click();await wait(1200);
  return null;};`;

/**
 * The clock, in seconds, or null while it reads something that is not `m:ss`.
 *
 * Split rather than matched: a regex escape inside the template literal would have to be doubled
 * to survive into the page, and `\\d` silently became `d` on the first attempt.
 */
const READ_ELAPSED = `(()=>{const e=document.querySelector('[data-testid="playback-elapsed"]');
const parts=String(e?.innerText??"").trim().split(":");
if(parts.length!==2) return JSON.stringify({seconds:null});
const mins=Number(parts[0]),secs=Number(parts[1]);
return JSON.stringify({seconds:Number.isFinite(mins)&&Number.isFinite(secs)?mins*60+secs:null});})()`;

/**
 * Wait until the clock belongs to THIS tune and is counting.
 *
 * Two shapes have to be told apart, and each defeated a simpler rule. The previous tune's clock
 * keeps running for a second or two after the click, so "any reading that differs from the one
 * sampled a moment ago" stops on the old tune's next tick — measured on a Pixel 4 with the local
 * engine: 0:27, 0:28, then 0:00 for two seconds, then 0:01 and counting. Waiting only for the drop
 * to a lower number then stops on the new tune's standing 0:00, which the remote path holds for
 * longer than a second before it counts. So the wait requires both: a reading that has advanced on
 * the one before it, and one that belongs to the new tune rather than to the old one.
 *
 * The polling is done here rather than inside the page because a single evaluate is capped at 15 s
 * by `bughunt-cdp`, and a wait long enough for a slow start ran into that cap instead of failing on
 * what it was measuring.
 */
const waitForTuneToStart = async (staleSeconds, timeoutMs = 25000) => {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  while (Date.now() < deadline) {
    const { seconds } = await js(READ_ELAPSED);
    const belongsToThisTune = staleSeconds === 0 || seconds < staleSeconds;
    if (seconds !== null && seconds > 0 && previous !== null && seconds > previous && belongsToThisTune) {
      return seconds;
    }
    previous = seconds;
    await sleep(400);
  }
  return null;
};

const gradePlayback = async (testId, label) => {
  const titles = await readPlaylist();
  const index = titles.indexOf(TONE_TUNES[0].title);
  const started = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
${PICK_OUTPUT}
const pickError=await pickOutput("${testId}","${label}");
if(pickError) return JSON.stringify({error:pickError});
const items=document.querySelectorAll('[data-testid="playlist-item"]');
const item=items[${index}]; if(!item) return JSON.stringify({error:"the tune left the playlist"});
// Start THIS row, not "the current track". The row Play button calls
// startPlaylist(playlist, index); the transport play button is a toggle that STOPS when
// something is already playing, which is why these stages recorded a clock frozen at 0:00.
const rowPlay=item.querySelector('button[aria-label^="Play "]');
if(!rowPlay) return JSON.stringify({error:"the row has no Play button"});
const parts=String(q("playback-elapsed")?.innerText??"").trim().split(":");
const stale=parts.length===2?Number(parts[0])*60+Number(parts[1]):0;
rowPlay.click();
return JSON.stringify({engine:q("playback-engine-toggle")?.getAttribute("data-engine"),
  stale:Number.isFinite(stale)?stale:0});})()`);
  if (started.error) throw new Error(started.error);
  // Read from the output button, not the option: clicking an option closes the chooser, so the
  // option's own aria-pressed is gone by the time playback has started.
  if (started.engine !== OUTPUT_ENGINE[testId]) {
    throw new Error(`the ${label} engine did not take (the output button reads ${started.engine})`);
  }
  const elapsed = await waitForTuneToStart(started.stale);
  if (elapsed === null) {
    throw new Error(`${label}: the transport says playing but the clock never started counting`);
  }
  // Then let the sound reach the speaker. The clock starts when playback is SCHEDULED; the sink
  // still has its buffer to fill, and the microphone is on the far side of that. Recording the
  // moment the clock moved put a 250-300 ms hole at the very start of every take — located in the
  // gate's own recording at 0.00-0.30 s, with the remaining 9.7 s clean. That is the rig's own
  // latency, not a defect in the tune.
  await sleep(700);

  const wav = path.join(TMP, `sid-${testId}.wav`);
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
  // Both tunes play locally here, so the mirror would only add the Ultimate's own copy.
  await setMirror({ video: false, audio: false });
  const titles = await readPlaylist();
  const index = titles.indexOf(TONE_TUNES[0].title);
  const started = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
${PICK_OUTPUT}
const pickError=await pickOutput("playback-engine-local","Local");
if(pickError) return JSON.stringify({error:pickError});
const items=document.querySelectorAll('[data-testid="playlist-item"]');
const item=items[${index}]; if(!item) return JSON.stringify({error:"the tune left the playlist"});
// See the note in the sid-remote/sid-local starter: start the row, never the transport toggle.
const rowPlay=item.querySelector('button[aria-label^="Play "]');
if(!rowPlay) return JSON.stringify({error:"the row has no Play button"});
const parts=String(q("playback-elapsed")?.innerText??"").trim().split(":");
const stale=parts.length===2?Number(parts[0])*60+Number(parts[1]):0;
rowPlay.click();
return JSON.stringify({stale:Number.isFinite(stale)?stale:0});})()`);
  if (started.error) throw new Error(started.error);
  // The same wait as the other playback stages, rather than a fixed four seconds: the recording has
  // to start with the first tune already sounding, and a local start has taken up to nine.
  if ((await waitForTuneToStart(started.stale)) === null) {
    throw new Error("the first tune never started counting, so there is no join to record");
  }

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
  // Slicing to the END of stdout only works while the array is the last thing printed. It is not:
  // the probe writes a human summary after its JSON, and the parse then failed with "unexpected
  // non-whitespace character after JSON" rather than reporting anything about the join. Read the
  // array by matching its brackets instead of assuming where the output stops.
  const first = graded.out.indexOf("[");
  if (first < 0) throw new Error(`the grader printed no JSON: ${graded.out.trim().slice(-240)}`);
  const parsed = JSON.parse(sliceBalanced(graded.out, first, "[", "]"));
  const report = Array.isArray(parsed) ? parsed[0] : parsed;
  const verdict = report?.verdict;
  if (!verdict) throw new Error(`the grader printed no verdict: ${graded.out.trim().slice(-240)}`);
  if (!/SEAMLESS/i.test(verdict)) throw new Error(`the join graded "${verdict}"`);
  return `join graded "${verdict}"`;
};

/**
 * The app's crossfade length, and a way to put it back.
 *
 * The `crossfade` stage grades the join between two tunes and its grader passes only on
 * SEAMLESS, which by definition needs an instant where both are audible. The app ships with
 * crossfade at 0 ms — a hard cut — so the stage was grading a feature nobody had turned on and
 * could not pass on a default install however well the app behaved. It asks for one now, and puts
 * the setting back afterwards like every other piece of rig state.
 */
const CROSSFADE_TEST_MS = 2000;

const readCrossfadeMs = async () => {
  const value = await js('(()=>JSON.stringify({ms:localStorage.getItem("c64u_playback_crossfade_ms")}))()');
  return typeof value === "object" ? value.ms : null;
};

const setCrossfadeMs = async (ms) => {
  await js(
    `(()=>{${ms === null ? 'localStorage.removeItem("c64u_playback_crossfade_ms")' : `localStorage.setItem("c64u_playback_crossfade_ms",${JSON.stringify(String(ms))})`};return 1})()`,
  );
};

/**
 * The Ultimate's master volume, and a way to put it back.
 *
 * The app mutes the machine when playback pauses, and the gate pauses between stages — so
 * `av-clarity` and `av-latency`, which start a tune over REST rather than through the app, played
 * into a muted machine and graded silence. They reported "0 tone bursts found — is the phone
 * audible?", which sent the search to the phone, the microphone and the mirror in turn, none of
 * which was the problem. The value is a string chosen from the item's own `values` list, spaces
 * included, because the firmware rejects anything else.
 */
const readMasterVolume = async () => {
  const response = await fetch(`http://${HOST}/v1/configs/Audio%20Mixer/Vol%20Master`, { headers: authHeaders });
  if (!response.ok) return null;
  const body = await response.json();
  const item = body?.["Audio Mixer"]?.["Vol Master"];
  return item ? { current: item.current, fallback: item.default ?? " 0 dB" } : null;
};

const setMasterVolume = async (value) => {
  const url = `http://${HOST}/v1/configs/Audio%20Mixer/Vol%20Master?value=${encodeURIComponent(value)}`;
  const response = await fetch(url, { method: "PUT", headers: authHeaders });
  const body = await response.json().catch(() => ({}));
  const errors = body?.errors ?? [];
  if (!response.ok || errors.length) throw new Error(`the Ultimate would not take Vol Master=${value}: ${errors}`);
};

/**
 * Un-mute the machine before an audible stage.
 *
 * Preflight already does this once, but it does not survive the run: the app mutes the machine
 * every time playback pauses and the gate pauses between stages, so `crossfade` graded silence
 * after `sid-local` had run, and a `--only` list that omits preflight graded silence throughout.
 * Whatever was found first is still what `restoreRig` puts back.
 */
const ensureMachineAudible = async () => {
  const master = await readMasterVolume().catch(() => null);
  if (!master || master.current !== "OFF") return;
  if (initialMasterVolume === null) initialMasterVolume = master.current;
  await setMasterVolume(master.fallback);
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

  /*
   * Refuse to run under a display-size override.
   *
   * A small-screen audit leaves `wm size 480x640` / `wm density 240` in force, and it survives
   * everything short of a reset. `input` then taps the on-screen stick at coordinates the page's
   * own devicePixelRatio says are right and the touch lands where the stick is not: the probe PRG
   * starts, its banner reads, and the machine reports 0 frames held and 0 cells moved — which
   * reads as a broken machine:input path rather than as rig state. `av-clarity` fails beside it
   * with "0 tone bursts found". Both pass after a reset with no code change, so the override is
   * worth one line here instead of two misattributed stage failures.
   */
  const override = await adb(["shell", "wm", "size"]).then(({ stdout }) => /Override size:\s*(\S+)/.exec(stdout)?.[1]);
  if (override) {
    throw new Error(
      `the display is overridden to ${override}; run "adb shell wm size reset && adb shell wm density reset", ` +
        "relaunch the app and re-attach adb forward",
    );
  }

  /*
   * Start from a machine that is not running anything.
   *
   * `input` uploads a probe program and `av-clarity` starts a tune, and neither takes on a machine
   * left inside a previous stage's program: the probe's telemetry block never appears, which the
   * stage reports as "joystick-probe did not start", and the tone stimulus is heard as one burst
   * instead of eight. Both passed immediately after a reset with no code change. `silenceC64`
   * already resets between the audible stages, so this only extends the same treatment to the
   * start of the run — and the machine is one the gate is about to drive anyway.
   */
  await silenceC64();

  /*
   * Get the first-run tour out of the way.
   *
   * It is a full-screen overlay that opens on a launch where nothing has been recorded, which is
   * exactly what a fresh `--install-apk` leaves behind. `input` taps through `adb shell input` at
   * real screen coordinates, so a tour still up eats every one of them and the stage reports a
   * machine that never moved — rig state read as a broken machine:input path.
   */
  const tour = await js(`(()=>{const o=document.querySelector('[data-testid="tour-overlay"]');
if(!o) return JSON.stringify({dismissed:false});
document.querySelector('[data-testid="tour-skip"]')?.click();
return JSON.stringify({dismissed:true});})()`);
  const tourNote = tour?.dismissed ? ", skipped the first-run tour" : "";

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
  const master = await readMasterVolume();
  let masterNote = "";
  if (master) {
    initialMasterVolume = master.current;
    if (master.current === "OFF") {
      await setMasterVolume(master.fallback);
      masterNote = `, Ultimate master volume was OFF, set to ${master.fallback.trim()}`;
    }
  }
  return (
    `device ${attached.length}, route ${page.route}, speaker volume ${volume.speaker}, ` +
    `mirror audio=${initialMirror.audio} video=${initialMirror.video}${masterNote}${tourNote}`
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
    if (initialMasterVolume !== null) await setMasterVolume(initialMasterVolume).catch(() => {});
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

  /*
   * Keystroke to painted list, on the phone (spec.md section 5.5).
   *
   * The budget only means anything measured here. A wall-clock threshold inside Vitest is a flake
   * generator on a shared runner, and the deterministic work gate beside it proves the algorithm has
   * not gone quadratic — not what this handset does with it. Twenty samples could not establish a
   * p95 either: it would be one of the two worst observations. So: 120 samples, thirty rounds of a
   * four-character query, p95 under 100 ms.
   */
  await stage("search-latency", false, async () => {
    const opened = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const w=window; w.__c64uSearchLatencyProbe=true; w.__c64uSearchLatencySamples=[];
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
q("tab-home")?.click(); await wait(1200);
q("home-search-field")?.click(); await wait(900);
return JSON.stringify({opened: q("search-input") !== null});})()`);
    if (!opened?.opened) throw new Error("the search overlay did not open");

    /*
     * Five rounds per eval, not thirty in one.
     *
     * bughunt-cdp gives Runtime.evaluate 15 s, and thirty rounds at 120 ms a keystroke is past
     * twenty — the first version of this stage failed on that timeout rather than on the budget.
     */
    for (let batch = 0; batch < 6; batch += 1) {
      const round = await js(`(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const input=document.querySelector('[data-testid="search-input"]');
if(!input) return JSON.stringify({error:"the search field went away mid-run"});
const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
const type=async(text)=>{setter.call(input,text);
  input.dispatchEvent(new Event("input",{bubbles:true})); await wait(120);};
const WORD="radio";
for(let round=0;round<5;round+=1){
  for(let n=1;n<=4;n+=1) await type(WORD.slice(0,n));
  // Clearing the box draws the promoted chips rather than a result list, which is a different
  // amount of work — so the probe is off for it and only the four typed characters are sampled.
  window.__c64uSearchLatencyProbe=false; await type(""); await wait(80);
  window.__c64uSearchLatencyProbe=true;
}
return JSON.stringify({count:(window.__c64uSearchLatencySamples||[]).length});})()`);
      if (round?.error) throw new Error(round.error);
    }

    const measured = await js(`(()=>{const w=window;
const samples=(w.__c64uSearchLatencySamples||[]).slice(); w.__c64uSearchLatencyProbe=false;
document.querySelector('[data-testid="search-close"]')?.click();
return JSON.stringify({samples});})()`);

    const samples = Array.isArray(measured?.samples) ? measured.samples : [];
    if (samples.length < 120) {
      throw new Error(`only ${samples.length} of the 120 samples were recorded; a p95 needs all of them`);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const at = (fraction) => percentile(samples, fraction);
    const p95 = at(0.95);
    // The whole distribution in the message, not only the number that failed: a p95 over budget
    // with a healthy p50 is a tail to chase, and one with a p50 already close is a different fault.
    const shape =
      `${sorted.length} samples, p50 ${at(0.5).toFixed(1)} ms, p90 ${at(0.9).toFixed(1)} ms, ` +
      `p95 ${p95.toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms`;
    if (p95 > 100) throw new Error(`keystroke to painted list is over budget (100 ms at p95): ${shape}`);
    return shape;
  });

  // The sender, on the host's own link. Silent: it only listens.
  await stage("wire", false, async () => {
    // Nothing is on the group unless the Ultimate is sending, and preflight leaves the
    // mirror however it found it — so this stage asks for the audio feed rather than
    // inheriting one, and read "0 packets — is the stream running?" when it did not.
    // Video stays off: this is the audio link's own baseline, and av-clarity is the stage
    // that puts both feeds on the same Wi-Fi on purpose.
    await setMirror({ video: false, audio: true });
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
  // "Both", not "Remote". Remote means the C64's OWN speakers: choosing it calls stopAudio(),
  // so nothing reaches the phone and the microphone beside it hears an empty room, which is how
  // this stage read "nothing was playing" while the transport clock advanced. Both is the option
  // where the Ultimate renders the tune and the mirror carries it here, which is the path this
  // stage exists to grade. Neither stage sets the mirror by hand any more: routing the audio is
  // exactly what the control under test does, and doing it here would hide it getting that wrong.
  await stage("sid-remote", true, async () => {
    await setVolume(TONE_VOLUME);
    audibleSeconds += TONE_SECONDS;
    return await gradePlayback("playback-listen-both", "Remote");
  });

  await stage("sid-local", true, async () => {
    await setVolume(TONE_VOLUME);
    audibleSeconds += TONE_SECONDS;
    return await gradePlayback("playback-engine-local", "Local");
  });

  await stage("crossfade", true, async () => {
    await setVolume(TONE_VOLUME);
    await setMirror({ video: false, audio: false });
    audibleSeconds += CROSSFADE_SECONDS;
    const previousCrossfade = await readCrossfadeMs();
    await setCrossfadeMs(CROSSFADE_TEST_MS);
    try {
      return await gradeCrossfade();
    } finally {
      await setCrossfadeMs(previousCrossfade);
    }
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
