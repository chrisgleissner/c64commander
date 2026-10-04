#!/usr/bin/env node
/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */

// Real Android input through droidctl; CDP observes draw readiness and constrains CPU/viewport.
// Run the same command on the baseline and candidate APK, preserving application data.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "./remote-input-hil/cdp.mjs";
import { createDroidDevice } from "../tools/hil/droidctl_device.mjs";

const args = process.argv.slice(2);
const arg = (key, fallback) => (args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback);
const output = arg("output", "artifacts/contextful-draw/report.json");
const rounds = Number(arg("rounds", "10"));
const cpuRate = Number(arg("cpu-rate", "2"));
const urgentOnly = args.includes("--urgent-only");
if (!Number.isInteger(rounds) || rounds < 2 || !Number.isFinite(cpuRate) || cpuRate < 1) {
  throw new Error("Use at least two rounds and a CPU rate of at least one.");
}
const phone = await createDroidDevice({ serial: arg("serial", undefined) });
const port = Number(arg("cdp-port", "9333"));
await phone.forwardWebview("uk.gleissner.c64commander", port);
const pages = await (await fetch(`http://localhost:${port}/json`)).json();
const client = await connect(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
const routes = ["/", "/play", "/disks", "/config", "/settings", "/docs"];
const overlays = [
  { name: "diagnostics", key: "KEYCODE_STAR", selector: '[data-testid="diagnostics-sheet"]' },
  { name: "device-switcher", key: "KEYCODE_POUND", selector: '[data-testid="switch-device-sheet"]' },
  { name: "quick-menu", key: "KEYCODE_MENU", selector: '[data-testid="keypad-quick-menu"]' },
];
const report = { cpuRate, rounds, targetId: phone.targetId, samples: [], retained: [] };
const metrics = async () =>
  Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const checkpoint = async () => {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
};

const trial = async (key, readyExpression, description, setupKey) => {
  const triggerKey = { KEYCODE_STAR: "*", KEYCODE_POUND: "#", KEYCODE_MENU: "ContextMenu" }[key];
  // No full-page innerText: reading it forces layout and changes what is being measured.
  await client.evaluate(`(() => {
    window.__contextfulDrawTrial = { start: null, ready: null, frame: null };
    window.__contextfulDrawListener = event => {
      if (${Boolean(setupKey)} && event.key !== ${JSON.stringify(triggerKey)} && event.code !== ${JSON.stringify(triggerKey)}) return;
      window.removeEventListener('keydown', window.__contextfulDrawListener, true);
      const sample = window.__contextfulDrawTrial;
      sample.start = event.timeStamp;
      sample.key = event.key;
      sample.code = event.code;
      const check = () => {
        if (performance.now() - sample.start > 15000) return;
        if (${readyExpression}) {
          sample.frame = requestAnimationFrame(() => sample.frame = requestAnimationFrame(() => sample.ready = performance.now()));
        } else sample.frame = requestAnimationFrame(check);
      };
      sample.frame = requestAnimationFrame(check);
    };
    window.addEventListener('keydown', window.__contextfulDrawListener, { capture: true });
  })()`);
  const before = await metrics();
  if (setupKey) await phone.pressKey(setupKey);
  await phone.pressKey(key);
  await client.evaluate(`new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (window.__contextfulDrawTrial.ready !== null) resolve();
      else if (performance.now() - started > 15000) reject(new Error('Contextful draw timed out'));
      else setTimeout(check, 25);
    };
    check();
  })`);
  const sample = await client.evaluate("window.__contextfulDrawTrial");
  if (sample.start === null) throw new Error(`No WebView key event for ${key}`);
  // Consistent observation window for post-draw CPU, including animation completion.
  await client.sleep(350);
  const after = await metrics();
  report.samples.push({
    ...description,
    drawMs: sample.ready - sample.start,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
    scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
    heapBytes: after.JSHeapUsedSize,
  });
  console.log(JSON.stringify(report.samples.at(-1)));
  await checkpoint();
};

try {
  await client.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  await client.send("Performance.enable");
  for (const viewport of [
    { width: 320, height: 426 },
    { width: 800, height: 1280 },
  ]) {
    await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: true });
    await client.sleep(500);
    const expectedProfile = viewport.width === 320 ? "compact" : "expanded";
    const profile = await client.evaluate("document.documentElement.dataset.displayProfile");
    if (profile !== expectedProfile) {
      throw new Error(
        `Expected ${expectedProfile}, found ${profile}; use Auto display profile and Auto orientation before testing.`,
      );
    }
    // Start the heavy page at its top even if setup left a settings control selected.
    await phone.pressKey("KEYCODE_5");
    await client.sleep(500);
    await phone.pressKey("KEYCODE_5");
    await client.sleep(500);
    for (let round = 0; !urgentOnly && round < rounds; round++) {
      for (const [index, route] of routes.entries()) {
        const ready = `(() => {
          const slot = document.querySelector('[data-slot-active="true"]');
          const shell = slot?.querySelector('[data-page-scroll-container]');
          if (location.pathname !== ${JSON.stringify(route)} || slot?.dataset.routeIndex !== '${index}' ||
              !shell || shell.textContent.trim().length < 30 || slot.querySelector('[data-testid="page-loading"]')) return false;
          const visibleOpenCards = [...shell.querySelectorAll('[data-open="true"]')].filter(card => {
            const rect = card.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < innerHeight;
          });
          return visibleOpenCards.every(card => card.dataset.bodyMounted === 'true');
        })()`;
        await trial(`KEYCODE_${index + 1}`, ready, { viewport, round, kind: "page", name: route });
      }
    }
    // A heavy departing page is deliberate: global overlays must not build its offscreen bodies.
    await phone.pressKey("KEYCODE_5");
    await client.sleep(1000);
    for (let round = 0; round < rounds; round++) {
      for (const overlay of overlays) {
        if (urgentOnly) {
          await phone.pressKey("KEYCODE_6");
          await client.sleep(500);
        }
        const ready = `(() => {
          const surface = document.querySelector(${JSON.stringify(overlay.selector)});
          return surface?.getAttribute('data-state') === 'open' && surface.textContent.trim().length > 30;
        })()`;
        const description = { viewport, round, kind: urgentOnly ? "urgent-overlay" : "overlay", name: overlay.name };
        try {
          await trial(overlay.key, ready, description, urgentOnly ? "KEYCODE_5" : undefined);
        } catch (error) {
          // Record every missed draw, with its operation and stack, rather than
          // turning dropped requests into a favorable latency measurement.
          console.error("Contextful draw failed", description, error);
          report.samples.push({ ...description, drawMs: null, error: error.stack ?? String(error) });
          process.exitCode = 1;
          await checkpoint();
        }
        await phone.pressKey("KEYCODE_ESCAPE");
        await client.sleep(400);
        if (
          await client.evaluate(
            `Boolean(document.querySelector(${JSON.stringify(overlay.selector)} + '[data-state="open"]'))`,
          )
        ) {
          throw new Error(`${overlay.name} did not close`);
        }
      }
    }
    await client.sleep(1000);
    await client.send("HeapProfiler.collectGarbage");
    report.retained.push({
      viewport,
      ...(await metrics()),
      document: await client.evaluate(`({
      profile: document.documentElement.dataset.displayProfile,
      textScale: document.documentElement.dataset.textScale,
      elements: document.querySelectorAll('*').length,
      mountedBodies: document.querySelectorAll('[data-body-mounted="true"]').length,
    })`),
    });
    await checkpoint();
  }
} finally {
  await client.evaluate(`(() => {
    window.removeEventListener('keydown', window.__contextfulDrawListener, true);
    cancelAnimationFrame(window.__contextfulDrawTrial?.frame);
  })()`);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await client.send("Emulation.clearDeviceMetricsOverride");
  client.close();
}
