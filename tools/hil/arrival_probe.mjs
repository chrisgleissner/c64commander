#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How long it takes someone who has just come home to reach the machine, measured over many
 * arrivals.
 *
 * The user this answers for holds the Callback 8020: a keypad, no touchscreen, 320 x 426.7 CSS px.
 * They leave, the phone drops off the Wi-Fi and sleeps in a pocket, they come back, and they want
 * one control. The two numbers that decide whether the app is usable for them are how many key
 * presses that control costs from the moment the app is on screen, and how many seconds pass
 * before the press provably lands on the C64.
 *
 * "Provably" is the point. The health badge is not evidence: it has read healthy while the app
 * could not reach anything. Every arrival here is closed by reading the Ultimate's own memory over
 * REST from this host, on a path the app is not on. Before each arrival a sentinel byte is written
 * into screen RAM; the arrival ends when the Ultimate's memory shows the effect of the key press,
 * and that instant is the measurement.
 *
 * Usage:
 *   node tools/hil/arrival_probe.mjs --serial <adb serial> --host c64u \
 *     [--package uk.gleissner.c64uremote] [--control reset] [--iterations 10] \
 *     [--away-ms 600000] [--settle-ms 5000] [--json artifacts/arrival.json]
 *
 * `--away-ms 600000` is the ten minutes the scenario asks for. Shorter values measure a warm
 * arrival and are reported as such, so a run cannot be mistaken for a cold one.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHilCdp, sleep } from "./hil_cdp.mjs";
import { percentile } from "./percentile.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const SERIAL = arg("serial", "9B081FFAZ001WX");
const PACKAGE = arg("package", "uk.gleissner.c64uremote");
const HOST = arg("host", "c64u");
const PORT = Number(arg("port", "9333"));
const ITERATIONS = Number(arg("iterations", "10"));
const AWAY_MS = Number(arg("away-ms", "600000"));
const SETTLE_MS = Number(arg("settle-ms", "5000"));
const PRESS_GAP_MS = Number(arg("press-gap-ms", "400"));
const REACH_TIMEOUT_MS = Number(arg("reach-timeout-ms", "30000"));
const JSON_OUT = arg("json", "");

/** Android key codes. These are the ones the Callback's keypad produces. */
const KEY = { UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22, CENTER: 23, BACK: 4, HOME_ROUTE: 8, PLAY_ROUTE: 9 };

/**
 * The shortest keypad path to each control, from the app appearing with focus at the document body.
 *
 * Every path is the one a user would actually find: the focus ring's own order, taking the
 * shorter of clockwise and anticlockwise. They are checked by `verify` after the presses land, so
 * a path that stops being the shortest fails here rather than quietly measuring something else.
 */
const CONTROLS = {
  reset: {
    label: "Reset the machine",
    keys: [KEY.DOWN, KEY.DOWN, KEY.DOWN, KEY.CENTER, KEY.LEFT, KEY.LEFT, KEY.CENTER],
    /** Screen RAM stops being the sentinel the moment the machine restarts. */
    prepare: async (rest) => rest.writeMem(0x0400, "aaaaaaaaaaaaaaaa"),
    reached: async (rest) => {
      const bytes = await rest.readMem(0x0400, 8);
      return bytes !== null && !bytes.every((byte) => byte === 0xaa);
    },
  },
};

const adbArgs = ["-s", SERIAL];

const restFor = (host) => {
  const base = `http://${host}/v1`;
  const call = async (path, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      return await fetch(`${base}${path}`, { ...init, signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    call,
    writeMem: (address, hex) =>
      call(`/machine:writemem?address=${address.toString(16).padStart(4, "0")}&data=${hex}`, { method: "PUT" }),
    readMem: async (address, length) => {
      const response = await call(`/machine:readmem?address=${address.toString(16).padStart(4, "0")}&length=${length}`);
      if (!response?.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
    answers: async () => Boolean((await call("/version"))?.ok),
  };
};

/**
 * The instant the page became visible, stamped by the page itself.
 *
 * Read from the host instead, the number would carry the poll interval and the CDP round trip.
 * The recorder is reinstalled every arrival, because a WebView that was killed while the phone
 * slept comes back without it; when it is gone the arrival is stamped from the host and says so,
 * rather than being dropped or silently mixed in with the page-stamped ones.
 */
const RECORDER = `(() => {
  const w = window;
  if (w.__arrivalRecorder) { w.__arrival = { shown: [], badge: [] }; return "reset"; }
  w.__arrivalRecorder = true;
  w.__arrival = { shown: [], badge: [] };
  const badge = () => document.querySelector("[data-testid=unified-health-badge]")?.getAttribute("aria-label") ?? null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    w.__arrival.shown.push(Date.now());
    const started = Date.now();
    const timer = setInterval(() => {
      const label = badge();
      const last = w.__arrival.badge[w.__arrival.badge.length - 1];
      if (!last || last[1] !== label) w.__arrival.badge.push([Date.now(), label]);
      if (Date.now() - started > 40000) clearInterval(timer);
    }, 150);
  });
  return "installed";
})()`;

const main = async () => {
  const cdp = createHilCdp({ serial: SERIAL, packageName: PACKAGE, port: PORT });
  const rest = restFor(HOST);
  const control = CONTROLS[arg("control", "reset")];
  if (!control) throw new Error(`unknown --control; known: ${Object.keys(CONTROLS).join(", ")}`);

  const shell = (command) => cdp.shell(command);
  const press = async (code) => {
    await shell(`input keyevent ${code}`);
    await sleep(PRESS_GAP_MS);
  };

  if (!(await rest.answers())) throw new Error(`${HOST} does not answer /v1/version from this host`);
  await cdp.attach();

  const arrivals = [];
  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    await cdp.ensureAttached();
    await cdp.evaluate(RECORDER);
    // Left on Home, which is where a user who only ever wants one control leaves it.
    await shell(`input keyevent ${KEY.HOME_ROUTE}`);
    await sleep(800);

    await shell("input keyevent KEYCODE_HOME");
    await sleep(500);
    await shell("input keyevent KEYCODE_SLEEP");
    await shell("svc wifi disable");
    await sleep(AWAY_MS);

    await shell("svc wifi enable");
    await sleep(SETTLE_MS);
    await control.prepare(rest);

    await shell("input keyevent KEYCODE_WAKEUP");
    await sleep(600);
    await shell("wm dismiss-keyguard").catch(() => undefined);
    await sleep(400);
    const startedAtMs = Date.now();
    await shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`);

    let shownAtMs = null;
    let stampedBy = "host";
    for (let waited = 0; waited < 20000 && shownAtMs === null; waited += 250) {
      await sleep(250);
      const state = await cdp.evaluate(`JSON.stringify({shown:window.__arrival?.shown ?? null})`).catch(() => null);
      if (state?.shown?.length) {
        shownAtMs = state.shown[state.shown.length - 1];
        stampedBy = "page";
      } else if (state?.shown) {
        // The recorder survived but the page never went hidden, so the app was never really away.
        shownAtMs = startedAtMs;
      }
    }
    if (shownAtMs === null) {
      await cdp.attach();
      shownAtMs = Date.now();
      stampedBy = "host-after-reattach";
    }

    for (const code of control.keys) await press(code);
    const pressesDoneAtMs = Date.now();

    let reachedAtMs = null;
    while (Date.now() - pressesDoneAtMs < REACH_TIMEOUT_MS && reachedAtMs === null) {
      if (await control.reached(rest)) reachedAtMs = Date.now();
      else await sleep(150);
    }

    const badge = (await cdp.evaluate(`JSON.stringify(window.__arrival?.badge ?? [])`).catch(() => [])) ?? [];
    arrivals.push({
      iteration,
      control: arg("control", "reset"),
      presses: control.keys.length,
      shownAtMs,
      stampedBy,
      reachedAtMs,
      msToReach: reachedAtMs === null ? null : reachedAtMs - shownAtMs,
      badgeTimeline: badge.map(([at, label]) => [at - shownAtMs, label]),
    });
    const last = arrivals[arrivals.length - 1];
    console.log(
      `arrival ${iteration}/${ITERATIONS}: ${last.presses} presses, ` +
        `${last.msToReach === null ? "NEVER REACHED" : `${last.msToReach} ms`} (t0 by ${stampedBy})`,
    );
  }

  const reached = arrivals.filter((a) => a.msToReach !== null).map((a) => a.msToReach);
  const summary = {
    host: HOST,
    package: PACKAGE,
    control: arg("control", "reset"),
    iterations: ITERATIONS,
    awayMs: AWAY_MS,
    cold: AWAY_MS >= 600000,
    presses: control.keys.length,
    reachedCount: reached.length,
    msToReachP50: reached.length ? Math.round(percentile(reached, 0.5)) : null,
    msToReachP95: reached.length ? Math.round(percentile(reached, 0.95)) : null,
    arrivals,
  };
  console.log(
    `\n${summary.cold ? "cold" : "warm"} arrivals: reached ${reached.length}/${ITERATIONS}, ` +
      `p50 ${summary.msToReachP50} ms, p95 ${summary.msToReachP95} ms, ${summary.presses} presses each`,
  );
  if (JSON_OUT) {
    mkdirSync(dirname(JSON_OUT), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));
    console.log(`wrote ${JSON_OUT}`);
  }
  cdp.close();
  if (!flag("no-fail") && reached.length < ITERATIONS) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(2);
});
