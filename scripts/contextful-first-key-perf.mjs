#!/usr/bin/env node
/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */

import { createDroidDevice } from "../tools/hil/droidctl_device.mjs";
import { connect } from "./remote-input-hil/cdp.mjs";
import { writeFile } from "node:fs/promises";
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/contextful-first-key-perf.mjs <report.json> [label]");
const phone = await createDroidDevice({ serial: process.env.ANDROID_SERIAL });
await phone.pressKey("KEYCODE_WAKEUP");
await phone.shell(["wm", "dismiss-keyguard"]);
await phone.forwardWebview("uk.gleissner.c64commander", 9333);
const pages = await (await fetch("http://localhost:9333/json")).json();
const page = pages.find((p) => p.type === "page");
if (!page) throw new Error("No app WebView found for first-key measurement");
const c = await connect(page.webSocketDebuggerUrl);
const report = {
  label: process.argv[3],
  measuredAt: new Date().toISOString(),
  targetId: phone.targetId,
  cpuRate: 2,
  samples: [],
};
const ready = async (path) =>
  c.evaluate(
    `new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{const slot=document.querySelector('[data-slot-active="true"]');const runway=document.querySelector('[data-testid="swipe-navigation-runway"]');if(location.pathname===${JSON.stringify(path)}&&runway?.dataset.runwayPhase==='idle'&&slot?.querySelector('[data-page-scroll-container]')?.textContent.length>30&&!slot.querySelector('[data-testid="page-loading"]'))resolve();else if(performance.now()-start>20000)reject(new Error('Page did not become ready'));else setTimeout(check,30)};check()})`,
  );
try {
  await c.send("Emulation.setCPUThrottlingRate", { rate: 2 });
  await c.send("Performance.enable");
  await c.evaluate(
    `new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-launch-phase')==='app-ready')resolve();else if(performance.now()-start>20000)reject(new Error('App launch did not finish'));else setTimeout(check,30)};check()})`,
  );
  await phone.pressKey("KEYCODE_ESCAPE");
  for (const width of [320, 800]) {
    await c.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 320 ? 426 : 1280,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await phone.pressKey("KEYCODE_5");
    await ready("/settings");
    await c.sleep(1800);
    await phone.pressKey("KEYCODE_5");
    await c.sleep(1800);
    for (let round = 0; round < 5; round++) {
      await phone.pressKey("KEYCODE_6");
      await ready("/docs");
      await c.sleep(600);
      await phone.pressKey("KEYCODE_5");
      await ready("/settings");
      await c.sleep(500);
      const before = await c.evaluate(
        `(()=>{const slot=document.querySelector('[data-slot-active="true"]');const selected=document.querySelector('[data-key-selected="true"]');window.__firstFocusProbe={start:null,ready:null};window.addEventListener('keydown',event=>{const p=window.__firstFocusProbe;p.start=event.timeStamp;const check=()=>{const next=document.querySelector('[data-key-selected="true"]');if(next&&next!==selected)requestAnimationFrame(()=>requestAnimationFrame(()=>p.ready=performance.now()));else if(performance.now()-p.start<10000)requestAnimationFrame(check);};requestAnimationFrame(check)},{capture:true,once:true});return{mounted:slot.querySelectorAll('[data-body-mounted="true"]').length,old:selected?.textContent.slice(0,80)}})()`,
      );
      await phone.pressKey("KEYCODE_DPAD_DOWN");
      const result = await c.evaluate(
        `new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{const p=window.__firstFocusProbe;if(p.ready!==null)resolve({ms:p.ready-p.start,target:document.querySelector('[data-key-selected="true"]')?.textContent.slice(0,80)});else if(performance.now()-start>12000)reject(new Error('First focus did not move'));else setTimeout(check,30)};check()})`,
      );
      const sample = { width, round, ...before, ...result };
      report.samples.push(sample);
      console.log(JSON.stringify(sample));
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
  }
} finally {
  await phone.pressKey("KEYCODE_ESCAPE");
  await phone.pressKey("KEYCODE_1");
  await c.send("Emulation.clearDeviceMetricsOverride");
  await c.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  c.close();
}
