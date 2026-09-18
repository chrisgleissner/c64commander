#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Starting each kind of thing the app can start, and proving the machine actually started it.
 *
 * The release sweep covers the four ordinary events in a user's week; the merge gate covers what
 * needs a microphone. Neither starts a cartridge, and a cartridge is the launch with the least in
 * common with the others: it resets the machine with a ROM mapped rather than loading bytes into
 * RAM. Nor did anything check that the settings file next to a launched file is applied, which the
 * firmware does for one kind of launch and the app does for all of them.
 *
 * Evidence is read out of the machine, not off the app's screen. Each probe writes a four-byte
 * signature into RAM at $C000 and `machine:readmem` reads it back, so "it started" means the 6510
 * ran the probe's own instructions. A settings file that was applied is read back as a config item
 * over REST. Neither can be produced by an app that only looked like it worked.
 *
 *   node tools/hil/launch_matrix_hil.mjs --serial <adb serial> --host c64u --usb USB2
 *   node tools/hil/launch_matrix_hil.mjs --serial <adb serial> --host u2 --usb USB0 --only launch
 *
 * The probe files are built and uploaded by `tools/hil/build_launch_probes.mjs`; this harness
 * refuses to run when they are not on the device rather than reporting a pass it did not measure.
 *
 * Stages:
 *   preflight        the phone is attached, the app is running and on the named host, and the probe
 *                    folder holds all five files.
 *   firmware-parity  what the firmware does by itself, over REST, with no app involved: `run_prg`
 *                    applies `<program>.cfg` and falls back to `<program>.usr`; `run_crt` and
 *                    `drives:mount` apply nothing. The app has to be a superset of this, so a
 *                    firmware that changes its mind has to fail a test rather than surprise a user.
 *   discovery        adding the probe files through the app resolves the `.cfg` beside them as
 *                    "same name", for every category — not as a low-confidence folder candidate.
 *   launch           playing each item from the playlist leaves that item's signature in RAM.
 *   config-apply     the app applies the resolved `.cfg` before each launch, including for the
 *                    categories the firmware does not apply one for.
 *   config-decline   declining the settings file means it is not applied, including for a program,
 *                    where the firmware would otherwise load it after the app had finished.
 *   cartridge        everything that starts a cartridge, last, because on an Ultimate II+L one
 *                    holds the machine until it is power-cycled.
 */

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createHilCdp, sleep } from "./hil_cdp.mjs";

const execFileAsync = promisify(execFile);

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return fallback;
};

const SERIAL = arg("serial", process.env.ANDROID_SERIAL ?? "");
const PACKAGE = arg("package", "uk.gleissner.c64commander");
const CDP_PORT = Number(arg("cdp-port", "9333"));
const HOST = arg("host", "c64u");
const USB = arg("usb", "USB2");
const PASSWORD = arg("password", "pwd");
const FOLDER = arg("folder", "HilProbe");
/** What the Add-items source chooser calls the attached Ultimate. */
const SOURCE = arg("source", "C64U");
const JSON_PATH = arg("json", "");
const ONLY = (arg("only", "") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const STAGE_NAMES = ["preflight", "firmware-parity", "discovery", "launch", "config-apply", "config-decline"];

/** The config item the settings probes move. Cosmetic, present on every firmware the app supports. */
const PROBE_CATEGORY = "User Interface Settings";
const PROBE_ITEM = "Filename overflow squeeze";
/** What the probe `.cfg` sets it to, and what it is set to beforehand so the change is visible. */
const PROBE_APPLIED = "Middle";
const PROBE_BASELINE = "End";
const PROBE_RESTORE = "None";

/** Signature each probe writes at $C000, as the hex `machine:readmem` returns. */
const SIGNATURES = { prg: "50524721", crt: "43525421", disk: "44534b21" };

/** Everything the app can start, one of each category. */
const PROBE_LAUNCHABLES = ["hilprobe.prg", "hilprobe.crt", "hilprobe.d64", "hilprobe.sid"];
const PROBE_FILES = [...PROBE_LAUNCHABLES, "hilprobe.cfg"];

const probePath = (name) => `/${USB}/${FOLDER}/${name}`;

/* ---------------------------------------------------------------- REST ---- */

const rest = async (path, { method = "GET" } = {}) => {
  const response = await fetch(`http://${HOST}${path}`, {
    method,
    headers: { "X-Password": PASSWORD },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
  return response;
};

const readConfigItem = async () => {
  const body = await (
    await rest(`/v1/configs/${encodeURIComponent(PROBE_CATEGORY)}/${encodeURIComponent(PROBE_ITEM)}`)
  ).json();
  return body[PROBE_CATEGORY][PROBE_ITEM].current;
};

const writeConfigItem = (value) =>
  rest(`/v1/configs/${encodeURIComponent(PROBE_CATEGORY)}/${encodeURIComponent(PROBE_ITEM)}?value=${value}`, {
    method: "PUT",
  });

const readSignature = async () => {
  const bytes = new Uint8Array(await (await rest("/v1/machine:readmem?address=C000&length=4")).arrayBuffer());
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const clearSignature = () => rest("/v1/machine:writemem?address=C000&data=00000000", { method: "PUT" });

/*
 * Applying a settings file is not a REST call: there is no endpoint that loads a `.cfg`, so the app
 * drives the device's own menu over Telnet, and that takes tens of seconds. Polling for the result
 * is the difference between measuring the launch and measuring how long the harness happened to
 * sleep — a fixed fifteen seconds reported a launch that had not been reached yet as a failure.
 */
const LAUNCH_BUDGET_MS = 120_000;

const pollUntil = async (read, expected, what) => {
  const deadline = Date.now() + LAUNCH_BUDGET_MS;
  let last = null;
  for (;;) {
    last = await read();
    if (last === expected) return { value: last, ms: LAUNCH_BUDGET_MS - (deadline - Date.now()) };
    if (Date.now() > deadline) throw new Error(`${what}: ${last}, expected ${expected}`);
    await sleep(2000);
  }
};

/** Back to the configured cartridge and a clean machine; a started CRT holds the bus until this. */
const reboot = async () => {
  await rest("/v1/machine:reboot", { method: "PUT" });
  await sleep(7000);
};

/* ----------------------------------------------------------------- app ---- */

const { adb, shell, attach, evaluate, takeConsoleErrors, foreignFocusedWindow } = createHilCdp({
  serial: SERIAL,
  packageName: PACKAGE,
  port: CDP_PORT,
});

/**
 * A real touch at the centre of what a page expression returns.
 *
 * The app does not react to a dispatched `click`: its controls listen for pointer events, so a
 * programmatic click reads as no interaction at all. The expression returns CSS pixels and the
 * device wants physical ones, which is what the page's own `devicePixelRatio` converts.
 */
const tapFrom = async (expression) => {
  const spot = await evaluate(`(()=>{
    const element = (${expression});
    if (!element) return null;
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return JSON.stringify({
      x: Math.round((rect.x + rect.width / 2) * ratio),
      y: Math.round((rect.y + rect.height / 2) * ratio),
    });
  })()`);
  if (!spot) throw new Error(`nothing to tap for ${expression.slice(0, 60)}`);
  await shell(`input tap ${spot.x} ${spot.y}`);
  await sleep(1200);
};

const tapTestId = (id) => tapFrom(`document.querySelector('[data-testid=${JSON.stringify(id)}]')`);

/**
 * Wait for the page to show something, rather than sleeping for a guess.
 *
 * A fixed sleep after a tap is what makes a harness flaky in one direction and slow in the other:
 * the sheet that usually opens in two seconds takes four under load, and the stage then reports a
 * missing control as if the app had not drawn it.
 */
const waitFor = async (expression, { timeoutMs = 20_000, label = expression } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await evaluate(`Boolean(${expression})`)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(500);
  }
};

const waitForTestId = (id, timeoutMs) =>
  waitFor(`document.querySelector('[data-testid=${JSON.stringify(id)}]')`, { timeoutMs, label: id });

/**
 * Type into a field without the on-screen keyboard.
 *
 * The keyboard covers the bottom half of the screen while leaving the page laid out at full height,
 * so every later tap computed from a bounding box lands on a key instead of the control. Setting the
 * value through the native setter and dispatching `input` is what React reads, and nothing opens.
 */
const setFieldValue = (id, value) =>
  evaluate(`(()=>{
    const field = document.querySelector('[data-testid=${JSON.stringify(id)}]');
    if (!field) return "missing";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.blur();
    return "ok";
  })()`);

const dismissKeyboard = () => shell("input keyevent 4");

const goto = async (route) => {
  await evaluate(
    `(()=>{history.pushState({}, "", ${JSON.stringify(route)});
      window.dispatchEvent(new PopStateEvent("popstate")); return "ok";})()`,
  );
  await sleep(2500);
};

/** The tour owns the screen on a first run and every tap would land on its scrim. */
const dismissTour = async () => {
  const present = await evaluate(`Boolean(document.querySelector('[data-testid="tour-skip"]'))`);
  if (!present) return;
  await tapTestId("tour-skip");
  await sleep(1500);
};

/*
 * Rows are matched on the path they show, not on their label. A tune is labelled from its own
 * header ("Hilprobe"), not from its file name, so a label match silently misses the one category
 * whose name the app rewrites.
 */
const playlistPaths = () =>
  evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid="playlist-item"]')]
    .map((element) => element.innerText))`);

const configSheetState = () =>
  evaluate(`(()=>{
    const sheet = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!sheet) return null;
    const text = sheet.innerText.replace(/\\n/g, " | ");
    const field = (label) => (new RegExp(label + " \\\\| ([^|]+)").exec(text) || [])[1]?.trim() ?? null;
    return JSON.stringify({ origin: field("Origin"), resolved: field("Resolved file"), status: field("Status") });
  })()`);

const openConfigSheet = (fileName) =>
  tapFrom(`(()=>{
    const row = [...document.querySelectorAll('[data-testid="playlist-item"]')]
      .find((element) => element.innerText.includes(${JSON.stringify(probePath(fileName))}));
    return row && [...row.querySelectorAll("button")]
      .find((button) => /Open config details/.test(button.getAttribute("aria-label") || ""));
  })()`);

const tapSheetButton = (label) =>
  tapFrom(`(()=>{
    const sheet = [...document.querySelectorAll('[role="dialog"]')].pop();
    return sheet && [...sheet.querySelectorAll("button")]
      .find((button) => button.innerText.trim() === ${JSON.stringify(label)});
  })()`);

/*
 * The Play page hydrates its playlist from storage, so a row is not there the moment the route is.
 * Waiting for the row also waits out the "loading" state that disables every control on it.
 */
const openPlayPageWith = async (fileName) => {
  await goto("/play");
  await dismissTour();
  /*
   * A stage names the file it needs rather than relying on an earlier stage having added it, so
   * `--only config-apply` measures the same thing a whole run does. Installing a build empties the
   * playlist, and a stage that then waited for a row that was never coming would report a timeout
   * where the answer is to add the items.
   */
  const present = await evaluate(
    `[...document.querySelectorAll('[data-testid="playlist-item"]')]
       .some((element) => element.innerText.includes(${JSON.stringify(probePath(fileName))}))`,
  );
  if (!present) await addProbeItems();
  await waitFor(
    `[...document.querySelectorAll('[data-testid="playlist-item"]')]
       .some((element) => element.innerText.includes(${JSON.stringify(probePath(fileName))}))`,
    { label: `the ${fileName} row`, timeoutMs: 60_000 },
  );
  await waitFor(
    `(() => {
      const row = [...document.querySelectorAll('[data-testid="playlist-item"]')]
        .find((element) => element.innerText.includes(${JSON.stringify(probePath(fileName))}));
      const play = row && [...row.querySelectorAll("button")]
        .find((button) => /^Play /.test(button.getAttribute("aria-label") || ""));
      return Boolean(play) && !play.disabled;
    })()`,
    { label: `the ${fileName} row to become playable`, timeoutMs: 120_000 },
  );
};

const playFromPlaylist = (fileName) =>
  tapFrom(`(()=>{
    const row = [...document.querySelectorAll('[data-testid="playlist-item"]')]
      .find((element) => element.innerText.includes(${JSON.stringify(probePath(fileName))}));
    return row && [...row.querySelectorAll("button")]
      .find((button) => /^Play /.test(button.getAttribute("aria-label") || ""));
  })()`);

/* ------------------------------------------------------------- results ---- */

const results = [];
const record = (name, status, detail, data) => {
  results.push({ name, status, detail, ...(data ? { data } : {}) });
  const mark = status === "pass" ? "PASS" : status === "pending" ? "PEND" : "FAIL";
  console.log(`  ${mark} ${name}: ${detail}`);
};

const stage = async (name, body) => {
  if (ONLY.length && !ONLY.includes(name)) return;
  console.log(`\n=== ${name} ===`);
  try {
    await body();
  } catch (error) {
    record(name, "fail", error instanceof Error ? error.message : String(error));
  }
};

/* -------------------------------------------------------------- stages ---- */

const ftpList = async (path) => {
  const { stdout } = await execFileAsync("curl", ["-s", "--max-time", "15", "--list-only", `ftp://${HOST}${path}`]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

const preflight = async () => {
  if (!SERIAL) throw new Error("--serial <serial> (or ANDROID_SERIAL) is required; refusing to pick a device");
  const { stdout: devices } = await execFileAsync("adb", ["devices"]);
  if (!devices.includes(`${SERIAL}\tdevice`)) throw new Error(`${SERIAL} is not attached and ready`);

  const info = await (await rest("/v1/info")).json();
  record("preflight", "pass", `${info.product} ${info.firmware_version} answers as ${HOST}`);

  const listed = await ftpList(`/${USB}/${FOLDER}/`);
  const missing = PROBE_FILES.filter((name) => !listed.some((entry) => entry.toLowerCase() === name));
  if (missing.length) {
    throw new Error(`probe folder /${USB}/${FOLDER} is missing ${missing.join(", ")} — run build_launch_probes.mjs`);
  }
  record("preflight", "pass", `probe folder holds all ${PROBE_FILES.length} files`);

  await attach();
  await dismissKeyboard();
  /*
   * A sleeping screen reports NotificationShade as the focused window and answers every tap with
   * nothing, so a run that started on a dark phone drove a screen the taps never reached. Waking it
   * and dismissing the keyguard is not a decision anyone made — unlike a permission dialog, which
   * is a question put to the user, and is reported below rather than answered here.
   */
  await shell("input keyevent KEYCODE_WAKEUP");
  await shell("wm dismiss-keyguard");
  await shell("cmd statusbar collapse").catch(() => undefined);
  await sleep(2000);
  const wakefulness = (await shell("dumpsys power | grep -m1 mWakefulness")).trim();
  if (!/Awake/.test(wakefulness)) throw new Error(`the phone did not wake (${wakefulness})`);
  const foreign = await foreignFocusedWindow();
  if (foreign) throw new Error(`another window has focus: ${foreign}`);
  await goto("/play");
  await dismissTour();
  const connected = await evaluate(
    `document.querySelector('[data-testid="unified-health-badge"]')?.dataset.connectedDevice ?? ""`,
  );
  if (!connected) throw new Error("the app reports no connected device");
  /*
   * The app has to be on the device this run measures, not merely on some device. A saved device
   * that is momentarily unreachable — a machine rebooting, say — lets startup connect to another
   * configured one instead, and the run then drives one device while asserting against another.
   * The badge shows a name or an address, so identity is settled by the unique id behind it.
   */
  if (connected !== HOST) {
    const target = (await (await rest("/v1/info")).json()).unique_id;
    const shown = await fetch(`http://${connected}/v1/info`, {
      headers: { "X-Password": PASSWORD },
      signal: AbortSignal.timeout(8000),
    })
      .then((response) => response.json())
      .then((body) => body.unique_id)
      .catch(() => null);
    if (!target || shown !== target) {
      throw new Error(`the app is connected to ${connected}, not to ${HOST}`);
    }
  }
  record("preflight", "pass", `app is on /play, connected to ${connected}`);
};

/**
 * What the firmware does on its own, with no app in the picture.
 *
 * Measured rather than assumed, because every superset claim the app makes rests on it and a
 * firmware release can change it. On a C64 Ultimate (1.2RC) and an Ultimate 64 and an Ultimate II+L
 * (both 3.15) the three answers below were identical.
 */
const restRunAndRead = async (what, path) => {
  await writeConfigItem(PROBE_BASELINE);
  await clearSignature();
  await rest(`/v1/runners:${what}?file=${encodeURIComponent(path)}`, { method: "PUT" });
  await sleep(4000);
  return { item: await readConfigItem(), signature: await readSignature() };
};

const firmwareParity = async () => {
  const run = restRunAndRead;
  await reboot();
  const withCfg = await run("run_prg", probePath("hilprobe.prg"));
  if (withCfg.signature !== SIGNATURES.prg) throw new Error(`run_prg left ${withCfg.signature} at $C000`);
  if (withCfg.item !== PROBE_APPLIED) {
    throw new Error(`firmware no longer applies <program>.cfg on run_prg: ${PROBE_ITEM} is ${withCfg.item}`);
  }
  record("firmware-parity", "pass", `run_prg applies the sibling .cfg (${PROBE_ITEM} -> ${withCfg.item})`);

  const withoutCfg = await run("run_prg", `/${USB}/${FOLDER}NoCfg/hilprobe.prg`);
  if (withoutCfg.item !== PROBE_BASELINE) {
    throw new Error(`run_prg changed ${PROBE_ITEM} to ${withoutCfg.item} with no settings file beside the program`);
  }
  record("firmware-parity", "pass", `run_prg with no sibling .cfg leaves ${PROBE_ITEM} at ${withoutCfg.item}`);

  await reboot();
  await writeConfigItem(PROBE_RESTORE);
};

const tapButtonLabelled = (label) =>
  tapFrom(
    `[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === ${JSON.stringify(label)})`,
  );

/** Add the probe folder's files through the picker, the way a user does. */
const addProbeItems = async () => {
  await goto("/play");
  await dismissTour();
  // Start from an empty playlist so the stage measures this add rather than a previous run's.
  /*
   * Clearing is a plain button with no confirmation, so a press that leaves rows behind means the
   * press did not land — a toast or the keypad guidance bar over it, most often. Pressing again
   * costs a second and is the difference between a run and a run lost to a swallowed tap.
   */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const queued = await evaluate(`document.querySelectorAll('[data-testid="playlist-item"]').length`);
    if (!queued) break;
    await tapButtonLabelled("Clear playlist");
    await sleep(4000);
  }
  await waitFor(`document.querySelectorAll('[data-testid="playlist-item"]').length === 0`, {
    label: "the playlist to empty",
  });
  await waitForTestId("add-items-to-playlist");
  await tapTestId("add-items-to-playlist");
  /*
   * With nothing queued the sheet opens on the source chooser rather than on the last folder, so
   * the stage picks the Ultimate before it can browse. With a remembered source it never appears.
   */
  await waitFor(
    `Boolean(document.querySelector('[data-testid="add-items-scroll"]')) ||
     [...document.querySelectorAll("button")].some((button) => button.innerText.trim() === ${JSON.stringify(SOURCE)})`,
    { label: "the add-items sheet" },
  );
  if (!(await evaluate(`Boolean(document.querySelector('[data-testid="add-items-scroll"]'))`))) {
    await tapButtonLabelled(SOURCE);
  }
  await waitForTestId("add-items-scroll");
  await setFieldValue("add-items-filter", "");
  await waitForTestId("navigate-root");
  await tapTestId("navigate-root");
  await sleep(2500);
  for (const segment of [USB, FOLDER]) {
    const rowFor = `[...document.querySelectorAll('[data-testid="source-entry-row"]')]
      .find((element) => element.innerText.trim().split("\\n")[0] === ${JSON.stringify(segment)})`;
    await waitFor(rowFor, { label: `the ${segment} row` });
    await tapFrom(`(()=>{ const row = ${rowFor}; return row && row.querySelector('button[aria-label^="Open"]'); })()`);
    await waitFor(
      `document.querySelector('[data-testid="source-path-label"]')?.innerText.endsWith(${JSON.stringify(segment)})`,
      { label: `the picker to reach ${segment}` },
    );
  }
  const path = await evaluate(`document.querySelector('[data-testid="source-path-label"]')?.innerText ?? ""`);
  if (!path.endsWith(FOLDER)) throw new Error(`the picker is at ${path}, not the probe folder`);

  for (const name of PROBE_LAUNCHABLES) {
    const rowFor = `[...document.querySelectorAll('[data-testid="source-entry-row"]')]
      .find((element) => element.innerText.trim().split("\\n")[0] === ${JSON.stringify(name)})`;
    await waitFor(rowFor, { label: `the ${name} row` });
    await tapFrom(`(()=>{ const row = ${rowFor}; return row && row.querySelector('button[role="checkbox"]'); })()`);
  }
  const selected = await evaluate(
    `document.querySelector('[data-testid="add-items-selection-count"]')?.innerText ?? ""`,
  );
  if (!selected.startsWith("4")) throw new Error(`selected ${selected || "nothing"}, expected 4`);
  await tapTestId("add-items-confirm");
  await sleep(8000);
};

const discovery = async () => {
  await addProbeItems();
  const rows = await playlistPaths();
  const missing = PROBE_LAUNCHABLES.filter((name) => !rows.some((row) => row.includes(probePath(name))));
  if (missing.length) throw new Error(`playlist is missing ${missing.join(", ")}`);
  record("discovery", "pass", `all four probe items were added`);

  for (const name of PROBE_LAUNCHABLES) {
    await openConfigSheet(name);
    await waitFor(`[...document.querySelectorAll('[role="dialog"]')].pop()?.innerText.includes("Playback config")`, {
      label: `the config sheet for ${name}`,
    });
    const state = await configSheetState();
    await tapSheetButton("Close");
    await sleep(1500);
    if (!state) throw new Error(`${name}: the config sheet did not open`);
    if (state.resolved !== "hilprobe.cfg" || state.origin !== "Auto: same name") {
      throw new Error(`${name}: resolved ${state.resolved} by ${state.origin}, expected hilprobe.cfg by same name`);
    }
    record("discovery", "pass", `${name} resolved hilprobe.cfg as "${state.origin}"`);
  }
};

/**
 * A tune's evidence is the app's own clock, not RAM.
 *
 * A program, a cartridge and a disk each leave a signature the machine wrote, so "it started" is
 * read back over REST. A tune leaves nothing: it is rendered either by the device's SID player or
 * on the phone, and neither writes anything into C64 RAM that survives being read. What is asserted
 * instead is that the app's elapsed clock advances and that the page reports nothing while it does.
 */
const launchSong = async () => {
  await openPlayPageWith("hilprobe.sid");
  takeConsoleErrors();
  const elapsed = () => evaluate(`document.querySelector('[data-testid="playback-elapsed"]')?.innerText ?? ""`);
  const track = () => evaluate(`document.querySelector('[data-testid="playback-current-track"]')?.innerText ?? ""`);
  const before = await elapsed();
  await playFromPlaylist("hilprobe.sid");
  await sleep(12_000);
  const after = await elapsed();
  const playing = await track();
  // Both halves matter: a clock that moved while something else was playing proves nothing.
  if (!/hilprobe/i.test(playing)) throw new Error(`hilprobe.sid: the app is playing ${playing || "(nothing)"}`);
  if (after === before) throw new Error(`hilprobe.sid: the elapsed clock stayed at ${before || "(blank)"}`);
  const errors = takeConsoleErrors();
  if (errors.length) throw new Error(`hilprobe.sid started but the page reported ${errors[0]}`);
  record("launch", "pass", `hilprobe.sid played (elapsed ${before || "0:00"} -> ${after})`);
};

const launch = async () => {
  await reboot();
  await launchSong();
  for (const [name, signature] of [
    ["hilprobe.prg", SIGNATURES.prg],
    ["hilprobe.d64", SIGNATURES.disk],
  ]) {
    await clearSignature();
    await openPlayPageWith(name);
    takeConsoleErrors();
    await playFromPlaylist(name);
    const { ms } = await pollUntil(readSignature, signature, `${name}: $C000 reads`);
    const errors = takeConsoleErrors();
    if (errors.length) throw new Error(`${name} started but the page reported ${errors[0]}`);
    record("launch", "pass", `${name} ran on the machine after ${Math.round(ms / 1000)}s, page reported nothing`);
    await reboot();
  }
};

/**
 * The app applies the resolved settings file before every launch — including a cartridge, which the
 * firmware applies nothing for. That difference is the whole point of the app doing it.
 */
/**
 * Start the app over.
 *
 * The app remembers the settings file it last applied and skips re-applying the same one, which is
 * what keeps a playlist of twenty tunes sharing one `.cfg` from walking the device's menu twenty
 * times. That memory lasts a session, so a stage that puts the config item back by hand between two
 * items has to end the session too, or the second item is correctly skipped and the stage reads the
 * skip as a failure to apply.
 */
const relaunchApp = async () => {
  await shell(`am force-stop ${PACKAGE}`);
  await sleep(2000);
  await shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`);
  await sleep(6000);
  await attach();
};

/**
 * Put an item's settings choice back to what discovery found.
 *
 * A choice made in the config sheet is stored with the playlist, so `config-decline` leaves its
 * program declined for every run after it. Re-discover is the app's own way back, and using it
 * means a stage never depends on the order the stages happened to run in.
 */
const restoreDiscoveredConfig = async (fileName) => {
  await openConfigSheet(fileName);
  await waitFor(`[...document.querySelectorAll('[role="dialog"]')].pop()?.innerText.includes("Playback config")`, {
    label: `the config sheet for ${fileName}`,
  });
  const before = await configSheetState();
  if (before?.origin !== "Auto: same name") {
    await tapSheetButton("Re-discover");
    await sleep(4000);
  }
  const after = await configSheetState();
  await tapSheetButton("Close");
  await sleep(1500);
  if (after?.origin !== "Auto: same name") {
    throw new Error(`${fileName}: the settings file is ${after?.origin ?? "unreadable"}, not auto-resolved`);
  }
};

const configApply = async () => {
  for (const name of ["hilprobe.prg"]) {
    await reboot();
    await relaunchApp();
    await openPlayPageWith(name);
    await restoreDiscoveredConfig(name);
    await writeConfigItem(PROBE_BASELINE);
    await openPlayPageWith(name);
    await playFromPlaylist(name);
    await pollUntil(readConfigItem, PROBE_APPLIED, `${name}: ${PROBE_ITEM} is`);
    record("config-apply", "pass", `${name} applied hilprobe.cfg (${PROBE_ITEM} -> ${PROBE_APPLIED})`);
  }
  await reboot();
  await writeConfigItem(PROBE_RESTORE);
};

/**
 * Declining the settings file has to mean it is not applied.
 *
 * For a program that is not the app's decision alone: naming the path makes the firmware load the
 * file after the app has finished, so the app has to reach the machine another way for the user's
 * choice to survive. This is the stage that fails when it does not.
 */
const configDecline = async () => {
  await openPlayPageWith("hilprobe.prg");
  await openConfigSheet("hilprobe.prg");
  await waitFor(`[...document.querySelectorAll('[role="dialog"]')].pop()?.innerText.includes("Playback config")`, {
    label: "the config sheet",
  });
  await tapSheetButton("No config");
  await sleep(2000);
  const state = await configSheetState();
  await tapSheetButton("Close");
  await sleep(1500);
  if (state?.origin !== "No config") throw new Error(`the sheet reports origin ${state?.origin}, expected No config`);

  await reboot();
  await writeConfigItem(PROBE_BASELINE);
  await clearSignature();
  await openPlayPageWith("hilprobe.prg");
  await playFromPlaylist("hilprobe.prg");
  await pollUntil(readSignature, SIGNATURES.prg, "the program did not run: $C000 reads");
  // Give a settings file that should NOT have been applied the same chance to show up as one that
  // should: the Telnet workflow is slow, and reading too early would pass without measuring it.
  await sleep(20_000);
  const item = await readConfigItem();
  if (item !== PROBE_BASELINE) {
    throw new Error(
      `a declined settings file was applied anyway: ${PROBE_ITEM} is ${item}, expected ${PROBE_BASELINE}`,
    );
  }
  record("config-decline", "pass", `the program ran and ${PROBE_ITEM} stayed ${item}`);
  // Leave the item as discovery found it, so the next run does not start from this stage's choice.
  await restoreDiscoveredConfig("hilprobe.prg");
  await reboot();
  await writeConfigItem(PROBE_RESTORE);
};

/**
 * Everything that starts a cartridge, in the order the machine allows.
 *
 * Last of all, because on some devices a cartridge started this way holds the machine until it is
 * power-cycled. Three checks in one place: what the firmware does with a settings file beside a
 * cartridge (nothing), that the app can start one at all, and that the app applies the settings
 * file the firmware would not.
 */
const cartridge = async () => {
  await reboot();
  const parity = await restRunAndRead("run_crt", probePath("hilprobe.crt"));
  if (parity.signature !== SIGNATURES.crt) throw new Error(`run_crt left ${parity.signature} at $C000`);
  if (parity.item !== PROBE_BASELINE) {
    throw new Error(`firmware now applies a settings file on run_crt: ${PROBE_ITEM} is ${parity.item}`);
  }
  record("cartridge", "pass", "run_crt applies nothing, so the app is the only actor there");

  await clearSignature();
  await writeConfigItem(PROBE_BASELINE);
  await relaunchApp();
  await openPlayPageWith("hilprobe.crt");
  await restoreDiscoveredConfig("hilprobe.crt");
  takeConsoleErrors();
  await playFromPlaylist("hilprobe.crt");
  const { ms } = await pollUntil(readSignature, SIGNATURES.crt, "hilprobe.crt: $C000 reads");
  const errors = takeConsoleErrors();
  if (errors.length) throw new Error(`hilprobe.crt started but the page reported ${errors[0]}`);
  record("cartridge", "pass", `hilprobe.crt ran on the machine after ${Math.round(ms / 1000)}s`);

  await pollUntil(readConfigItem, PROBE_APPLIED, `hilprobe.crt: ${PROBE_ITEM} is`);
  record("cartridge", "pass", `hilprobe.crt applied hilprobe.cfg (${PROBE_ITEM} -> ${PROBE_APPLIED})`);
  await writeConfigItem(PROBE_RESTORE);
};

/* ---------------------------------------------------------------- main ---- */

const verdict = () => {
  const failed = results.filter((entry) => entry.status === "fail");
  const pending = results.filter((entry) => entry.status === "pending");
  if (failed.length) return { code: 1, line: `${failed.length} stage check(s) failed` };
  if (!results.length) return { code: 2, line: "nothing ran" };
  if (pending.length) return { code: 0, line: `${results.length} checks, ${pending.length} pending` };
  return { code: 0, line: `${results.length} checks passed` };
};

const main = async () => {
  console.log(`launch matrix: ${HOST} (/${USB}/${FOLDER}) on ${SERIAL || "<no serial>"}`);
  await stage("preflight", preflight);
  await stage("firmware-parity", firmwareParity);
  await stage("discovery", discovery);
  await stage("launch", launch);
  await stage("config-decline", configDecline);
  await stage("config-apply", configApply);
  await stage("cartridge", cartridge);

  const { code, line } = verdict();
  console.log(`\n${line}`);
  if (JSON_PATH) {
    const target = resolve(JSON_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ host: HOST, usb: USB, folder: FOLDER, results }, null, 2));
    console.log(`wrote ${target}`);
  }
  await adb("forward", "--remove-all").catch(() => undefined);
  process.exit(code);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
