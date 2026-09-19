#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What it costs someone who has just come home to reach one control: how many key presses, and how
 * many seconds before the press provably lands on the C64.
 *
 * The user this answers for holds the Callback 8020 — a keypad, no touchscreen, 320 x 426.7 CSS px
 * — and uses the app the way someone uses a light switch. They are not exploring it.
 *
 * "Provably" is the point. The health badge is not evidence: it has read healthy while the app
 * could not reach anything. Each attempt is closed by reading the Ultimate's own memory over REST
 * from this host, on a path the app is not on. A sentinel is written into screen RAM first, and
 * the attempt ends when the Ultimate's memory shows the effect of the key press.
 *
 * The path is not hardcoded. The probe walks the ring, pressing Down until the selection is the
 * control it wants, descending with OK into the card that holds it, and counts what it pressed.
 * That way the number is the app's own navigation cost on the day, not a path written down once.
 *
 * Usage:
 *   node tools/hil/arrival_probe.mjs --serial <adb serial> --host c64u --control reset \
 *     [--package uk.gleissner.c64uremote] [--iterations 10] [--away-ms 600000] [--json out.json]
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

const SERIAL = arg("serial", "9B081FFAZ001WX");
const PACKAGE = arg("package", "uk.gleissner.c64uremote");
const HOST = arg("host", "c64u");
const PORT = Number(arg("port", "9333"));
const ITERATIONS = Number(arg("iterations", "10"));
const AWAY_MS = Number(arg("away-ms", "600000"));
const SETTLE_MS = Number(arg("settle-ms", "6000"));
const PRESS_GAP_MS = Number(arg("press-gap-ms", "350"));
const REACH_TIMEOUT_MS = Number(arg("reach-timeout-ms", "20000"));
const CONTROL = arg("control", "reset");
const JSON_OUT = arg("json", "");

/** Android key codes. The Callback's keypad produces exactly these. */
const KEY = { DOWN: 20, CENTER: 23, BACK: 4, DIGIT: (d) => 7 + d };

const SENTINEL = 0xaa;

/**
 * Each control names the route it lives on, the ring stop that activates it, and any stop that has
 * to be confirmed afterwards. `proof` reads the Ultimate rather than the app.
 */
const CONTROLS = {
  reset: {
    label: "Reset the machine",
    routeDigit: 1,
    target: "Reset",
    confirm: "Reset",
    prepare: (rest) => rest.writeMem(0x0400, "aa".repeat(8)),
    proof: async (rest) => {
      const bytes = await rest.readMem(0x0400, 8);
      return bytes !== null && !bytes.every((byte) => byte === SENTINEL);
    },
  },
  pause: {
    label: "Pause the machine",
    routeDigit: 1,
    target: "Pause",
    confirm: null,
    /** A paused CPU stops advancing the KERNAL's jiffy clock; a running one never stands still. */
    prepare: async () => undefined,
    proof: async (rest) => {
      const first = await rest.readMem(0x00a0, 3);
      await sleep(400);
      const second = await rest.readMem(0x00a0, 3);
      if (!first || !second) return false;
      return first.every((byte, index) => byte === second[index]);
    },
  },
};

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
  const hex = (address) => address.toString(16).padStart(4, "0");
  return {
    writeMem: (address, data) => call(`/machine:writemem?address=${hex(address)}&data=${data}`, { method: "PUT" }),
    readMem: async (address, length) => {
      const response = await call(`/machine:readmem?address=${hex(address)}&length=${length}`);
      if (!response?.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
    resume: () => call("/machine:resume", { method: "PUT" }),
    answers: async () => Boolean((await call("/version"))?.ok),
  };
};

const SELECTION = `(() => {
  const el = document.querySelector('[data-key-selected="true"]');
  if (!el) return JSON.stringify({ id: null });
  return JSON.stringify({
    id: el.getAttribute("data-testid") || null,
    text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 40),
    hasChildren: el.querySelectorAll("button,a[href],input,select,textarea,[role=button]").length > 0,
  });
})()`;

const BADGE = `(() => {
  const badge = document.querySelector("[data-testid=unified-health-badge]");
  return JSON.stringify({ label: badge && badge.getAttribute("aria-label") });
})()`;

const main = async () => {
  const control = CONTROLS[CONTROL];
  if (!control) throw new Error(`unknown --control; known: ${Object.keys(CONTROLS).join(", ")}`);
  const cdp = createHilCdp({ serial: SERIAL, packageName: PACKAGE, port: PORT });
  const rest = restFor(HOST);
  if (!(await rest.answers())) throw new Error(`${HOST} does not answer /v1/version from this host`);
  await cdp.attach();

  const press = async (code) => {
    await cdp.shell(`input keyevent ${code}`);
    await sleep(PRESS_GAP_MS);
  };
  const selection = () => cdp.evaluate(SELECTION).catch(() => ({ id: null }));

  /**
   * Walk to a stop whose test id or label matches, descending into a card when the ring passes one.
   * Returns the presses it took, or null when a full lap does not find it.
   */
  const walkTo = async (wanted, budget) => {
    let presses = 0;
    const entered = new Set();
    for (let step = 0; step < budget; step += 1) {
      const current = await selection();
      if (current.id === wanted || current.text === wanted) return presses;
      if (current.hasChildren && current.id && !entered.has(current.id)) {
        entered.add(current.id);
        await press(KEY.CENTER);
        presses += 1;
        continue;
      }
      await press(KEY.DOWN);
      presses += 1;
    }
    return null;
  };

  const attempts = [];
  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    await cdp.ensureAttached();
    await cdp.shell("input keyevent KEYCODE_HOME");
    await sleep(500);
    await cdp.shell("input keyevent KEYCODE_SLEEP");
    await cdp.shell("svc wifi disable");
    await sleep(AWAY_MS);
    await cdp.shell("svc wifi enable");
    await sleep(SETTLE_MS);
    await control.prepare(rest);

    await cdp.shell("input keyevent KEYCODE_WAKEUP");
    await sleep(600);
    await cdp.shell("wm dismiss-keyguard").catch(() => undefined);
    await sleep(400);
    const shownAtMs = Date.now();
    await cdp.shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`);
    await sleep(1500);
    await cdp.ensureAttached();
    const badgeAtArrival = (await cdp.evaluate(BADGE).catch(() => ({ label: null }))).label;

    let presses = 0;
    if (control.routeDigit) {
      await press(KEY.DIGIT(control.routeDigit));
      presses += 1;
    }
    const toTarget = await walkTo(control.target, 60);
    let reachedAtMs = null;
    if (toTarget !== null) {
      presses += toTarget;
      await press(KEY.CENTER);
      presses += 1;
      if (control.confirm) {
        const toConfirm = await walkTo(control.confirm, 20);
        if (toConfirm !== null) {
          presses += toConfirm;
          await press(KEY.CENTER);
          presses += 1;
        }
      }
      const startedAtMs = Date.now();
      while (Date.now() - startedAtMs < REACH_TIMEOUT_MS && reachedAtMs === null) {
        if (await control.proof(rest)) reachedAtMs = Date.now();
        else await sleep(200);
      }
    }
    if (CONTROL === "pause") await rest.resume();

    attempts.push({
      iteration,
      control: CONTROL,
      label: control.label,
      badgeAtArrival,
      presses: toTarget === null ? null : presses,
      msToReach: reachedAtMs === null ? null : reachedAtMs - shownAtMs,
    });
    const last = attempts[attempts.length - 1];
    console.log(
      `arrival ${iteration}/${ITERATIONS}: ${last.presses ?? "not found"} presses, ` +
        `${last.msToReach === null ? "NEVER REACHED" : `${last.msToReach} ms`}, badge "${badgeAtArrival}"`,
    );
  }

  const reached = attempts.filter((a) => a.msToReach !== null).map((a) => a.msToReach);
  const pressCounts = attempts.filter((a) => a.presses !== null).map((a) => a.presses);
  const summary = {
    host: HOST,
    package: PACKAGE,
    control: CONTROL,
    iterations: ITERATIONS,
    awayMs: AWAY_MS,
    cold: AWAY_MS >= 600000,
    reachedCount: reached.length,
    pressesP50: pressCounts.length ? percentile(pressCounts, 0.5) : null,
    pressesP95: pressCounts.length ? percentile(pressCounts, 0.95) : null,
    msToReachP50: reached.length ? Math.round(percentile(reached, 0.5)) : null,
    msToReachP95: reached.length ? Math.round(percentile(reached, 0.95)) : null,
    attempts,
  };
  console.log(
    `\n${summary.cold ? "cold" : "warm"} arrivals, ${control.label}: reached ${reached.length}/${ITERATIONS}, ` +
      `presses p50 ${summary.pressesP50} p95 ${summary.pressesP95}, ` +
      `ms p50 ${summary.msToReachP50} p95 ${summary.msToReachP95}`,
  );
  if (JSON_OUT) {
    mkdirSync(dirname(JSON_OUT), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));
    console.log(`wrote ${JSON_OUT}`);
  }
  cdp.close();
};

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(2);
});
