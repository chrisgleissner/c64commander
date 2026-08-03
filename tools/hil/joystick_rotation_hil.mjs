#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Physical keys → joystick, asserted at the machine, at three handset orientations.
 *
 * WHAT THIS PROVES THAT A UNIT TEST CANNOT
 *
 * `joystickKeyBindings.test.ts` proves the app computes the right joystick line for a
 * key at a rotation. It cannot prove the line reached the C64, because everything past
 * the pure function — the held-set merge, the relay's coalescing, `machine:input`, and
 * the CIA — is out of its reach. Every one of those has broken this feature before.
 *
 * So the assertion is made where the player would make it: on the screen. The C64 runs
 * `tools/c64/joystick-probe.asm`, which moves a PETSCII circle one cell per joystick
 * press and advances its colour on fire. Pressing the key the player thinks of as "up"
 * has to move the circle up — and after the handset is turned, the SAME key has to move
 * it in the direction that key now points, which is the whole of what Game Mode's
 * orientation handling claims to do.
 *
 * WHAT IS DRIVEN, AND WHAT IS NOT
 *
 * Keys are injected with `adb shell input keyevent`, which enters the app the same way
 * a handset's own keypad does — through Android's key pipeline into the WebView. It is
 * a real key press, not a synthetic DOM event.
 *
 * Rotation is set through the sheet's manual override rather than by turning the phone,
 * for the plain reason that a test rig cannot turn a phone. The override is not a test
 * seam: it is the shipped control for a player lying down or a handset whose sensor
 * cannot answer, and it sets the same `deviceRotation` the sensor path sets. The sensor
 * path's own quantiser is covered by `DeviceRotationPluginTest.kt` and
 * `deviceRotation.test.ts`; what is uncovered without this script is everything between
 * that value and the machine.
 *
 * USAGE
 *
 *   node tools/hil/joystick_rotation_hil.mjs [--host c64u] [--cdp-port 9333]
 *                                            [--rotations 0,90,270]
 *
 * Requires: the app running and foregrounded on the attached device, `adb forward
 * tcp:<cdp-port>` already pointed at its WebView (see the `hil-attach` skill), and the
 * Ultimate reachable at `--host`.
 *
 * Exits non-zero on the first orientation whose mapping does not hold, and prints the
 * whole table either way so a partial failure is diagnosable.
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
const CDP_PORT = arg("cdp-port", "9333");
const ROTATIONS = arg("rotations", "0,90,270")
  .split(",")
  .map((value) => Number(value.trim()));

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
};

const SCREEN_BASE = 0x0400;
const COLOUR_BASE = 0xd800;
const CIRCLE_SCREEN_CODE = 0x51;

/**
 * The eight direction slots clockwise from up — the same circle `joystickKeyBindings.ts`
 * rotates a slot around. Duplicated here on purpose: a harness that imported the
 * app's own table would agree with it by construction and could never catch it
 * turning the wrong way.
 */
const SLOT_CIRCLE = ["up", "upRight", "right", "downRight", "down", "downLeft", "left", "upLeft"];

const rotateSlot = (slot, rotation) => {
  if (slot === "fire") return "fire";
  const index = SLOT_CIRCLE.indexOf(slot);
  if (index < 0) return slot;
  return SLOT_CIRCLE[(index + rotation / 45) % SLOT_CIRCLE.length];
};

const DELTA = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

/**
 * The keys under test, with the slot each one drives in PORTRAIT.
 *
 * Both families are here because they reach `resolveJoystickInputs` by different routes:
 * the digits come from the stored layout, the D-pad from the always-on map added beside
 * it. A rotation applied to one and not the other is a defect a digits-only run cannot
 * see.
 */
const KEYS = [
  { label: "T9 2", keycode: 9, slot: "up", family: "t9" },
  { label: "T9 8", keycode: 15, slot: "down", family: "t9" },
  { label: "T9 4", keycode: 11, slot: "left", family: "t9" },
  { label: "T9 6", keycode: 13, slot: "right", family: "t9" },
  { label: "T9 5", keycode: 12, slot: "fire", family: "t9" },
  { label: "D-pad up", keycode: 19, slot: "up", family: "dpad" },
  { label: "D-pad down", keycode: 20, slot: "down", family: "dpad" },
  { label: "D-pad left", keycode: 21, slot: "left", family: "dpad" },
  { label: "D-pad right", keycode: 22, slot: "right", family: "dpad" },
  { label: "D-pad centre", keycode: 23, slot: "fire", family: "dpad" },
];

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

const httpGetBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const readMemory = (address, length) =>
  httpGetBytes(`http://${HOST}/v1/machine:readmem?address=${address.toString(16)}&length=${length}`);

const readTelemetry = async () => {
  const bytes = await readMemory(TELEMETRY_BASE, 16);
  return Object.fromEntries(Object.entries(T).map(([name, offset]) => [name, bytes[offset]]));
};

/** The screen cell the circle should be in, and the colour beside it. */
const readCell = async (col, row) => {
  const offset = row * 40 + col;
  const [screen, colour] = await Promise.all([
    readMemory(SCREEN_BASE + offset, 1),
    readMemory(COLOUR_BASE + offset, 1),
  ]);
  return { screenCode: screen[0], colour: colour[0] & 0x0f };
};

const runProbe = async () => {
  const prg = await readFile(PROBE_PRG);
  const response = await fetch(`http://${HOST}/v1/runners:run_prg`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
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
  return telemetry;
};

const pressKey = async (keycode) => {
  // `--longpress` holds the key long enough for the relay's coalescing window to see it.
  // The probe is edge-triggered, so a longer hold is still exactly one move.
  await adb(["shell", "input", "keyevent", "--longpress", String(keycode)]);
  await sleep(900);
};

const openGameMode = async () => {
  const state = await readSheet();
  if (!state.sheet || state.gm !== "true") {
    await js('(()=>{document.querySelector("[data-testid=home-machine-inline-openGameMode]")?.click();return 1})()');
    await sleep(4000);
  }
  const after = await ensureChrome();
  if (after.joystickUnavailable) {
    throw new Error("the joystick relay is unavailable on this device; nothing here can be asserted");
  }
  if (!after.hasOverride) throw new Error("the rotation override is not reachable from Game Mode");
  return after;
};

/**
 * Bring back the toolbar the rotation override lives on, and read it.
 *
 * Game Mode hides that toolbar and the restored one puts itself away again after six
 * idle seconds. Six seconds is ample for a person and not for a harness that pays a
 * process launch and a WebSocket handshake per step, so the summon, the use and the
 * read-back all happen inside ONE page evaluation with the waits in the page.
 */
const inPage = (body) => `(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
const chrome=async()=>{if(q("remote-input-rotation-override"))return;q("remote-input-restore-chrome")?.click();await wait(500);};
${body}})()`;

const readSheet = () =>
  js(
    inPage(`const s=q("remote-input-sheet");const o=q("remote-input-rotation-override");
return JSON.stringify({sheet:!!s,gm:s?.getAttribute("data-game-mode"),
  rotation:o?Number(o.getAttribute("data-rotation")):null,source:o?.getAttribute("data-source")??null,
  hasOverride:!!o,joystickUnavailable:!!q("remote-input-joystick-unavailable-hint")});`),
  );

const ensureChrome = () =>
  js(
    inPage(`await chrome();const s=q("remote-input-sheet");const o=q("remote-input-rotation-override");
return JSON.stringify({gm:s?.getAttribute("data-game-mode"),hasOverride:!!o,
  rotation:o?Number(o.getAttribute("data-rotation")):null,
  joystickUnavailable:!!q("remote-input-joystick-unavailable-hint")});`),
  );

const pinRotation = async (rotation) => {
  const state = await js(
    inPage(`await chrome();const b=q("remote-input-rotation-${rotation}");
if(!b)return JSON.stringify({error:"the rotation override is not reachable"});
b.click();await wait(400);await chrome();const o=q("remote-input-rotation-override");
return JSON.stringify({rotation:o?Number(o.getAttribute("data-rotation")):null,source:o?.getAttribute("data-source")??null});`),
  );
  if (state.error) throw new Error(state.error);
  if (state.rotation !== rotation || state.source !== "pinned") {
    throw new Error(`pinning ${rotation}° left the sheet at ${state.rotation}° (${state.source})`);
  }
  await waitForChromeToHide();
};

/**
 * Wait for the summoned toolbar to put itself away again.
 *
 * Keys are pressed in the state Game Mode is actually played in — picture only, no
 * chrome. It is not cosmetic: with the toolbar up, one of its buttons holds focus, and
 * D-pad centre then activates that button instead of reaching the joystick. Testing
 * with the toolbar up would report a fire that never happened, or miss one that did.
 */
const waitForChromeToHide = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hidden = await js(
      '(()=>JSON.stringify({hidden:!!document.querySelector("[data-testid=remote-input-restore-chrome]")}))()',
    );
    if (hidden.hidden) return;
    await sleep(700);
  }
  throw new Error("the Game Mode chrome never auto-hid");
};

const failures = [];
const rows = [];

const checkKey = async (rotation, key) => {
  const expectedSlot = rotateSlot(key.slot, rotation);
  const before = await readTelemetry();
  await pressKey(key.keycode);
  const after = await readTelemetry();

  const observed = [];
  for (const direction of ["up", "down", "left", "right"]) {
    if (((after[direction] - before[direction]) & 0xff) !== 0) observed.push(direction);
  }
  const firedCount = (after.fires - before.fires) & 0xff;
  if (firedCount !== 0) observed.push("fire");

  const problems = [];
  if (observed.length !== 1 || observed[0] !== expectedSlot) {
    problems.push(`expected ${expectedSlot}, machine saw [${observed.join(", ") || "nothing"}]`);
  }

  if (expectedSlot === "fire") {
    if (firedCount !== 1) problems.push(`fire pressed ${firedCount} times`);
    const expectedColour = before.colour === 15 ? 1 : before.colour + 1;
    if (after.colour !== expectedColour) {
      problems.push(`colour ${before.colour} -> ${after.colour}, expected ${expectedColour}`);
    }
    if (after.col !== before.col || after.row !== before.row) {
      problems.push(`fire moved the circle to ${after.col},${after.row}`);
    }
  } else {
    const delta = DELTA[expectedSlot];
    const expectedCol = Math.min(39, Math.max(0, before.col + delta.col));
    const expectedRow = Math.min(24, Math.max(2, before.row + delta.row));
    if (after.col !== expectedCol || after.row !== expectedRow) {
      problems.push(
        `circle ${before.col},${before.row} -> ${after.col},${after.row}, expected ${expectedCol},${expectedRow}`,
      );
    }
  }

  // The display is the assertion the player would make, so it is checked as well as the
  // counters: a probe that updated its own state but not the screen would otherwise pass.
  const cell = await readCell(after.col, after.row);
  if (cell.screenCode !== CIRCLE_SCREEN_CODE) {
    problems.push(`screen at ${after.col},${after.row} holds $${cell.screenCode.toString(16)}, not the circle`);
  }
  if (cell.colour !== after.colour) {
    problems.push(`colour RAM says ${cell.colour}, telemetry says ${after.colour}`);
  }

  const ok = problems.length === 0;
  rows.push({
    rotation,
    key: key.label,
    portrait: key.slot,
    expected: expectedSlot,
    observed: observed.join(",") || "-",
    ok,
    detail: problems.join("; "),
  });
  if (!ok) failures.push(`${rotation}° ${key.label}: ${problems.join("; ")}`);
};

const main = async () => {
  console.log(`joystick + rotation HIL — Ultimate ${HOST}, rotations ${ROTATIONS.join(", ")}`);

  const info = await (await fetch(`http://${HOST}/v1/info`)).json();
  console.log(`  device: ${info.product} fw ${info.firmware_version} core ${info.core_version}`);

  const sheet = await openGameMode();
  console.log(`  sheet: game-mode=${sheet.gm}, rotation=${sheet.rotation}`);

  const start = await runProbe();
  console.log(`  probe: circle at ${start.col},${start.row}, colour ${start.colour}`);

  const screen = await readMemory(SCREEN_BASE, 8);
  const banner = Array.from(screen)
    .map((code) => (code === 0 ? "@" : String.fromCharCode(code + 64)))
    .join("");
  if (banner !== "JOYPROBE") throw new Error(`the screen does not show the probe's banner (read "${banner}")`);
  console.log(`  screen banner: ${banner}`);

  for (const rotation of ROTATIONS) {
    await pinRotation(rotation);
    console.log(`\n  --- ${rotation}° ---`);
    for (const key of KEYS) {
      await checkKey(rotation, key);
      const last = rows[rows.length - 1];
      console.log(
        `    ${last.ok ? "ok  " : "FAIL"} ${last.key.padEnd(13)} ${last.portrait.padEnd(6)}` +
          ` -> ${last.expected.padEnd(6)} machine:${last.observed}${last.detail ? `  (${last.detail})` : ""}`,
      );
    }
  }

  // Leave the handset as it was found, or the next run starts pinned.
  await js('(()=>{document.querySelector("[data-testid=remote-input-rotation-auto]")?.click();return 1})()');

  console.log(`\n${rows.filter((row) => row.ok).length}/${rows.length} checks passed`);
  if (failures.length) {
    console.error(`\nFAILURES:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(`fatal: ${error.message}`);
  process.exit(2);
});
