#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Time keypad tab switches on a phone and capture a CPU profile of them.
 *
 *   node tools/hil/tab_switch_profile.mjs --serial defaultuser@192.168.2.15 --package uk.gleissner.c64uremote \
 *        --switches 20 --out artifacts/tab-switch/run
 *
 * Presses keys 1-6 in turn, waits for the route to change and the page to settle, and records the
 * long tasks (over 50 ms) and the Android-key-to-route time of each switch. Writes <out>.json and one
 * CPU profile per switch under <out>.profiles/.
 */

import fs from "node:fs";
import path from "node:path";
import { connect } from "../../scripts/remote-input-hil/cdp.mjs";
import { createDroidDevice } from "./droidctl_device.mjs";

const ROUTES = ["/", "/play", "/disks", "/config", "/settings", "/docs"];
const args = process.argv.slice(2);
const arg = (key, fallback) => (args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback);
const serial = arg("serial", undefined);
const pkg = arg("package", "uk.gleissner.c64uremote");
const switches = Number(arg("switches", "20"));
const port = Number(arg("cdp-port", "9351"));
const out = arg("out", "artifacts/tab-switch/run");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const phone = await createDroidDevice({ serial });
try {
  await phone.forwardWebview(pkg, port);
  const pages = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) throw new Error(`no WebView page on port ${port} for ${pkg}`);
  const cdp = await connect(page.webSocketDebuggerUrl);

  await cdp.evaluate(`(() => {
    window.__tabLong = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__tabLong.push({ start: e.startTime, ms: e.duration });
    }).observe({ type: "longtask", buffered: false });
    return 1;
  })()`);
  const settled = (route) =>
    cdp.evaluate(`new Promise((resolve) => {
      const t0 = performance.now();
      const poll = () => {
        if (location.pathname === ${JSON.stringify(route)}) {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
        } else if (performance.now() - t0 > 8000) resolve(-1);
        else setTimeout(poll, 10);
      };
      poll();
    })`);

  await cdp.send("HeapProfiler.collectGarbage");
  const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  const profileDir = `${out}.profiles`;
  fs.mkdirSync(profileDir, { recursive: true });
  const samples = [];
  for (let i = 0; i < switches; i += 1) {
    const route = ROUTES[(i + 1) % ROUTES.length];
    const before = await cdp.evaluate("window.__tabLong.length");
    await cdp.send("Profiler.start");
    await phone.pressKey(`KEYCODE_${ROUTES.indexOf(route) + 1}`);
    const settleMs = await settled(route);
    await sleep(700);
    const { profile: switchProfile } = await cdp.send("Profiler.stop");
    fs.writeFileSync(path.join(profileDir, `${String(i).padStart(2, "0")}${route.replace("/", "-") || "-home"}.cpuprofile`), JSON.stringify(switchProfile));
    const long = await cdp.evaluate(`JSON.stringify(window.__tabLong.slice(${before}))`);
    samples.push({ i, route, settleMs: Math.round(settleMs), longTasks: JSON.parse(long).map((t) => Math.round(t.ms)) });
    console.log(JSON.stringify(samples.at(-1)));
  }

  const heapAfterRaw = (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;
  await cdp.send("HeapProfiler.collectGarbage");
  const heapAfterGc = (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const over200 = samples.filter((s) => s.longTasks.some((ms) => ms > 200)).length;
  const worst = Math.max(0, ...samples.flatMap((s) => s.longTasks));
  const summary = {
    switches,
    switchesWithTaskOver200ms: over200,
    worstTaskMs: worst,
    heapMiB: { before: Math.round(heapBefore), afterRaw: Math.round(heapAfterRaw), afterGc: Math.round(heapAfterGc) },
  };
  fs.writeFileSync(`${out}.json`, JSON.stringify({ summary, samples }, null, 2));
  console.log(JSON.stringify(summary));
  cdp.close();
} finally {
  await phone.close?.();
}
