#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Why does search keystroke latency grow with session age? One run, on a fresh or an aged session,
 * that records the latency, a CPU profile of it, and every count that could grow with the session.
 *
 * Run it once right after a launch and once after a long session (or after several full gates), with
 * different `--label`s, and compare the two JSON files. What it records:
 *
 *   latency       the same probe and keystroke pattern as the gate's `search-latency` stage
 *   typing.cpuprofile   a CPU profile of exactly those keystrokes
 *   idle.cpuprofile     a CPU profile of the open overlay with nobody typing: background work that
 *                 competes with every keystroke, which grows if a timer or listener leaks
 *   counts        before and after: trace events held in memory (the health badge re-derives over
 *                 all of them on each trace update), React fibers, react-query cache entries,
 *                 DOM nodes, DOM counters and window listeners by type, heap after GC, and the
 *                 localStorage keys the search sources read
 *   per keystroke the rows the overlay rendered, and how many `c64u-traces-updated` events fired
 *   window        setTimeout / setInterval / requestAnimationFrame calls and long tasks while typing
 *
 * With `--sourcemaps <dir>` (from build_sourcemapped.mjs for the installed build) both profiles are
 * also summarised in original function names, grouped into health, scoring, scrollIntoView, tracing.
 *
 * Usage:
 *   node tools/hil/search_latency_profile.mjs --out <dir> [--label fresh] [--cdp-port 9333]
 *        [--rounds 30] [--idle-seconds 5] [--sampling-us 200] [--sourcemaps <dir>]
 *
 * Silent: it makes no sound and touches no Ultimate. It types into the search overlay only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectPage } from "./cdp_page.mjs";
import { percentile } from "./percentile.mjs";
import { aggregateProfile, createMapper } from "./symbolize_cpuprofile.mjs";

const WORD = "radio";

/** Installed once per page. Counts calls rather than replacing behaviour; its own waits bypass it. */
const INSTALL_PROBE = `(()=>{const w=window;if(w.__c64uLeadProbe) return 1;
const p={origSetTimeout:w.setTimeout,setTimeout:0,setInterval:0,raf:0,tracesUpdated:0,longTasks:[]};
const st=w.setTimeout,si=w.setInterval,raf=w.requestAnimationFrame;
w.setTimeout=function(...a){p.setTimeout++;return st.apply(this,a)};
w.setInterval=function(...a){p.setInterval++;return si.apply(this,a)};
w.requestAnimationFrame=function(...a){p.raf++;return raf.apply(this,a)};
w.addEventListener("c64u-traces-updated",()=>{p.tracesUpdated++});
try{new PerformanceObserver((list)=>{for(const e of list.getEntries())p.longTasks.push(Math.round(e.duration))}).observe({type:"longtask"})}
catch(e){p.longTaskError=String(e)}
w.__c64uLeadProbe=p;return 1})()`;

const RESET_WINDOW = `(()=>{const p=window.__c64uLeadProbe;p.setTimeout=0;p.setInterval=0;p.raf=0;p.tracesUpdated=0;p.longTasks=[];return 1})()`;
const READ_WINDOW = `(()=>{const p=window.__c64uLeadProbe;return JSON.stringify({setTimeout:p.setTimeout,setInterval:p.setInterval,
requestAnimationFrame:p.raf,tracesUpdated:p.tracesUpdated,longTasks:p.longTasks,longTaskError:p.longTaskError??null})})()`;

const OPEN_OVERLAY = `(async()=>{const p=window.__c64uLeadProbe;const wait=(ms)=>new Promise(r=>p.origSetTimeout.call(window,r,ms));
const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
if(!q("search-input")){q("tab-home")?.click();await wait(1200);q("home-search-field")?.click();await wait(900);}
return JSON.stringify({opened:q("search-input")!==null});})()`;

/** Things in the page that could grow with session age. Every read is guarded and says why it failed. */
const PAGE_COUNTS = `(()=>{const out={};const note=(k,f)=>{try{out[k]=f()}catch(e){out[k]={error:String(e)}}};
note("traceEvents",()=>window.__c64uTracing?.getTraces?.().length??null);
note("domElements",()=>document.getElementsByTagName("*").length);
note("overlayOptions",()=>document.querySelectorAll('#search-results-listbox [role=option]').length);
note("react",()=>{const root=document.getElementById("root");const key=root&&Object.keys(root).find(k=>k.startsWith("__reactContainer$"));
  if(!key) return {error:"no React container on #root"};
  let fibers=0,client=null;const stack=[root[key]];
  while(stack.length){const f=stack.pop();if(!f)continue;fibers++;
    const c=f.memoizedProps&&f.memoizedProps.client;if(!client&&c&&typeof c.getQueryCache==="function")client=c;
    if(f.sibling)stack.push(f.sibling);if(f.child)stack.push(f.child);}
  const queries=client?client.getQueryCache().getAll():[];
  const byKind={};for(const query of queries){const k=String(query.queryKey?.[0]);byKind[k]=(byKind[k]??0)+1;}
  return {fibers,queryCacheEntries:client?queries.length:null,queryKeysByKind:byKind};});
note("localStorage",()=>{const keys=[];let chars=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);const n=(localStorage.getItem(k)??"").length;chars+=n;keys.push([k,n]);}
  keys.sort((a,b)=>b[1]-a[1]);
  const len=(k)=>{const raw=localStorage.getItem(k);if(!raw)return 0;const v=JSON.parse(raw);return Array.isArray(v)?v.length:(v&&typeof v==="object"?Object.keys(v).length:1)};
  return {keys:keys.length,chars,largest:keys.slice(0,12),recentlyPlayed:len("c64u_recently_played:v2"),
    searchRecent:len("c64u_search_recent:v1"),searchPicked:len("c64u_search_picked:v1")};});
return JSON.stringify(out);})()`;

/** Five rounds of the gate's four keystrokes per call, recording what each keystroke rendered. */
const typeRounds = (
  rounds,
) => `(async()=>{const p=window.__c64uLeadProbe;const wait=(ms)=>new Promise(r=>p.origSetTimeout.call(window,r,ms));
const input=document.querySelector('[data-testid="search-input"]');
if(!input) return JSON.stringify({error:"the search field is not open"});
const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
const keystrokes=[];
const type=async(text,record)=>{const before=p.tracesUpdated;setter.call(input,text);
  input.dispatchEvent(new Event("input",{bubbles:true}));await wait(120);
  if(record) keystrokes.push({text,rows:document.querySelectorAll('#search-results-listbox [role=option]').length,
    tracesUpdated:p.tracesUpdated-before});};
for(let round=0;round<${rounds};round+=1){
  for(let n=1;n<=4;n+=1) await type(${JSON.stringify(WORD)}.slice(0,n),true);
  window.__c64uSearchLatencyProbe=false; await type("",false); await wait(80);
  window.__c64uSearchLatencyProbe=true;}
return JSON.stringify({keystrokes});})()`;

const GROUPS = [
  { name: "health", pattern: /hooks\/useHealthState|lib\/diagnostics\/healthModel/ },
  { name: "scoring", pattern: /lib\/search\/score|hooks\/useSearchResults/ },
  { name: "scrollIntoView", pattern: /scrollIntoView/ },
  { name: "tracing", pattern: /lib\/tracing\// },
];

/** Busy time per second of a profile, and the grouped time when source maps are available. */
export const summarizeProfile = (profile, frameKey, samples) => {
  const result = aggregateProfile(profile, frameKey, frameKey.symbolized ? GROUPS : []);
  const seconds = result.wallMs / 1000;
  return {
    wallMs: Math.round(result.wallMs),
    busyMs: Math.round(result.busyMs),
    busyMsPerSecond: seconds > 0 ? Math.round(result.busyMs / seconds) : null,
    groupsMs: Object.fromEntries([...result.grouped].map(([name, ms]) => [name, Math.round(ms)])),
    groupsMsPerKeystroke: samples
      ? Object.fromEntries([...result.grouped].map(([name, ms]) => [name, Number((ms / samples).toFixed(2))]))
      : null,
    topSelf: [...result.self.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 15)
      .map(([key, ms]) => [key, Math.round(ms)]),
  };
};

const cdpCounts = async (page) => {
  const out = {};
  const attempt = async (name, read) => {
    try {
      out[name] = await read();
    } catch (error) {
      console.error(`WARN could not read ${name}: ${error.message}`);
      out[name] = { error: error.message };
    }
  };
  await attempt("domCounters", () => page.send("Memory.getDOMCounters"));
  await attempt("heapAfterGc", async () => {
    await page.send("HeapProfiler.collectGarbage");
    const { usedSize, totalSize } = await page.send("Runtime.getHeapUsage");
    return { usedMb: Number((usedSize / 1048576).toFixed(1)), totalMb: Number((totalSize / 1048576).toFixed(1)) };
  });
  await attempt("windowListenersByType", async () => {
    const { result } = await page.send("Runtime.evaluate", { expression: "window" });
    const { listeners } = await page.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
    const byType = {};
    for (const listener of listeners) byType[listener.type] = (byType[listener.type] ?? 0) + 1;
    return byType;
  });
  return out;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const outDir = arg("out", "");
  if (!outDir) {
    console.error("usage: search_latency_profile.mjs --out <dir> [--label L] [--rounds 30] [--sourcemaps <dir>]");
    process.exit(2);
  }
  const label = arg("label", "run");
  const rounds = Number(arg("rounds", "30"));
  const idleSeconds = Number(arg("idle-seconds", "5"));
  const samplingUs = Number(arg("sampling-us", "200"));
  const sourcemaps = arg("sourcemaps", "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(outDir, `search-${label}-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const page = await connectPage(arg("cdp-port", "9333"));
  try {
    await page.evaluate(INSTALL_PROBE);
    await page.evaluate("(()=>{window.__c64uSearchLatencyProbe=true;window.__c64uSearchLatencySamples=[];return 1})()");
    const opened = await page.evaluate(OPEN_OVERLAY);
    if (!opened?.opened) throw new Error("the search overlay did not open");

    const before = { page: await page.evaluate(PAGE_COUNTS), cdp: await cdpCounts(page) };

    await page.send("Profiler.enable");
    await page.send("Profiler.setSamplingInterval", { interval: samplingUs });
    await page.evaluate(RESET_WINDOW);
    await page.send("Profiler.start");
    await new Promise((resolve) => setTimeout(resolve, idleSeconds * 1000));
    const { profile: idleProfile } = await page.send("Profiler.stop");
    const idleWindow = await page.evaluate(READ_WINDOW);

    await page.evaluate(RESET_WINDOW);
    await page.send("Profiler.start");
    const keystrokes = [];
    for (let done = 0; done < rounds; done += 5) {
      const batch = await page.evaluate(typeRounds(Math.min(5, rounds - done)));
      if (batch?.error) throw new Error(batch.error);
      keystrokes.push(...batch.keystrokes);
    }
    const { profile: typingProfile } = await page.send("Profiler.stop");
    const typingWindow = await page.evaluate(READ_WINDOW);
    const latency = await page.evaluate(
      "(()=>{const s=(window.__c64uSearchLatencySamples||[]).slice();window.__c64uSearchLatencyProbe=false;return JSON.stringify({samples:s})})()",
    );
    const after = { page: await page.evaluate(PAGE_COUNTS), cdp: await cdpCounts(page) };
    await page.evaluate(`(()=>{document.querySelector('[data-testid="search-close"]')?.click();return 1})()`);

    fs.writeFileSync(`${base}.idle.cpuprofile`, JSON.stringify(idleProfile));
    fs.writeFileSync(`${base}.typing.cpuprofile`, JSON.stringify(typingProfile));

    const samples = latency.samples;
    const at = (fraction) => (samples.length ? Number(percentile(samples, fraction).toFixed(1)) : null);
    let frameKey = (callFrame) => `${callFrame.functionName || "(anonymous)"} ${callFrame.url.split("/").pop()}`;
    if (sourcemaps) {
      const mapDir = [sourcemaps, path.join(sourcemaps, "assets"), path.join(sourcemaps, "dist", "assets")].find(
        (dir) => fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith(".js.map")),
      );
      if (!mapDir) throw new Error(`no *.js.map files under ${sourcemaps}`);
      const mapper = createMapper(mapDir);
      const cache = new Map();
      frameKey = (callFrame) => {
        const id = `${callFrame.url}|${callFrame.lineNumber}|${callFrame.columnNumber}|${callFrame.functionName}`;
        if (!cache.has(id)) cache.set(id, mapper(callFrame).key);
        return cache.get(id);
      };
      frameKey.symbolized = true;
    }
    const report = {
      label,
      at: new Date().toISOString(),
      page: page.url,
      latencyMs: { count: samples.length, p50: at(0.5), p90: at(0.9), p95: at(0.95), max: at(1), samples },
      keystrokes: {
        count: keystrokes.length,
        rowsMax: Math.max(0, ...keystrokes.map((k) => k.rows)),
        tracesUpdatedPerKeystroke: keystrokes.length
          ? Number((keystrokes.reduce((sum, k) => sum + k.tracesUpdated, 0) / keystrokes.length).toFixed(2))
          : null,
        detail: keystrokes,
      },
      idle: { window: idleWindow, profile: summarizeProfile(idleProfile, frameKey, null) },
      typing: { window: typingWindow, profile: summarizeProfile(typingProfile, frameKey, samples.length) },
      before,
      after,
      notes: [
        "windowListenersByType includes one c64u-traces-updated listener added by this harness",
        "timer counts cover only calls made after the harness installed its counters",
      ],
    };
    fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`search latency (${label}): ${samples.length} samples, p50 ${at(0.5)} ms, p95 ${at(0.95)} ms`);
    console.log(
      `  trace events ${before.page.traceEvents} -> ${after.page.traceEvents}; c64u-traces-updated per keystroke ` +
        `${report.keystrokes.tracesUpdatedPerKeystroke}; rows rendered max ${report.keystrokes.rowsMax}`,
    );
    console.log(
      `  fibers ${before.page.react?.fibers}; query cache ${before.page.react?.queryCacheEntries}; ` +
        `DOM elements ${before.page.domElements}; heap after GC ${before.cdp.heapAfterGc?.usedMb} MB; ` +
        `localStorage ${before.page.localStorage?.chars} chars`,
    );
    console.log(
      `  idle busy ${report.idle.profile.busyMsPerSecond} ms/s; typing busy ${report.typing.profile.busyMsPerSecond} ms/s` +
        (sourcemaps ? `; per keystroke ${JSON.stringify(report.typing.profile.groupsMsPerKeystroke)}` : ""),
    );
    console.log(`  wrote ${base}.json and the two .cpuprofile files`);
  } finally {
    page.close();
  }
};

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`search_latency_profile: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  });
}
