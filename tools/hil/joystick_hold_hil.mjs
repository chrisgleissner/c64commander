#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Holding a direction keeps the C64 moving — asserted at the machine, from a real touch.
 *
 * WHAT THIS PROVES THAT THE UNIT TESTS CANNOT
 *
 * `tests/unit/tools/joystickProbe.test.ts` runs the same probe binary in a 6502
 * interpreter and proves the MACHINE repeats a held direction. It drives `$DC00`
 * directly, so it says nothing about whether a finger on the phone can produce a held
 * direction at all. Everything between the two — the pointer capture, the held-set
 * merge, the relay's coalescing, `machine:input`, the CIA — is where holding has
 * actually broken before: a press that arrives as a press-and-release relays a
 * direction the C64 sees for one frame, and one frame is a press, not a hold.
 *
 * So the touch is a real one, from outside the app: `adb shell input swipe` drags on
 * the on-screen stick and stays down. What the machine did with it is read back out of
 * the probe's telemetry.
 *
 * The expected distance is NOT assumed. The probe publishes how many frames it saw the
 * direction held (`HOLD_FRAMES`) and the repeat cadence it is using (`REPEAT_DELAY_F`,
 * `REPEAT_RATE_F`), so this computes the cells that hold earned. Guessing from the
 * swipe's own duration would fail on a busy phone for reasons that have nothing to do
 * with the code under test.
 *
 * IT ALSO CHECKS THE JOYSTICK IS THERE TO HOLD
 *
 * Game Mode puts the on-screen joystick away to give the live picture the whole screen,
 * and used to do it on a touchscreen, unasked, a couple of seconds after opening. A run
 * that found no stick to drag would be reporting exactly that defect, so the joystick
 * visibility is asserted before the drag rather than left to fail as "element not
 * found" — and the two ways it is SUPPOSED to go away, a physical key and the toolbar
 * toggle, are checked afterwards.
 *
 * USAGE
 *
 *   node tools/hil/joystick_hold_hil.mjs [--host c64u] [--password pwd]
 *                                        [--cdp-port 9333] [--hold-ms 2000]
 *
 * Requires: the app running and foregrounded on the attached device, `adb forward
 * tcp:<cdp-port>` already pointed at its WebView (see the `hil-attach` skill), and the
 * Ultimate reachable at `--host`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const PROBE_PRG = path.join(REPO, "tools", "c64", "joystick-probe.prg");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const HOST = arg("host", "c64u");
const PASSWORD = arg("password", "");
const CDP_PORT = arg("cdp-port", "9333");
const HOLD_MS = Number(arg("hold-ms", "2000"));

/** The Ultimate rejects every REST call with 401 when it has a password and the header is absent. */
const authHeaders = PASSWORD ? { "X-Password": PASSWORD } : {};

/** Telemetry block published by the probe. Keep in step with joystick-probe.asm. */
const TELEMETRY_BASE = 0xc000;
const T = {
  col: 0,
  row: 1,
  colour: 2,
  fires: 3,
  moves: 4,
  up: 5,
  down: 6,
  left: 7,
  right: 8,
  lastMask: 9,
  heldMask: 10,
  magic1: 11,
  magic2: 12,
  frames: 13,
  repeats: 14,
  holdFrames: 15,
  repeatDelay: 16,
  repeatRate: 17,
};
const TELEMETRY_BYTES = 18;

const SCREEN_BASE = 0x0400;
const CIRCLE_SCREEN_CODE = 0x51;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = (args) => execFileAsync("adb", args, { maxBuffer: 1 << 22 });

/** Evaluate an expression in the app's WebView, through the same helper the skills use. */
const js = async (expression) => {
  const { stdout } = await execFileAsync("node", [path.join(REPO, "scripts", "bughunt-cdp.mjs"), "eval", expression], {
    env: { ...process.env, CDP_PORT },
    maxBuffer: 1 << 22,
  });
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const inPage = (body) => `(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
const chrome=async()=>{if(q("remote-input-joystick-visibility-toggle"))return;q("remote-input-restore-chrome")?.click();await wait(500);};
${body}})()`;

const httpGetBytes = async (url) => {
  const response = await fetch(url, { headers: authHeaders });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const readMemory = (address, length) =>
  httpGetBytes(`http://${HOST}/v1/machine:readmem?address=${address.toString(16)}&length=${length}`);

const readTelemetry = async () => {
  const bytes = await readMemory(TELEMETRY_BASE, TELEMETRY_BYTES);
  return Object.fromEntries(Object.entries(T).map(([name, offset]) => [name, bytes[offset]]));
};

const runProbe = async () => {
  const prg = await readFile(PROBE_PRG);
  const response = await fetch(`http://${HOST}/v1/runners:run_prg`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...authHeaders },
    body: prg,
  });
  if (!response.ok) throw new Error(`run_prg -> HTTP ${response.status}`);
  // The probe discards its first second so the runner's own RUN keystrokes cannot be
  // read as joystick presses; wait that out plus a margin before trusting anything.
  await sleep(2500);
  const telemetry = await readTelemetry();
  if (telemetry.magic1 !== 0x4a || telemetry.magic2 !== 0x50) {
    throw new Error(`joystick-probe did not start (magic ${telemetry.magic1}/${telemetry.magic2})`);
  }
  const banner = Array.from(await readMemory(SCREEN_BASE, 8))
    .map((code) => (code === 0 ? "@" : String.fromCharCode(code + 64)))
    .join("");
  if (banner !== "JOYPROBE") throw new Error(`the screen does not show the probe's banner (read "${banner}")`);
  return telemetry;
};

/**
 * The cells a hold of `frames` frames earns, from the cadence the MACHINE published.
 *
 * One move lands on the press; if the direction is still held `delay` frames later the
 * second lands, and one more every `rate` frames after that. Mirrors `apply_repeat`
 * in joystick-probe.asm.
 */
const expectedMoves = (frames, delay, rate) => {
  if (frames < 1) return 0;
  const firstRepeat = 1 + delay;
  if (frames < firstRepeat) return 1;
  return 2 + Math.floor((frames - firstRepeat) / rate);
};

/**
 * Refuse to drive a page the browser has suspended.
 *
 * Chromium stops firing timers in a hidden page and Capacitor stops delivering plugin
 * results there, so a locked phone turns every wait into a CDP timeout that looks
 * exactly like an app hang. `adb shell wm dismiss-keyguard` is the fix.
 */
const assertPageVisible = async () => {
  const visibility = await js(`(()=>JSON.stringify({hidden:document.hidden,state:document.visibilityState}))()`);
  if (visibility.hidden) {
    throw new Error(
      `the WebView is ${visibility.state}: Chromium suspends timers and Capacitor callbacks there. ` +
        `Run "adb shell wm dismiss-keyguard" and try again.`,
    );
  }
};

const readSheet = () =>
  js(
    inPage(`const s=q("remote-input-sheet");
return JSON.stringify({sheet:!!s,gameMode:s?.getAttribute("data-game-mode"),
  joystick:s?.getAttribute("data-joystick")??null,
  stick:!!q("remote-input-stick-zone"),
  joystickUnavailable:!!q("remote-input-joystick-unavailable-hint")});`),
  );

const JOYSTICK_SETTING_LABEL = { auto: "Auto", visible: "Visible", hidden: "Hidden" };

/**
 * Put the on-screen-joystick setting into a known state, through the control the user has.
 *
 * A phone that has been used before carries whatever was chosen on it last, and this run
 * asserts what **Auto** does — so without this it reports a device configured to hide the
 * joystick as a defect, which is how the first run of this script read. Driving Settings
 * rather than writing `localStorage` also means the run proves the Settings control still
 * reaches the sheet, which is a claim worth one page visit.
 *
 * Returns the raw stored value so the run can put it back, including the case where
 * nothing was stored at all — which is not the same as `auto`, because the variant
 * default applies there.
 */
const selectJoystickSetting = async (setting) => {
  const label = JSON.stringify(JOYSTICK_SETTING_LABEL[setting]);
  const before = await js(
    inPage(`q("remote-input-close")?.click();await wait(600);
q("tab-settings")?.click();await wait(2500);
if(!q("settings-game-mode-joystick")){q("settings-section-toggle-play-and-disk")?.click();await wait(2000);}
const t=q("settings-game-mode-joystick");
if(!t) return JSON.stringify({error:"the on-screen joystick setting is not reachable in Settings"});
t.scrollIntoView({block:"center"});await wait(300);
return JSON.stringify({was:localStorage.getItem("c64u_game_mode_controls_visibility"),label:t.innerText});`),
  );
  if (before.error) throw new Error(before.error);

  const after = await js(
    inPage(`q("settings-game-mode-joystick").click();await wait(1200);
const o=[...document.querySelectorAll('[role=option]')].find(e=>(e.textContent||"").trim()===${label});
if(!o) return JSON.stringify({error:"no option labelled "+${label}});
o.click();await wait(1200);
return JSON.stringify({stored:localStorage.getItem("c64u_game_mode_controls_visibility"),
  label:q("settings-game-mode-joystick")?.innerText});`),
  );
  if (after.error) throw new Error(after.error);
  if (after.stored !== setting) throw new Error(`choosing ${label} stored "${after.stored}"`);

  await js(inPage(`q("tab-home")?.click();await wait(2500);return "1";`));
  return before.was;
};

/** Put back whatever the phone had, including having had nothing. */
const restoreJoystickSetting = async (was) => {
  if (was === null) {
    await js('(()=>{localStorage.removeItem("c64u_game_mode_controls_visibility");return 1})()');
    return;
  }
  // The old value names are still read by the app but can no longer be chosen in the
  // picker, so they go back the only way they can.
  if (JOYSTICK_SETTING_LABEL[was]) await selectJoystickSetting(was);
  else await js(`(()=>{localStorage.setItem("c64u_game_mode_controls_visibility",${JSON.stringify(was)});return 1})()`);
};

/**
 * Make sure there is a picture before Game Mode is opened.
 *
 * Everything this script asserts about the on-screen joystick is conditional on one: with the
 * mirror off the joystick is shown unconditionally and the toolbar toggle is not offered at all,
 * so a run on a phone whose Watch was left off silently tests nothing and then fails looking for
 * a control that was correct to be absent. That is how the first gated run of this script read.
 */
const ensureWatching = async () => {
  const state = await js(
    inPage(`q("remote-input-close")?.click();await wait(600);
q("tab-home")?.click();await wait(2000);
const card=q("live-view-card");
if(!card) return JSON.stringify({error:"the Live View card is not on Home; is the mirror flag on?"});
card.scrollIntoView({block:"center"});await wait(400);
const v=q("av-video-toggle");
if(!v) return JSON.stringify({error:"the Watch switch is not on the Live View card"});
if(v.getAttribute("aria-pressed")!=="true"){v.click();await wait(3000);}
return JSON.stringify({video:q("av-video-toggle")?.getAttribute("aria-pressed")});`),
  );
  if (state.error) throw new Error(state.error);
  if (state.video !== "true") throw new Error("Watch would not turn on, so there is no picture to give the screen to");
};

const openGameMode = async () => {
  await assertPageVisible();
  await ensureWatching();
  let state = await readSheet();
  if (!state.sheet || state.gameMode !== "true") {
    await js('(()=>{document.querySelector("[data-testid=home-machine-inline-openGameMode]")?.click();return 1})()');
    await sleep(4000);
    state = await readSheet();
  }
  if (state.joystickUnavailable) {
    throw new Error("the joystick relay is unavailable on this device; nothing here can be asserted");
  }
  if (state.gameMode !== "true") throw new Error("Game Mode did not open");
  return state;
};

/**
 * Where the on-screen stick is, in the device's own pixels.
 *
 * `adb shell input` speaks physical pixels and the DOM speaks CSS pixels, so the
 * device-pixel ratio is read from the page rather than hard-coded — it differs per
 * handset, and getting it wrong lands the touch somewhere else entirely with no error.
 */
const stickCentre = async () => {
  const rect = await js(
    `(()=>{const e=document.querySelector('[data-testid="remote-input-stick-zone"]');
if(!e)return JSON.stringify({error:"the on-screen stick is not on the page"});
const r=e.getBoundingClientRect();
return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,dpr:window.devicePixelRatio||1});})()`,
  );
  if (rect.error) throw new Error(rect.error);
  return {
    x: Math.round(rect.x * rect.dpr),
    y: Math.round(rect.y * rect.dpr),
    radiusPx: Math.round((rect.width / 2) * rect.dpr),
  };
};

const failures = [];
const check = (ok, description, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${description}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(`${description}${detail ? `: ${detail}` : ""}`);
};

/**
 * Drag the stick left and stay there, reading the machine while the finger is down.
 *
 * The read has to happen DURING the hold: `HOLD_FRAMES` is cleared the moment the
 * direction is released, and it is the quantity the whole expectation is derived from.
 */
const holdLeft = async (centre) => {
  const travel = Math.max(48, Math.round(centre.radiusPx * 0.8));
  const before = await readTelemetry();

  const swipe = adb([
    "shell",
    "input",
    "swipe",
    String(centre.x),
    String(centre.y),
    String(centre.x - travel),
    String(centre.y),
    String(HOLD_MS),
  ]);
  // Late enough that the drag has long passed the dead zone and several repeats have
  // landed, early enough that the finger is still down.
  await sleep(Math.max(400, HOLD_MS - 400));
  const during = await readTelemetry();
  await swipe;
  await sleep(600);
  const after = await readTelemetry();

  return { before, during, after };
};

const main = async () => {
  console.log(`joystick hold HIL — Ultimate ${HOST}, hold ${HOLD_MS} ms`);
  const info = await (await fetch(`http://${HOST}/v1/info`)).json();
  console.log(`  device: ${info.product} fw ${info.firmware_version} core ${info.core_version}`);

  // Assert what Auto does, from a known starting point rather than from whatever this
  // phone was last left on.
  const originalSetting = await selectJoystickSetting("auto");
  console.log(`  setting: on-screen joystick was "${originalSetting ?? "(unset)"}", running as "auto"`);

  const sheet = await openGameMode();
  console.log(`\n=== the joystick is there to hold ===`);
  check(
    sheet.joystick === "visible",
    "Game Mode opened with the on-screen joystick showing",
    `the joystick is ${sheet.joystick}`,
  );
  check(sheet.stick, "the stick zone is on the page");

  const start = await runProbe();
  console.log(
    `  probe: circle at ${start.col},${start.row}, repeat after ${start.repeatDelay} frames then every ${start.repeatRate}`,
  );

  console.log(`\n=== a held direction keeps moving the circle ===`);
  const centre = await stickCentre();
  const { before, during, after } = await holdLeft(centre);

  const heldFrames = during.holdFrames;
  const movesDuring = (during.moves - before.moves) & 0xff;
  const expected = expectedMoves(heldFrames, during.repeatDelay, during.repeatRate);

  check(
    heldFrames > during.repeatDelay,
    "the machine saw the direction held past the repeat delay",
    `${heldFrames} frames`,
  );
  check(movesDuring > 1, "the circle kept moving rather than stopping after one cell", `${movesDuring} cells`);
  // One frame of slack: the telemetry is one snapshot of a program that is still
  // running, so it can land between the frame's move and the counter that describes it.
  check(
    Math.abs(movesDuring - expected) <= 1,
    "the distance matches the cadence the machine published",
    `moved ${movesDuring}, cadence predicts ${expected}`,
  );
  check(
    before.col - during.col === movesDuring,
    "every counted move is a column further left",
    `${before.col} -> ${during.col}`,
  );

  const cell = await readMemory(SCREEN_BASE + after.row * 40 + after.col, 1);
  check(
    cell[0] === CIRCLE_SCREEN_CODE,
    "the circle is drawn where the telemetry says it is",
    `at ${after.col},${after.row}`,
  );

  console.log(`\n=== and stops when the finger comes off ===`);
  const settled = await readTelemetry();
  check(settled.moves === after.moves, "nothing moved after the release", `${after.moves} -> ${settled.moves}`);
  check(settled.heldMask === 0, "no direction is left asserted on the machine", `mask ${settled.heldMask}`);

  console.log(`\n=== the joystick goes away only when asked ===`);
  const beforeKey = await readSheet();
  check(beforeKey.joystick === "visible", "the joystick survived a game played on the touchscreen");

  // KEYCODE_DPAD_LEFT: a physical key that steers the game, which is the one thing
  // `auto` is allowed to hide the joystick on.
  await adb(["shell", "input", "keyevent", "21"]);
  await sleep(3500);
  const afterKey = await readSheet();
  check(afterKey.joystick === "hidden", "a physical key steering the game hid the joystick");

  const restored = await js(
    inPage(`await chrome();const b=q("remote-input-joystick-visibility-toggle");
if(!b)return JSON.stringify({error:"the joystick toggle is not reachable from Game Mode"});
b.click();await wait(400);
return JSON.stringify({joystick:q("remote-input-sheet")?.getAttribute("data-joystick")});`),
  );
  if (restored.error) throw new Error(restored.error);
  check(restored.joystick === "visible", "the toolbar toggle brought the joystick back");

  await js(inPage(`await chrome();q("remote-input-close")?.click();await wait(800);return "1";`));
  await restoreJoystickSetting(originalSetting);

  if (failures.length) {
    console.error(`\nFAILURES:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`\nall checks passed`);
};

main().catch((error) => {
  // The stack matters here: a failure could be the rig (no device, no CDP forward, the
  // Ultimate unreachable) or the app, and the message alone rarely says which.
  console.error(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(2);
});
