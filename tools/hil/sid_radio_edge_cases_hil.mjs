#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * SID Radio edge cases, on real hardware.
 *
 * The traversal harness (`sid_radio_bug_bash_hil.mjs`) answers "does the cursor move correctly".
 * This answers the questions a listener would actually hit: does every way of starting a station
 * work, does a station survive being interrupted, does the minimum-length rule hold across all of
 * them, and does anything ever serve the same tune twice.
 *
 * Two principles learned the hard way in this campaign, both encoded here:
 *
 *  - **Assert on the app's own record where one exists.** `sid-radio-stats` publishes the ordinals
 *    the station emitted. That answers the duplicate question without needing the harness to drive
 *    the transport perfectly, which four separate harness defects proved it cannot be relied on to
 *    do.
 *  - **Never tap a coordinate that was read before the layout settled.** The transport re-flows as
 *    each track's metadata arrives; a rect read and then tapped lands on whatever slid into that
 *    spot.
 *
 * Usage:
 *   node tools/hil/sid_radio_edge_cases_hil.mjs --serial 9B081FFAZ001WX
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "9333";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SERIAL = arg("serial", "9B081FFAZ001WX");
const OUT = arg("out", "ci-artifacts/sid-radio-bug-bash/edge-cases.json");
const MIN_SECONDS = Number(arg("min-seconds", "15"));
const DPR = 2.75;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync("adb", ["-s", SERIAL, ...a], { encoding: "utf8" });

const results = [];
const record = (scenario, ok, detail) => {
  results.push({ scenario, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${scenario.padEnd(46)} ${detail}`);
};

async function connect() {
  const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const target = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl) || pages[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push((m.params?.exceptionDetails?.exception?.description ?? "").slice(0, 160));
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id: id++, method, params }));
    });
  await send("Runtime.enable");
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;
  return { evaluate, consoleErrors };
}

const GEOM = (testid) => `(() => {
  const el = document.querySelector('[data-testid=${testid}]');
  if (!el) return { ok: false, why: 'missing' };
  // Scroll first, then measure. The launcher sheet is taller than the phone, so its last controls
  // sit below the fold; measuring without scrolling reads a coordinate that is on screen but is not
  // this element, and \`elementFromPoint\` then reports it as blocked by whatever really is there.
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { ok: false, why: 'zero size' };
  if (r.top < 0 || r.bottom > innerHeight) return { ok: false, why: 'still off screen' };
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  const blocked = !(hit && (el === hit || el.contains(hit) || hit.contains(el)));
  return { ok: !blocked, cx, cy, blocker: blocked ? (hit && (hit.getAttribute('data-testid') || hit.tagName)) : null };
})()`;

const STATS = `(() => { const e = document.querySelector('[data-testid=sid-radio-stats]');
  return e ? JSON.parse(e.textContent || '{}') : null; })()`;
const CURRENT = `(() => { const e = document.querySelector('[data-testid=playback-current-track]');
  if (!e) return null; const raw = (e.textContent || '').replace(/\\s+/g, ' ').trim();
  const m = raw.match(/^♫?\\s*(.+?)\\s*(?:·|\\()/);
  const len = raw.match(/·\\s*(\\d+):(\\d\\d)\\s*$/);
  return { raw: raw.slice(0, 110), title: m ? m[1] : raw.slice(0, 40),
           seconds: len ? Number(len[1]) * 60 + Number(len[2]) : null }; })()`;

async function main() {
  const { evaluate, consoleErrors } = await connect();
  mkdirSync(path.dirname(OUT), { recursive: true });

  /** Tap an element only once two consecutive reads agree on where it is. */
  const tap = async (testid, label) => {
    let previous = null;
    for (let i = 0; i < 15; i += 1) {
      const g = await evaluate(GEOM(testid));
      if (g.ok && previous && previous.cx === g.cx && previous.cy === g.cy) {
        adb("shell", "input", "tap", String(Math.round(g.cx * DPR)), String(Math.round(g.cy * DPR)));
        return true;
      }
      previous = g.ok ? g : null;
      await sleep(140);
    }
    record(label, false, `${testid} never settled or stayed blocked`);
    return false;
  };

  /** Close anything modal, so a scenario is not judged against a covered page. */
  const clearOverlays = async () => {
    for (let i = 0; i < 3; i += 1) {
      const open = await evaluate(`(() => !!document.querySelector('[role=dialog],[role=alertdialog]'))()`);
      if (!open) return;
      const g = await evaluate(`(() => {
        const d = document.querySelector('[role=dialog],[role=alertdialog]');
        const b = [...d.querySelectorAll('button')].find((x) => /close|not now|dismiss/i.test(x.textContent || '') || /close/i.test(x.getAttribute('aria-label') || ''));
        if (!b) return null; const r = b.getBoundingClientRect();
        return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
      if (!g) return;
      adb("shell", "input", "tap", String(Math.round(g.cx * DPR)), String(Math.round(g.cy * DPR)));
      await sleep(900);
    }
  };

  const statsNow = () => evaluate(STATS);

  console.log("=== SID Radio edge cases ===\n");
  await clearOverlays();

  const before = await statsNow();
  if (!before) {
    record("preconditions", false, "no sid-radio-stats blob on the page");
    return finish();
  }
  record(
    "corpus identity is reported",
    before.corpusReleaseTag === "0.8.2" && before.corpusBinaryFormatVersion === 2 && before.corpusGraphFlags === 6,
    `tag ${before.corpusReleaseTag} fmt ${before.corpusBinaryFormatVersion} flags 0x${Number(before.corpusGraphFlags).toString(16).padStart(4, "0")}`,
  );

  // --- every entry point starts a station that can produce tracks ---
  // Order matters. The "similar to this tune" tiles only exist once a SID is playing — the launcher
  // renders that whole section on `songSeedLabel && onStartSong` — which is also the only order a
  // listener can reach them in. Running them first tested a section that was correctly absent and
  // reported the app as broken.
  const entryPoints = [
    ["sid-radio-style-1", "mood station"],
    ["sid-radio-surprise", "surprise station"],
    ["sid-radio-song-mood-all", "song station, all moods"],
    ["sid-radio-song-mood-2", "song station constrained to one mood"],
  ];
  /**
   * Put the app where a listener has to be to ask for "a station like this tune".
   *
   * The launcher only offers the song seeds when a Song station is already running, or when no
   * station is running and a SID is playing — `sidRadioSongSeedLabel` in `PlayFilesPage`. During a
   * mood or surprise station there is no song seed to name, which is correct, so the harness has to
   * stop the station and start a tune of its own before those entry points mean anything.
   */
  const seedFromPlayingTune = async () => {
    const stats = await statsNow();
    if (stats?.stationActive) {
      await tap("sid-radio-stop", "seed setup: stop the running station");
      await sleep(2000);
    }
    await clearOverlays();
    await tap("playlist-play", "seed setup: play a tune");
    for (let i = 0; i < 20; i += 1) {
      const seeded = await evaluate(
        `(() => { const t = document.querySelector('[data-testid=playback-current-title]');
          return !!(t && t.textContent && t.textContent.trim()); })()`,
      );
      if (seeded) return true;
      await sleep(500);
    }
    return false;
  };

  for (const [testid, label] of entryPoints) {
    await clearOverlays();
    if (testid.startsWith("sid-radio-song-mood") && !(await seedFromPlayingTune())) {
      record(label, false, "could not get a tune playing to seed a song station from");
      continue;
    }
    if (!(await tap("sid-radio-launcher", label))) continue;
    await sleep(2500);
    const present = await evaluate(`(() => !!document.querySelector('[data-testid=${testid}]'))()`);
    if (!present) {
      record(label, false, `${testid} is not in the launcher — nothing is playing to seed it from?`);
      await clearOverlays();
      continue;
    }
    if (!(await tap(testid, label))) {
      await clearOverlays();
      continue;
    }
    await sleep(16000);
    const s = await statsNow();
    const cur = await evaluate(CURRENT);
    const emitted = s?.candidatesEmitted ?? 0;
    record(label, emitted > 0 && !!cur?.title, `emitted ${emitted}, playing "${cur?.title ?? "none"}"`);

    // The rules that must hold for every station, whatever started it.
    record(
      `${label}: no unknown-duration admissions`,
      (s?.unknownDurationAdmitted ?? 0) === 0,
      `unknownDurationAdmitted=${s?.unknownDurationAdmitted}`,
    );
    const seq = s?.emittedSequence ?? [];
    record(
      `${label}: no repeated ordinal`,
      new Set(seq).size === seq.length,
      `${new Set(seq).size} distinct of ${seq.length}`,
    );
    if (cur?.seconds !== null && cur?.seconds !== undefined) {
      record(`${label}: current tune clears the minimum`, cur.seconds >= MIN_SECONDS, `${cur.seconds}s`);
    }
    if (testid === "sid-radio-song-mood-2") {
      record(`${label}: engine carries the mood`, s?.styleBit === 2, `styleBit=${s?.styleBit}`);
    }
  }

  // --- a station survives being interrupted ---
  await clearOverlays();
  const beforeStop = await statsNow();
  if (await tap("sid-radio-stop", "stop leaves ordinary playback")) {
    await sleep(2500);
    const s = await statsNow();
    record(
      "stop ends the station",
      s?.stationActive === false,
      `stationActive=${s?.stationActive}, transport shuffle re-enabled=${s?.transportShuffleDisabled === false}`,
    );
    record(
      "stop does not lose what the station had emitted",
      (s?.candidatesEmitted ?? 0) >= (beforeStop?.candidatesEmitted ?? 0),
      `emitted ${beforeStop?.candidatesEmitted} -> ${s?.candidatesEmitted}`,
    );
  }

  const after = await statsNow();
  function finish() {
    const failures = results.filter((r) => !r.ok);
    writeFileSync(OUT, JSON.stringify({ serial: SERIAL, results, statsAfter: after ?? null, consoleErrors }, null, 2));
    console.log(`\n=== ${results.length - failures.length}/${results.length} passed ===`);
    console.log(`  console exceptions: ${consoleErrors.length}`);
    for (const e of consoleErrors.slice(0, 4)) console.log(`    ${e}`);
    console.log(`  written: ${OUT}`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
  finish();
}

void main().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(2);
});
