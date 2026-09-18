#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What a release candidate has to survive on a phone somebody actually carries around.
 *
 * The merge gate (`tools/hil/merge_gate.mjs`) measures the things that need a stimulus and a
 * microphone: a held joystick direction, a tone ladder, the latency of the mirror. It says nothing
 * about the four ordinary events that happen to every user in the first week — the app is killed
 * and reopened, the Wi-Fi goes away and comes back, the screen locks with a tune playing, and a
 * device that is not an Ultimate 64 is connected. Each of those has produced a defect that CI could
 * not see, and the last of them produced one on this very run: Game Mode on an Ultimate II+L asked
 * a cartridge to start `/v1/streams`, took two 404s, and reported a healthy device as unhealthy.
 *
 * Every stage here is silent. Nothing plays through the speaker, so this can run beside someone.
 *
 *   node tools/hil/release_sweep_hil.mjs --serial <adb serial>
 *   node tools/hil/release_sweep_hil.mjs --serial <adb serial> --only restart-soak
 *   node tools/hil/release_sweep_hil.mjs --serial <adb serial> --json artifacts/release-sweep.json
 *
 * Stages:
 *   preflight      the phone is attached and awake, the app is installed, Wi-Fi is up, and every
 *                  host named by `--hosts` answers `/v1/info` from this machine.
 *   error-census   every main route, on the device currently selected: no alert on screen and no
 *                  new error in the in-app log. Run it once per device to cover the fleet.
 *   restart-soak   force-stop and relaunch N times: the app comes back to a route, reconnects to
 *                  the same device, and logs no error doing it.
 *   network-drop   Wi-Fi off and on N times: the badge says offline and then healthy again inside
 *                  the recovery budget, nothing raises an alert, and a local tune keeps playing
 *                  throughout — it is rendered on the phone and owes the network nothing.
 *   screen-off     the screen sleeps with a tune playing and the tune is still playing two minutes
 *                  later. Chromium suspends timers and workers in a hidden page, so this is the
 *                  one that catches a regression in the foreground service or the native sink.
 *
 * `network-drop` and `screen-off` need a tune queued on the Play page; both start it themselves and
 * report `pending` rather than a pass when the playlist is empty, because a stage that measured
 * nothing must never read as a stage that passed.
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
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const SERIAL = arg("serial", process.env.ANDROID_SERIAL ?? "");
const PACKAGE = arg("package", "uk.gleissner.c64commander");
const CDP_PORT = Number(arg("cdp-port", "9333"));
const HOSTS = arg("hosts", "c64u,u64,u2")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const RESTART_CYCLES = Number(arg("restart-cycles", "6"));
const NETWORK_CYCLES = Number(arg("network-cycles", "3"));
const SCREEN_OFF_SECONDS = Number(arg("screen-off-seconds", "125"));
const JSON_PATH = arg("json", "");
const ONLY = (arg("only", "") || "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

/**
 * How long the app may take to report itself healthy again after the Wi-Fi returns.
 *
 * Generous on purpose: the failure this guards against is the stale-connection wedge, where the app
 * stays offline for minutes after the radio is back because a pooled socket is reused. A few
 * seconds either way is DHCP and association, not a defect.
 */
const RECOVERY_BUDGET_MS = 30_000;

/** How long a relaunched app may take to put a route on screen before that counts as a hang. */
const RELAUNCH_BUDGET_MS = 20_000;

export const STAGE_NAMES = ["preflight", "error-census", "layout", "restart-soak", "network-drop", "screen-off"];

/**
 * The CSS widths the app is drawn at, narrowest first.
 *
 * 320 is the narrowest screen the app supports and 393 is this phone's own width. They are applied
 * through CDP's device-metrics override rather than `adb shell wm size`, which stays in force until
 * something resets it and then makes every touch land where the control is not — a leftover
 * override has cost two merge-gate runs.
 */
const LAYOUT_WIDTHS = [320, 360, 393];

/** Routes a user reaches from the tab bar. Every one is visited by `error-census`. */
const MAIN_ROUTES = ["/", "/play", "/disks", "/config", "/settings"];

/*
 * `attach` forces the forward and the socket to be rebuilt; `ensureAttached` only connects when
 * there is nothing live. A relaunch needs the forced one: the replaced WebView leaves a socket that
 * still reads as open and answers nothing.
 */
const { adb, shell, attach, evaluate, takeConsoleErrors, foreignFocusedWindow } = createHilCdp({
  serial: SERIAL,
  packageName: PACKAGE,
  port: CDP_PORT,
});

/* -------------------------------------------------------------- reads ---- */

/**
 * One read of everything a stage judges, taken in the page in one go.
 *
 * `errorsSince` counts entries in the app's own log, which is the authoritative record: the REST
 * calls go through native CapacitorHttp, so they never appear in CDP's Network domain and a release
 * build logs nothing about them to logcat.
 */
const STATE = (sinceMs) => `(()=>{
  const q = (id) => document.querySelector('[data-testid="' + id + '"]');
  const badge = q("unified-health-badge");
  let errors = [];
  try {
    const log = JSON.parse(localStorage.getItem("c64u_app_logs") || "[]");
    errors = log
      .filter((e) => /error/i.test(e.level || "") && new Date(e.timestamp || e.ts).getTime() > ${sinceMs})
      .map((e) => String(e.message || "").slice(0, 160));
  } catch { errors = ["<app log unreadable>"]; }
  return JSON.stringify({
    route: location.pathname,
    hidden: document.hidden,
    badge: badge ? badge.getAttribute("aria-label") : null,
    elapsed: q("playback-elapsed") ? q("playback-elapsed").innerText : null,
    counters: q("playback-counters") ? q("playback-counters").innerText.replace(/\s+/g, " ") : null,
    resumeLabel: q("playlist-pause") ? q("playlist-pause").getAttribute("aria-label") : null,
    playLabel: q("playlist-play") ? q("playlist-play").getAttribute("aria-label") : null,
    alerts: [...document.querySelectorAll('[role="alert"]')]
      .map((e) => e.innerText.replace(/\\s+/g, " ").trim())
      .filter(Boolean),
    toasts: [...document.querySelectorAll("[data-sonner-toast]")]
      .map((e) => e.innerText.replace(/\\s+/g, " ").trim())
      .filter(Boolean),
    errors,
  });
})()`;

const readState = (sinceMs) => evaluate(STATE(sinceMs));

/** The device clock, because the in-app log is stamped with it and it is hours from the host's. */
const deviceNowMs = async () => Number((await shell("date +%s%3N")).trim());

const goto = async (route) => {
  await evaluate(
    `(()=>{history.pushState({}, "", ${JSON.stringify(route)});
      window.dispatchEvent(new PopStateEvent("popstate")); return "ok";})()`,
  );
  await sleep(2500);
};

/* ------------------------------------------------------------- stages ---- */

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

const preflight = async () => {
  if (!SERIAL) throw new Error("--serial <serial> (or ANDROID_SERIAL) is required; refusing to pick a device");
  const devices = await execFileAsync("adb", ["devices"]);
  if (!devices.stdout.includes(`${SERIAL}\tdevice`)) throw new Error(`${SERIAL} is not attached and in state device`);

  // A locked phone suspends the page's timers, so every later stage would misread the lock as the
  // app hanging. The screen is woken and the keyguard dismissed once, here, for the whole run.
  await shell("input keyevent KEYCODE_WAKEUP");
  await shell("wm dismiss-keyguard");

  const size = (await shell("wm size")).trim();
  if (size.includes("Override")) {
    throw new Error(`a leftover 'wm size' override is in force (${size}); run 'adb shell wm size reset' first`);
  }

  if ((await shell("settings get global airplane_mode_on")).trim() === "1") {
    throw new Error("the phone is in flight mode; this sweep needs the radios on");
  }

  const unreachable = [];
  for (const host of HOSTS) {
    try {
      const response = await fetch(`http://${host}/v1/info`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) unreachable.push(`${host} answered HTTP ${response.status}`);
    } catch {
      unreachable.push(`${host} did not answer`);
    }
  }
  if (unreachable.length) throw new Error(`from this machine: ${unreachable.join("; ")}`);

  const foreign = await foreignFocusedWindow();
  if (foreign) throw new Error(`another window has focus: ${foreign}. Dismiss it before measuring anything.`);

  await attach();
  const state = await readState(await deviceNowMs());
  record("preflight", "pass", `${HOSTS.join(", ")} answering; app on ${state.route}; badge: ${state.badge}`);
};

/**
 * Walk the main routes and insist the app has nothing to complain about.
 *
 * The rule this enforces is the release criterion in plain words: an error is shown only when
 * something is genuinely wrong with the device. On a healthy device connected over a healthy
 * network there is nothing genuinely wrong, so there must be no alert and no error in the log.
 */
/**
 * Surfaces that open over a route and have their own data, their own requests and their own way of
 * going wrong. Each is a testid that opens one, and the route it is reached from.
 *
 * Openers only. Nothing here resets, powers off, deletes, clears or writes: a census must be able to
 * run on somebody's device without changing what is on it. That rule is easy to break by accident —
 * `settings-device-row-<id>` looks like it opens an editor and in fact SELECTS that device, so a
 * census of the cartridge silently continued against the C64 Ultimate from the moment it ran.
 */
const OVERLAYS = [
  { route: "/", open: "unified-health-badge", name: "Diagnostics" },
  { route: "/", open: "app-bar-quick-menu", name: "Quick menu" },
  { route: "/", open: "home-machine-inline-openRemoteInput", name: "Remote Input" },
  { route: "/play", open: "add-items-to-playlist", name: "Add items" },
  { route: "/play", open: "play-open-controller", name: "Play controller" },
  { route: "/play", open: "hvsc-search-open", name: "Find a tune" },
];

const closeOverlay = async () => {
  await evaluate(
    `(()=>{const close=[...document.querySelectorAll('[role="dialog"] button')]
      .find((b)=>/^(×|Close|Cancel)$/i.test((b.innerText||"").trim()) || /close/i.test(b.getAttribute("aria-label")||""));
      if(close){close.click();return "closed";} return "none";})()`,
  ).catch(() => undefined);
  await sleep(1200);
  await shell("input keyevent KEYCODE_BACK");
  await sleep(1200);
};

const errorCensus = async () => {
  const since = await deviceNowMs();
  const visited = [];
  const problems = [];
  takeConsoleErrors();

  const inspect = async (where) => {
    const foreign = await foreignFocusedWindow();
    if (foreign) problems.push(`${where}: ${foreign} had focus, so the app was not what the user was looking at`);
    const state = await readState(since);
    const fromConsole = takeConsoleErrors();
    visited.push({
      where,
      route: state.route,
      badge: state.badge,
      alerts: state.alerts,
      errors: state.errors.length,
      console: fromConsole.length,
    });
    if (state.alerts.length) problems.push(`${where}: alert "${state.alerts[0]}"`);
    if (state.errors.length)
      problems.push(`${where}: ${state.errors.length} logged error(s), first "${state.errors[0]}"`);
    if (fromConsole.length)
      problems.push(`${where}: ${fromConsole.length} console error(s), first "${fromConsole[0]}"`);
    if (state.badge && /unhealthy|degraded/i.test(state.badge)) problems.push(`${where}: badge "${state.badge}"`);
  };

  for (const route of MAIN_ROUTES) {
    await goto(route);
    await inspect(route);
  }

  for (const overlay of OVERLAYS) {
    await goto(overlay.route);
    const opened = await evaluate(
      `(()=>{const e=document.querySelector('[data-testid="${overlay.open}"]');
        if(!e) return "missing"; if(e.disabled) return "disabled"; e.click(); return "clicked";})()`,
    );
    if (opened !== "clicked") {
      visited.push({ where: overlay.name, route: overlay.route, skipped: opened });
      continue;
    }
    await sleep(4000);
    await inspect(overlay.name);
    await closeOverlay();
  }

  await goto("/");
  if (problems.length) {
    record("error-census", "fail", problems.join(" | "), { visited });
    return;
  }
  record(
    "error-census",
    "pass",
    `${MAIN_ROUTES.length} routes and ${OVERLAYS.length} overlays: no alert, no logged error, no console error`,
    { visited },
  );
};

/**
 * What the page draws outside itself, or draws and then cuts.
 *
 * The swipe layer is excluded by name, not by guessing: it lays the neighbouring routes out in a
 * strip that is deliberately three viewports wide, so it is outside the viewport by construction and
 * says nothing about the page the user is on.
 */
const LAYOUT_SWEEP = `(() => {
  const SWIPE = ["swipe-navigation-runway", "swipe-navigation-container", "swipe-slot-home",
    "swipe-slot-play", "swipe-slot-disks", "swipe-slot-config", "swipe-slot-settings", "swipe-slot-docs"];
  const inSwipe = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const id = node.getAttribute && node.getAttribute("data-testid");
      if (id && SWIPE.indexOf(id) >= 0) return true;
    }
    return false;
  };
  const name = (el) => el.getAttribute("data-testid")
    || (el.closest("[data-testid]") && el.closest("[data-testid]").getAttribute("data-testid"))
    || el.tagName.toLowerCase();
  /*
   * The viewport is documentElement.clientWidth, never window.innerWidth. This WebView WIDENS the
   * visual viewport to contain content that sticks out, so innerWidth grows to match the overflow
   * and a comparison against it can never fire — the check would pass on a page the user has to
   * scroll sideways. Measured here: an injected 900px box left clientWidth at 392 and took
   * innerWidth to 900.
   */
  const viewport = document.documentElement.clientWidth;
  const overflow = [];
  const clipped = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (inSwipe(el)) continue;
    const id = name(el);
    if (rect.right > viewport + 1 || rect.left < -1) {
      if (!seen.has("o:" + id)) {
        seen.add("o:" + id);
        overflow.push({ id, left: Math.round(rect.left), right: Math.round(rect.right) });
      }
    }
    // Horizontal clipping only. A vertically scrollable box is the normal way to hold a long list.
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "auto"
        && getComputedStyle(el).overflowX !== "scroll" && (el.innerText || "").trim()) {
      if (!seen.has("c:" + id)) {
        seen.add("c:" + id);
        clipped.push({ id, needs: el.scrollWidth, has: el.clientWidth, text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 40) });
      }
    }
  }
  return JSON.stringify({
    width: viewport,
    // What the user would feel: a page that scrolls sideways at all.
    scrollsSideways: document.documentElement.scrollWidth > viewport + 1,
    overflow,
    clipped,
  });
})()`;

const layout = async () => {
  const findings = [];
  const inspected = [];
  try {
    for (const width of LAYOUT_WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 800,
        deviceScaleFactor: 0,
        mobile: true,
      });
      await sleep(1200);
      for (const route of MAIN_ROUTES) {
        await goto(route);
        const sweep = await evaluate(LAYOUT_SWEEP);
        inspected.push({
          width,
          route,
          overflow: sweep.overflow.length,
          clipped: sweep.clipped.length,
          scrollsSideways: sweep.scrollsSideways,
        });
        if (sweep.scrollsSideways) findings.push(`${width}px ${route}: the page scrolls sideways`);
        sweep.overflow.forEach((item) => findings.push(`${width}px ${route}: ${item.id} runs to ${item.right}px`));
        sweep.clipped.forEach((item) =>
          findings.push(
            `${width}px ${route}: ${item.id} cuts "${item.text}" (needs ${item.needs}px, has ${item.has}px)`,
          ),
        );
      }
    }
  } finally {
    await send("Emulation.clearDeviceMetricsOverride", {}).catch(() => undefined);
    await goto("/");
  }
  if (findings.length) {
    record("layout", "fail", findings.slice(0, 8).join(" | "), { findings, inspected });
    return;
  }
  record(
    "layout",
    "pass",
    `${LAYOUT_WIDTHS.length} widths x ${MAIN_ROUTES.length} routes, nothing outside the page and nothing cut`,
    {
      inspected,
    },
  );
};

const relaunch = async () => {
  await shell(`am force-stop ${PACKAGE}`);
  await sleep(1200);
  await shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`);
  const deadline = Date.now() + RELAUNCH_BUDGET_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    await sleep(1500);
    try {
      await attach();
      const state = await readState(Date.now());
      if (state.route) return { route: state.route, ms: RELAUNCH_BUDGET_MS - (deadline - Date.now()) };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `the app did not render a route within ${RELAUNCH_BUDGET_MS} ms: ${lastError?.message ?? "no route"}`,
  );
};

const restartSoak = async () => {
  const cycles = [];
  const problems = [];
  for (let cycle = 1; cycle <= RESTART_CYCLES; cycle += 1) {
    const since = await deviceNowMs();
    const launched = await relaunch();
    // The badge settles behind a probe, so the state is read after the first health check would
    // have answered rather than at the instant the route appears.
    await sleep(6000);
    const state = await readState(since);
    cycles.push({ cycle, route: launched.route, badge: state.badge, errors: state.errors, alerts: state.alerts });
    if (state.alerts.length) problems.push(`cycle ${cycle}: alert "${state.alerts[0]}"`);
    if (state.errors.length) problems.push(`cycle ${cycle}: error "${state.errors[0]}"`);
    if (!state.badge || !/healthy/i.test(state.badge)) problems.push(`cycle ${cycle}: badge "${state.badge}"`);
  }
  const crashes = await shell(`logcat -d -b crash -t 200 | grep -c ${PACKAGE} || true`);
  if (Number(crashes.trim()) > 0) problems.push(`${crashes.trim()} crash log line(s) mention ${PACKAGE}`);
  if (problems.length) {
    record("restart-soak", "fail", problems.join(" | "), { cycles });
    return;
  }
  record("restart-soak", "pass", `${RESTART_CYCLES} force-stop/relaunch cycles, each reconnected clean`, { cycles });
};

/** Put a tune on, and say plainly when there is none to put on rather than passing on silence. */
/**
 * Seconds of playlist left to play, read from the Play page's own counters line.
 *
 * A stage that measures for two minutes needs at least two minutes of material. Without this the
 * screen-off stage measured the last twelve seconds of the last track, watched the playlist end
 * correctly, and reported it as the tune having stopped.
 */
const remainingSeconds = (counters) => {
  const match = /Remaining:\s*(\d+):(\d{2})/.exec(counters ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Put the playlist back at its first track, so what follows has the whole of it ahead of it. */
const rewindToFirstTrack = async () => {
  await evaluate(
    `(()=>{const stop=document.querySelector('[data-testid="playlist-play"]');
      if(stop && stop.getAttribute("aria-label")==="Stop") stop.click();
      return "ok";})()`,
  ).catch(() => undefined);
  await sleep(1500);
  // The row's own Play control, found by its accessible name. `playlist-item-actions-<name>` is the
  // overflow menu beside it, not the thing that starts the track.
  const clicked = await evaluate(
    `(()=>{const first=document.querySelector('[data-testid="playlist-item"]');
      if(!first) return "missing";
      const play=[...first.querySelectorAll('button,[role="button"]')]
        .find((b)=>/^Play /.test(b.getAttribute("aria-label")||""));
      if(!play) return "no-play"; play.click(); return "clicked";})()`,
  ).catch(() => "missing");
  await sleep(6000);
  return clicked;
};

const startPlayback = async (options = {}) => {
  const foreign = await foreignFocusedWindow();
  if (foreign) return { started: false, why: `${foreign} has focus; the app cannot be driven underneath it` };
  await goto("/play");
  if (options.needSeconds) {
    const start = await readState(Date.now());
    if ((remainingSeconds(start.counters) ?? 0) < options.needSeconds) {
      const rewound = await rewindToFirstTrack();
      if (rewound !== "clicked") {
        return { started: false, why: `the playlist has under ${options.needSeconds} s left and could not be rewound` };
      }
      const after = await readState(Date.now());
      const total = /Total:\s*(\d+):(\d{2})/.exec(after.counters ?? "");
      const totalSeconds = total ? Number(total[1]) * 60 + Number(total[2]) : 0;
      if (totalSeconds < options.needSeconds) {
        return {
          started: false,
          why: `the whole playlist is ${after.counters}, which is under the ${options.needSeconds} s this stage measures`,
        };
      }
    }
  }
  // Read AFTER any rewind above, never before it: a rewind leaves the session playing, and a
  // stale "stopped" reading here pressed Play on a running session, which stops it.
  const before = await readState(Date.now());
  if (before.elapsed === null) return { started: false, why: "the Play page shows no transport" };
  /*
   * Two controls, and which one starts a tune depends on where the session is.
   *
   * `playlist-play` is the big one: it reads "Play" while the session is stopped and "Stop" while it
   * is not. `playlist-pause` is the small one beside it and reads "Resume" only while the session is
   * paused — on a stopped session it reads "Pause" and is disabled. An earlier version pressed only
   * the small one and skipped it whenever it read "Pause", so after `restart-soak` left a stopped
   * session it pressed nothing at all and the stages after it reported a tune that never started.
   */
  if (before.playLabel === "Play") {
    const clicked = await evaluate(
      `(()=>{const b=document.querySelector('[data-testid="playlist-play"]');
        if(!b || b.disabled) return "missing"; b.click(); return "clicked";})()`,
    );
    if (clicked !== "clicked") return { started: false, why: "the Play control is missing or disabled" };
    await sleep(6000);
  } else if (before.resumeLabel === "Resume") {
    const clicked = await evaluate(
      `(()=>{const b=document.querySelector('[data-testid="playlist-pause"]');
        if(!b || b.disabled) return "missing"; b.click(); return "clicked";})()`,
    );
    if (clicked !== "clicked") return { started: false, why: "the Resume control is missing or disabled" };
    await sleep(3000);
  }
  // Motion, measured, every time: two reads five seconds apart with the clock in a different place.
  const first = await readState(Date.now());
  await sleep(5000);
  const second = await readState(Date.now());
  if (first.elapsed === second.elapsed) {
    return {
      started: false,
      why:
        `the clock sat at ${first.elapsed} for 5 s with the controls reading ` +
        `"${second.playLabel}" and "${second.resumeLabel}" — an empty playlist, or a session that ` +
        `says it is playing and is not`,
    };
  }
  return { started: true };
};

const networkDrop = async () => {
  const playing = await startPlayback({ needSeconds: NETWORK_CYCLES * 60 });
  if (!playing.started) {
    record("network-drop", "pending", `no tune to keep playing: ${playing.why}`);
    return;
  }
  const cycles = [];
  const problems = [];
  for (let cycle = 1; cycle <= NETWORK_CYCLES; cycle += 1) {
    const since = await deviceNowMs();
    const beforeOff = await readState(since);

    await shell("svc wifi disable");
    await sleep(15_000);
    const offline = await readState(since);
    if (!offline.badge || !/offline|not reachable/i.test(offline.badge)) {
      problems.push(`cycle ${cycle}: badge did not report offline ("${offline.badge}")`);
    }
    if (offline.alerts.length) problems.push(`cycle ${cycle}: alert while offline "${offline.alerts[0]}"`);
    if (offline.elapsed === beforeOff.elapsed) {
      // Say what actually stopped it. A window that took focus mid-cycle stops the tune too, and
      // reporting that as "the network took it down" sent a whole run's diagnosis the wrong way.
      const stole = await foreignFocusedWindow();
      problems.push(
        stole
          ? `cycle ${cycle}: ${stole} took focus and the tune stopped with it (${offline.elapsed})`
          : `cycle ${cycle}: the tune stopped when the network went away (${offline.elapsed})`,
      );
    }

    await shell("svc wifi enable");
    const deadline = Date.now() + RECOVERY_BUDGET_MS;
    let recovered = null;
    let last = offline;
    while (Date.now() < deadline) {
      await sleep(2500);
      last = await readState(since);
      if (last.badge && /healthy/i.test(last.badge)) {
        recovered = RECOVERY_BUDGET_MS - (deadline - Date.now());
        break;
      }
    }
    if (recovered === null) {
      problems.push(`cycle ${cycle}: still "${last.badge}" ${RECOVERY_BUDGET_MS} ms after the radio came back`);
    }
    if (last.errors.length) problems.push(`cycle ${cycle}: error "${last.errors[0]}"`);
    cycles.push({ cycle, offlineBadge: offline.badge, recoveredMs: recovered, onlineBadge: last.badge });
  }
  if (problems.length) {
    record("network-drop", "fail", problems.join(" | "), { cycles });
    return;
  }
  const worst = Math.max(...cycles.map((cycle) => cycle.recoveredMs));
  record("network-drop", "pass", `${NETWORK_CYCLES} cycles, slowest recovery ${worst} ms, tune never stopped`, {
    cycles,
  });
};

/**
 * Parse `m:ss` from the transport. Read as a number rather than compared as text, because "10:00"
 * is not greater than "9:59" as a string.
 */
export const elapsedSeconds = (text) => {
  const match = /(\d+):(\d{2})/.exec(text ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * How many seconds of music a sequence of transport readings accounts for.
 *
 * Not the last reading minus the first. The playlist moves on by itself, and when it does the clock
 * goes back to zero — so a run that played for two minutes and changed track near the end reported
 * "advanced -64 s" and failed on correct behaviour. Each step is counted instead: a reading further
 * on than the one before it contributes the difference, and a reading further BACK is a new track,
 * which contributes that reading's own position. A clock that has not moved contributes nothing,
 * which is the one case this stage exists to catch.
 */
export const secondsPlayed = (readings) => {
  const marks = readings.map(elapsedSeconds);
  if (marks.some((mark) => mark === null)) return null;
  let total = 0;
  for (let index = 1; index < marks.length; index += 1) {
    const step = marks[index] - marks[index - 1];
    total += step >= 0 ? step : marks[index];
  }
  return total;
};

const screenOff = async () => {
  // Enough material to cover the window and then some: a playlist that simply ends is the app
  // behaving correctly, and this stage must not be able to mistake that for the music stopping.
  const playing = await startPlayback({ needSeconds: SCREEN_OFF_SECONDS + 30 });
  if (!playing.started) {
    record("screen-off", "pending", `no tune to keep playing: ${playing.why}`);
    return;
  }
  const before = await readState(Date.now());
  if (elapsedSeconds(before.elapsed) === null) {
    record("screen-off", "pending", `could not read the transport clock ("${before.elapsed}")`);
    return;
  }

  // `svc power stayon usb` keeps the screen lit while the phone is on USB, which is how this stage
  // came to pass without ever putting the screen out. It is cleared before the screen is slept.
  await shell("svc power stayon false");
  await shell("input keyevent KEYCODE_SLEEP");
  await sleep(3000);
  const wakefulness = (await shell("dumpsys power | grep -m1 mWakefulness")).trim();
  if (!/Asleep|Dozing/.test(wakefulness)) {
    record("screen-off", "fail", `the screen did not go out (${wakefulness})`);
    return;
  }

  const samples = [];
  const sleptAt = Date.now();
  const endAt = sleptAt + SCREEN_OFF_SECONDS * 1000;
  while (Date.now() < endAt) {
    await sleep(20_000);
    const state = await readState(Date.now());
    samples.push({ atMs: Date.now(), elapsed: state.elapsed, hidden: state.hidden });
  }

  await shell("input keyevent KEYCODE_WAKEUP");
  await shell("wm dismiss-keyguard");
  await sleep(2000);
  const after = await readState(Date.now());

  const wallSeconds = Math.round((Date.now() - sleptAt) / 1000);
  const played = secondsPlayed([before, ...samples, after].map((state) => state.elapsed));
  // Half the wall clock is a deliberately loose floor. Each reading is 20 s apart and the wake-up
  // costs a couple of seconds, so the failure this catches is a tune that stops dead rather than one
  // that is a few seconds out.
  if (played === null || played < wallSeconds / 2) {
    record("screen-off", "fail", `the tune advanced ${played ?? "?"} s while the screen was out for ${wallSeconds} s`, {
      samples,
    });
    return;
  }
  const everHidden = samples.some((sample) => sample.hidden);
  record(
    "screen-off",
    "pass",
    `${played} s of music over ${wallSeconds} s with the screen out (page hidden: ${everHidden})`,
    {
      samples,
    },
  );
};

/* ---------------------------------------------------------------- run ---- */

const verdict = () => {
  const failed = results.filter((result) => result.status === "fail");
  if (failed.length)
    return { code: 1, message: `${failed.length} stage(s) failed: ${failed.map((f) => f.name).join(", ")}` };
  if (!results.some((result) => result.status === "pass")) {
    return { code: 2, message: "no stage passed; this run verifies nothing" };
  }
  return { code: 0, message: `${results.filter((r) => r.status === "pass").length} stage(s) passed` };
};

const main = async () => {
  const unknown = ONLY.filter((name) => !STAGE_NAMES.includes(name));
  if (unknown.length) {
    console.error(`--only names no such stage: ${unknown.join(", ")}\nstages: ${STAGE_NAMES.join(", ")}`);
    process.exit(2);
  }

  console.log(`release sweep — ${SERIAL || "<no serial>"}, hosts ${HOSTS.join(", ")}`);
  await stage("preflight", preflight);
  if (results.some((result) => result.name === "preflight" && result.status === "fail")) {
    console.error("\npreflight failed; nothing after it would mean anything");
    process.exit(2);
  }

  await stage("error-census", errorCensus);
  await stage("layout", layout);
  await stage("restart-soak", restartSoak);
  await stage("network-drop", networkDrop);
  await stage("screen-off", screenOff);

  // Whatever happened, the phone goes back to a state somebody can pick up: radio on, screen awake.
  await shell("svc wifi enable").catch(() => undefined);
  await shell("input keyevent KEYCODE_WAKEUP").catch(() => undefined);

  const final = verdict();
  console.log(`\n${final.message}`);
  if (JSON_PATH) {
    mkdirSync(dirname(JSON_PATH), { recursive: true });
    writeFileSync(JSON_PATH, JSON.stringify({ serial: SERIAL, hosts: HOSTS, results, verdict: final }, null, 2));
    console.log(`wrote ${JSON_PATH}`);
  }
  socket?.close();
  process.exit(final.code);
};

/*
 * Run only when this file is what was started.
 *
 * `secondsPlayed` and `elapsedSeconds` are graded by a unit test off the rig, and importing the
 * module to reach them must not drive a phone. Comparing against `process.argv[1]` is what
 * distinguishes the two; an earlier version looked for a `--import-only` flag, which a test runner
 * never passes, so importing it ran the whole sweep.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
