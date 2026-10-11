#!/usr/bin/env node
/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */

/**
 * What the shipped app costs on the smallest supported phone, in Demo Mode, on a Pixel in flight mode.
 *
 * The phone runs at the smallest supported panel geometry (480x640 at density 240, i.e. 320x426.7 CSS px) and
 * the WebView is CPU-throttled to the calibrated reference rate for that class of phone. Flight mode is required, not
 * advised: it guarantees no stage can reach a real Ultimate, whatever the app does.
 *
 *   node tools/hil/small_screen_profile.mjs --label baseline --output artifacts/small-screen/baseline.json
 *   node tools/hil/small_screen_profile.mjs --label candidate --only idle,live-view --profiles artifacts/small-screen/prof
 *
 * Stages:
 *   cold-start   force-stop + launch, N times: activity start, first paint, first route, demo entry.
 *   idle         per main route: main-thread busy share, renderer and app process CPU, requests,
 *                DOM size and heap over a quiet window. Optional CPU profile per route.
 *   navigation   keypad page jumps (keys 1-6) timed from the Android key event to a drawn page.
 *   live-view    Live View in Demo Mode: frame rate, main-thread busy share and process CPU.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "../../scripts/remote-input-hil/cdp.mjs";
import { createDroidDevice } from "./droidctl_device.mjs";

const PACKAGE = "uk.gleissner.c64commander";
const CALLBACK_SIZE = "480x640";
const CALLBACK_DENSITY = "240";
const MAX_MUSIC_VOLUME_STEP = 5;
const ROUTES = ["/", "/play", "/disks", "/config", "/settings", "/docs"];

const args = process.argv.slice(2);
const arg = (key, fallback) => (args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback);
const label = arg("label", "run");
const output = arg("output", `artifacts/small-screen/${label}.json`);
const profileDir = arg("profiles", undefined);
const cpuRate = Number(arg("cpu-rate", "2"));
const idleSeconds = Number(arg("idle-seconds", "20"));
const coldRuns = Number(arg("cold-runs", "5"));
const navRounds = Number(arg("nav-rounds", "6"));
const port = Number(arg("cdp-port", "9341"));
const only = (arg("only", "") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const wants = (stage) => only.length === 0 || only.includes(stage);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round1 = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : value);

const phone = await createDroidDevice({ serial: arg("serial", undefined) });
const sh = async (line, options) => (await phone.shell(["sh", "-c", line], options)).trim();
const report = { label, cpuRate, idleSeconds, startedAt: new Date().toISOString(), stages: {} };
const checkpoint = async () => {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
};

// ── rig ─────────────────────────────────────────────────────────────────────────────────────

const requireFlightMode = async () => {
  const airplane = await sh("settings get global airplane_mode_on");
  const routable = (await sh("ip -o -4 addr show || true"))
    .split("\n")
    .filter((line) => line.trim() && !line.includes(" lo "));
  if (airplane !== "1" || routable.length) {
    throw new Error(`flight mode with no routable interface is required (airplane=${airplane}, ${routable})`);
  }
};

const musicVolume = async () => {
  const dump = await sh("dumpsys audio");
  return Number(/streamVolume:(\d+)/.exec(dump.slice(dump.indexOf("- STREAM_MUSIC:")))?.[1] ?? NaN);
};

const quietenSpeaker = async () => {
  for (let attempt = 0; attempt < 25 && (await musicVolume()) > MAX_MUSIC_VOLUME_STEP; attempt += 1) {
    await phone.pressKey("KEYCODE_VOLUME_DOWN");
    await sleep(200);
  }
  const volume = await musicVolume();
  if (!(volume <= MAX_MUSIC_VOLUME_STEP)) throw new Error(`music volume is ${volume}, above ${MAX_MUSIC_VOLUME_STEP}`);
  return volume;
};

const geometry = async () => ({ size: await sh("wm size"), density: await sh("wm density") });

const setCallbackGeometry = async () => {
  await sh(`wm size ${CALLBACK_SIZE}; wm density ${CALLBACK_DENSITY}`);
};

const restoreGeometry = async () => {
  await sh("wm size reset; wm density reset");
};

const appPid = async (timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = (await sh(`pidof ${PACKAGE} || true`)).split(/\s+/)[0];
    if (pid) return pid;
    await sleep(300);
  }
  throw new Error(`${PACKAGE} did not start`);
};

/** The WebView renderer serving this app: the sandboxed process started most recently after it. */
const rendererPid = async (pid) => {
  const appStart = Number((await sh(`cat /proc/${pid}/stat`)).split(") ")[1].split(/\s+/)[19]);
  const rows = (await sh("ps -A -o PID,NAME | grep sandboxed_process || true")).split("\n").filter(Boolean);
  let best = null;
  for (const row of rows) {
    const candidate = row.trim().split(/\s+/)[0];
    const stat = await sh(`cat /proc/${candidate}/stat 2>/dev/null || true`);
    if (!stat) continue;
    const start = Number(stat.split(") ")[1].split(/\s+/)[19]);
    if (start >= appStart && (!best || start < best.start)) best = { pid: candidate, start };
  }
  return best?.pid ?? null;
};

/** Proportional set size in MiB, the share of physical memory the process is charged for. */
const pssMiB = async (pid) => {
  if (!pid) return NaN;
  const dump = await sh(`dumpsys meminfo ${pid} | grep -E 'TOTAL PSS:|^ +TOTAL ' | head -1`);
  const kb = Number(/TOTAL PSS:\s*(\d+)/.exec(dump)?.[1] ?? /TOTAL\s+(\d+)/.exec(dump)?.[1] ?? NaN);
  return round1(kb / 1024);
};

const cpuTicks = async (pid) => {
  if (!pid) return NaN;
  const stat = await sh(`cat /proc/${pid}/stat 2>/dev/null || true`);
  if (!stat) return NaN;
  const fields = stat.split(") ")[1].split(/\s+/);
  return Number(fields[11]) + Number(fields[12]);
};

// ── CDP ─────────────────────────────────────────────────────────────────────────────────────

let client = null;

const attach = async (timeoutMs = 20000) => {
  client?.close();
  client = null;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await phone.forwardWebview(PACKAGE, port);
      const pages = await (await fetch(`http://localhost:${port}/json`)).json();
      const page = pages.find((candidate) => candidate.type === "page");
      if (page) {
        client = await connect(page.webSocketDebuggerUrl);
        await client.send("Performance.enable");
        await client.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw new Error(`could not attach to the WebView: ${lastError?.message ?? "no page"}`);
};

const js = (expression) => client.evaluate(expression);
const metrics = async () =>
  Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

const healthState = () =>
  js(`(() => {
    const badge = document.querySelector('[data-panel-position="1"] [data-testid=unified-health-badge]')
      ?? document.querySelector('[data-testid=unified-health-badge]');
    return badge ? { state: badge.getAttribute("data-connection-state"), text: badge.innerText.trim() } : null;
  })()`);

const waitFor = async (expression, timeoutMs, stepMs = 100) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await js(expression).catch(() => false)) return true;
    await sleep(stepMs);
  }
  return false;
};

const DEMO_ACTIVE = `document.querySelector('[data-testid=unified-health-badge]')?.getAttribute("data-connection-state") === "DEMO_ACTIVE"`;

/**
 * Somebody who has used a real device before is shown it as offline rather than offered Demo Mode, so the
 * way in is the one the app gives them: the health badge, then "Use the simulated device".
 */
const enterDemoFromBadge = async () => {
  await js(`document.querySelector('[data-panel-position="1"] [data-testid=unified-health-badge]')?.click()
    ?? document.querySelector('[data-testid=unified-health-badge]')?.click()`);
  if (!(await waitFor(`!!document.querySelector('[data-testid="use-simulated-device-action"]')`, 8000))) {
    throw new Error("the diagnostics sheet offered no way into Demo Mode");
  }
  await js(`document.querySelector('[data-testid="use-simulated-device-action"]').click()`);
  await waitFor(DEMO_ACTIVE, 15000);
  await phone.pressKey("KEYCODE_BACK");
  await waitFor(`!document.querySelector('[data-testid="diagnostics-sheet"][data-state="open"]')`, 5000);
};

const acceptDemoOffer = async () => {
  const opened = await waitFor(
    `!!document.querySelector('[data-testid="demo-interstitial-continue"]') ||
     document.querySelector('[data-testid=unified-health-badge]')?.getAttribute("data-connection-state") === "OFFLINE_NO_DEMO"`,
    15000,
  );
  const offered = opened && (await js(`!!document.querySelector('[data-testid="demo-interstitial-continue"]')`));
  if (offered) await js(`document.querySelector('[data-testid="demo-interstitial-continue"]').click()`);
  else if (opened) await enterDemoFromBadge();
  const active = await waitFor(
    `document.querySelector('[data-testid=unified-health-badge]')?.getAttribute("data-connection-state") === "DEMO_ACTIVE"`,
    15000,
  );
  if (!active) throw new Error(`Demo Mode did not become active: ${JSON.stringify(await healthState())}`);
  return offered ? "offer" : "badge";
};

const errorLog = () =>
  js(`(() => {
    try {
      const raw = localStorage.getItem("c64u_app_logs");
      const logs = raw ? JSON.parse(raw) : [];
      return logs.filter((e) => e.level === "error" || e.level === "warn").map((e) => ({ level: e.level, message: e.message }));
    } catch (error) { return [{ level: "harness", message: String(error) }]; }
  })()`);

// ── stages ──────────────────────────────────────────────────────────────────────────────────

const coldStart = async () => {
  const samples = [];
  for (let run = 0; run < coldRuns; run += 1) {
    await phone.call("droid_app.stop_app", { targetId: phone.targetId, package: PACKAGE });
    await sleep(1500);
    const launchedAt = Date.now();
    const started = await phone.call("droid_app.start_app", { targetId: phone.targetId, package: PACKAGE });
    await attach();
    const timing = await js(`new Promise((resolve) => {
      const out = {};
      const nav = performance.getEntriesByType("navigation")[0];
      out.domContentLoaded = nav?.domContentLoadedEventEnd;
      out.load = nav?.loadEventEnd;
      out.fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
      out.resources = performance.getEntriesByType("resource").length;
      out.transferKiB = Math.round(performance.getEntriesByType("resource").reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024);
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          out.lcp = entries[entries.length - 1]?.startTime ?? null;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch { out.lcp = null; }
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          out.longTasks = entries.length;
          out.longTaskMs = Math.round(entries.reduce((s, e) => s + e.duration, 0));
        }).observe({ type: "longtask", buffered: true });
      } catch { out.longTasks = null; }
      setTimeout(() => resolve(out), 50);
    })`);
    const routeReady = await waitFor(
      `!!document.querySelector('[data-slot-active="true"] [data-page-scroll-container]') && !document.querySelector('[data-testid="page-loading"]')`,
      20000,
    );
    const firstRouteMs = routeReady ? await js("performance.now()") : null;
    const offerShown = await acceptDemoOffer().catch((error) => ({ error: String(error.message) }));
    const demoActiveMs = await js("performance.now()");
    await sleep(3000);
    const m = await metrics();
    samples.push({
      run,
      activityTotalMs: started?.totalTimeMs ?? started?.totalTime ?? null,
      wallToAttachMs: null,
      ...timing,
      firstRouteObservedMs: firstRouteMs,
      demoActiveObservedMs: demoActiveMs,
      offerShown,
      scriptMsTo3sAfterDemo: Math.round(m.ScriptDuration * 1000),
      taskMsTo3sAfterDemo: Math.round(m.TaskDuration * 1000),
      heapMiB: round1(m.JSHeapUsedSize / 1048576),
      nodes: m.Nodes,
      launchedAt,
    });
    console.log("cold-start", JSON.stringify(samples.at(-1)));
  }
  const summary = {};
  for (const key of ["activityTotalMs", "domContentLoaded", "fcp", "lcp", "longTaskMs", "scriptMsTo3sAfterDemo", "taskMsTo3sAfterDemo", "heapMiB"]) {
    summary[key] = round1(median(samples.map((s) => s[key])));
  }
  return { summary, samples };
};

const pressRouteKey = async (route) => {
  const index = ROUTES.indexOf(route);
  await phone.pressKey(`KEYCODE_${index + 1}`);
  const ok = await waitFor(`location.pathname === ${JSON.stringify(route)}`, 8000);
  if (!ok) throw new Error(`keypad ${index + 1} did not reach ${route}`);
};

/**
 * A sampling profile, taken in its own window: the profiler's own sampling costs the renderer about a fifth of a
 * core, so it must never overlap a window whose CPU share is being reported.
 */
const captureProfile = async (name, during) => {
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: 1000 });
  await client.send("Profiler.start");
  try {
    await during();
  } finally {
    const { profile } = await client.send("Profiler.stop");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, `${label}-${name}.cpuprofile`), JSON.stringify(profile));
  }
};

/** CDP's CPU throttle costs the renderer ~65% of a core by itself, so process CPU is read unthrottled. */
const setThrottle = (rate) => client.send("Emulation.setCPUThrottlingRate", { rate });

const idle = async () => {
  await setThrottle(1);
  const pid = await appPid();
  const renderer = await rendererPid(pid);
  const perRoute = [];
  for (const route of ROUTES) {
    await pressRouteKey(route);
    await sleep(4000);
    const requestsBefore = client.networkReqs.filter((r) => r.phase === "send").length;
    const before = await metrics();
    const appBefore = await cpuTicks(pid);
    const rendererBefore = await cpuTicks(renderer);
    const startedAt = Date.now();
    await sleep(idleSeconds * 1000);
    const elapsed = (Date.now() - startedAt) / 1000;
    const after = await metrics();
    const appAfter = await cpuTicks(pid);
    const rendererAfter = await cpuTicks(renderer);
    if (profileDir) await captureProfile(`idle${route.replace(/\//g, "_") || "_home"}`, () => sleep(10000));
    const requests = client.networkReqs.filter((r) => r.phase === "send").slice(requestsBefore);
    const byUrl = {};
    for (const request of requests) {
      const key = `${request.method} ${request.url.replace(/^https?:\/\/[^/]+/, "")}`;
      byUrl[key] = (byUrl[key] ?? 0) + 1;
    }
    const sample = {
      route,
      seconds: round1(elapsed),
      mainThreadBusyPct: round1(((after.TaskDuration - before.TaskDuration) / elapsed) * 100),
      scriptPct: round1(((after.ScriptDuration - before.ScriptDuration) / elapsed) * 100),
      layoutAndStylePct: round1(
        ((after.LayoutDuration - before.LayoutDuration + after.RecalcStyleDuration - before.RecalcStyleDuration) / elapsed) * 100,
      ),
      layouts: after.LayoutCount - before.LayoutCount,
      styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
      appProcessCpuPct: round1(((appAfter - appBefore) / 100 / elapsed) * 100),
      rendererCpuPct: round1(((rendererAfter - rendererBefore) / 100 / elapsed) * 100),
      requestsPerMinute: round1((requests.length / elapsed) * 60),
      requests: byUrl,
      nodes: after.Nodes,
      listeners: after.JSEventListeners,
      heapMiB: round1(after.JSHeapUsedSize / 1048576),
      appPssMiB: await pssMiB(pid),
      rendererPssMiB: await pssMiB(renderer),
    };
    perRoute.push(sample);
    console.log("idle", JSON.stringify(sample));
    await checkpoint();
  }
  await setThrottle(cpuRate);
  return { appPid: pid, rendererPid: renderer, perRoute };
};

const installShiftObserver = () =>
  js(`(() => {
    if (window.__smallScreenProfileShifts) return;
    window.__smallScreenProfileShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__smallScreenProfileShifts.push({
          t: entry.startTime,
          value: entry.value,
          input: entry.hadRecentInput,
          sources: (entry.sources || []).slice(0, 3).map((source) => ({
            node: source.node ? (source.node.closest?.('[data-testid]')?.getAttribute('data-testid') ?? source.node.nodeName) : null,
            dy: Math.round(source.currentRect.y - source.previousRect.y),
            dx: Math.round(source.currentRect.x - source.previousRect.x),
            dh: Math.round(source.currentRect.height - source.previousRect.height),
          })),
        });
      }
    }).observe({ type: "layout-shift" });
  })()`);

const navigation = async () => {
  const samples = [];
  await installShiftObserver();
  const navRound = async (round) => {
    for (const [index, route] of ROUTES.entries()) {
      const ready = `(() => {
        const slot = document.querySelector('[data-slot-active="true"]');
        const shell = slot?.querySelector('[data-page-scroll-container]');
        if (location.pathname !== ${JSON.stringify(route)} || slot?.dataset.routeIndex !== '${index}' ||
            !shell || shell.textContent.trim().length < 30 || slot.querySelector('[data-testid="page-loading"]')) return false;
        return [...shell.querySelectorAll('[data-open="true"]')].filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        }).every((card) => card.dataset.bodyMounted === 'true');
      })()`;
      await js(`(() => {
        window.__smallScreenProfile = { start: null, ready: null };
        const listener = (event) => {
          window.removeEventListener('keydown', listener, true);
          const sample = window.__smallScreenProfile;
          sample.start = event.timeStamp;
          const check = () => {
            if (performance.now() - sample.start > 15000) return;
            if (${ready}) requestAnimationFrame(() => requestAnimationFrame(() => (sample.ready = performance.now())));
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        };
        window.addEventListener('keydown', listener, { capture: true });
      })()`);
      const before = await metrics();
      const shiftsBefore = await js("window.__smallScreenProfileShifts.length");
      await phone.pressKey(`KEYCODE_${index + 1}`);
      const done = await waitFor("window.__smallScreenProfile.ready !== null", 15000, 25);
      const sample = await js("window.__smallScreenProfile");
      await sleep(700);
      const after = await metrics();
      const shifts = await js(`window.__smallScreenProfileShifts.slice(${shiftsBefore})`);
      samples.push({
        round,
        route,
        drawMs: done && sample.start !== null ? round1(sample.ready - sample.start) : null,
        taskMs: round1((after.TaskDuration - before.TaskDuration) * 1000),
        scriptMs: round1((after.ScriptDuration - before.ScriptDuration) * 1000),
        layoutMs: round1((after.LayoutDuration - before.LayoutDuration) * 1000),
        layoutShift: round1(shifts.reduce((sum, entry) => sum + entry.value, 0) * 1000) / 1000,
        shifts: shifts.filter((entry) => entry.value > 0.001).map((entry) => ({ ms: round1(entry.t - sample.start), value: round1(entry.value * 1000) / 1000, sources: entry.sources })),
      });
    }
  };
  for (let round = 0; round < navRounds; round += 1) {
    await navRound(round);
    console.log("navigation round", round, JSON.stringify(samples.slice(-ROUTES.length).map((s) => [s.route, s.drawMs, s.layoutShift])));
  }
  if (profileDir) {
    const kept = samples.length;
    await captureProfile("navigation", () => navRound(-1));
    samples.splice(kept);
  }
  const warm = samples.filter((s) => s.round > 0);
  const summary = Object.fromEntries(
    ROUTES.map((route) => {
      const rows = warm.filter((s) => s.route === route);
      return [
        route,
        {
          drawMs: round1(median(rows.map((s) => s.drawMs))),
          scriptMs: round1(median(rows.map((s) => s.scriptMs))),
          taskMs: round1(median(rows.map((s) => s.taskMs))),
          layoutShift: median(rows.map((s) => s.layoutShift)),
          timeouts: rows.filter((s) => s.drawMs === null).length,
        },
      ];
    }),
  );
  return { summary, samples };
};

const liveView = async () => {
  await pressRouteKey("/");
  await sleep(1500);
  await js(`(() => {
    const toggle = document.querySelector('[data-testid="home-section-toggle-live-view"]');
    if (toggle && !document.querySelector('[data-testid="av-video-toggle"]')) toggle.click();
  })()`);
  await waitFor(`!!document.querySelector('[data-testid="av-video-toggle"]')`, 8000);
  const pressed = (id) => js(`document.querySelector('[data-testid="${id}"]')?.getAttribute("aria-pressed")`);
  if ((await pressed("av-video-toggle")) !== "true") await js(`document.querySelector('[data-testid="av-video-toggle"]').click()`);
  await sleep(1500);
  if ((await pressed("av-audio-toggle")) !== "true") await js(`document.querySelector('[data-testid="av-audio-toggle"]')?.click()`);
  await sleep(6000);
  await setThrottle(1);
  const pid = await appPid();
  const renderer = await rendererPid(pid);
  const before = await metrics();
  const appBefore = await cpuTicks(pid);
  const rendererBefore = await cpuTicks(renderer);
  const fpsReadings = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < idleSeconds * 1000) {
    const text = await js(`document.querySelector('[data-testid="av-mirror-fps"]')?.innerText ?? ""`);
    const fps = Number(/(\d+)\s*fps/.exec(text)?.[1] ?? NaN);
    if (Number.isFinite(fps)) fpsReadings.push(fps);
    await sleep(1000);
  }
  const elapsed = (Date.now() - startedAt) / 1000;
  const after = await metrics();
  const appAfter = await cpuTicks(pid);
  const rendererAfter = await cpuTicks(renderer);
  if (profileDir) await captureProfile("live-view", () => sleep(10000));
  const result = {
    seconds: round1(elapsed),
    fpsMedian: median(fpsReadings),
    fpsMin: fpsReadings.length ? Math.min(...fpsReadings) : null,
    mainThreadBusyPct: round1(((after.TaskDuration - before.TaskDuration) / elapsed) * 100),
    scriptPct: round1(((after.ScriptDuration - before.ScriptDuration) / elapsed) * 100),
    appProcessCpuPct: round1(((appAfter - appBefore) / 100 / elapsed) * 100),
    rendererCpuPct: round1(((rendererAfter - rendererBefore) / 100 / elapsed) * 100),
    heapMiB: round1(after.JSHeapUsedSize / 1048576),
    appPssMiB: await pssMiB(pid),
    rendererPssMiB: await pssMiB(renderer),
  };
  await js(`(() => {
    for (const id of ["av-audio-toggle", "av-video-toggle"]) {
      const el = document.querySelector('[data-testid="' + id + '"]');
      if (el?.getAttribute("aria-pressed") === "true") el.click();
    }
  })()`);
  await sleep(1500);
  await setThrottle(cpuRate);
  return result;
};

// ── main ────────────────────────────────────────────────────────────────────────────────────

const originalGeometry = await geometry();
report.originalGeometry = originalGeometry;
try {
  await requireFlightMode();
  report.volume = await quietenSpeaker();
  await sh("svc power stayon true; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard || true");
  await setCallbackGeometry();
  report.geometry = await geometry();
  report.versionName = /versionName=(\S+)/.exec(await sh(`dumpsys package ${PACKAGE} | grep versionName`))?.[1];
  await phone.call("droid_app.stop_app", { targetId: phone.targetId, package: PACKAGE });
  await sleep(1000);

  if (wants("cold-start")) {
    report.stages["cold-start"] = await coldStart();
    await checkpoint();
  } else {
    await phone.call("droid_app.start_app", { targetId: phone.targetId, package: PACKAGE });
    await attach();
    await acceptDemoOffer();
  }
  report.displayProfile = await js("document.documentElement.dataset.displayProfile");
  report.viewport = await js("({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
  if (report.displayProfile !== "compact") throw new Error(`expected the compact profile, got ${report.displayProfile}`);
  await sleep(3000);

  if (wants("idle")) {
    report.stages.idle = await idle();
    await checkpoint();
  }
  if (wants("navigation")) {
    report.stages.navigation = await navigation();
    await checkpoint();
  }
  if (wants("live-view")) {
    report.stages["live-view"] = await liveView();
    await checkpoint();
  }
  report.health = await healthState();
  report.errorLog = await errorLog();
  report.console = client.consoleLogs.filter((l) => l.type === "error" || l.type === "warning");
} finally {
  report.finishedAt = new Date().toISOString();
  await client?.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
  client?.close();
  await restoreGeometry();
  await checkpoint();
  console.log(`wrote ${output}`);
}
