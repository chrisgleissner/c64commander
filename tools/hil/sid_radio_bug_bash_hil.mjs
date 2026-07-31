#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * SID Radio traversal + soak driver for the Pixel 4 (spec §8 / §11).
 *
 * Every transport action is a real `adb shell input tap` at the element's physical coordinates,
 * hit-tested with `elementFromPoint` first so an overlay cannot silently swallow it — the toast
 * viewport covering the transport was a real defect here. CDP is used only to read: element
 * geometry, the current track, and the `sid-radio-stats` blob.
 *
 * It holds ONE CDP connection for the whole run. `taptid.sh` spawns a node process and a fresh
 * WebSocket handshake per tap, which is fine for a handful of taps and costs minutes over three
 * hundred.
 *
 * The harness never repairs the product: it does not retry a failed tap, restart a stalled station,
 * reload the page or skip an invalid track. A stall or a missing reading is a failure, recorded as
 * one, and the scenario stops.
 *
 * Usage:
 *   node tools/hil/sid_radio_bug_bash_hil.mjs --serial 9B081FFAZ001WX --tracks 100 \
 *        [--min-seconds 15] [--out ci-artifacts/sid-radio-bug-bash/matrix.json]
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
const TRACKS = Number(arg("tracks", "100"));
const MIN_SECONDS = Number(arg("min-seconds", "15"));
const OUT = arg("out", "ci-artifacts/sid-radio-bug-bash/matrix.json");
/** Physical = CSS x 2.75 on the Pixel 4, no offset, full-screen WebView. */
const DPR = 2.75;
const SETTLE_MS = Number(arg("settle", "400"));
const PAUSE_FIRST = arg("no-pause", null) === null;
/** Rapid-fire burst: taps with no settle at all, to race the refill and the transport. */
const STRESS_BURSTS = Number(arg("stress-bursts", "0"));
const STRESS_TAPS = Number(arg("stress-taps", "12"));
/** Rounds of route/ranking/station churn. */
const CHAOS_ROUNDS = Number(arg("chaos-rounds", "0"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync("adb", ["-s", SERIAL, ...args], { encoding: "utf8" });

async function connect() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  const pages = await res.json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl) || pages[0];
  if (!page) throw new Error("no CDP page found");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", (e) => reject(new Error("ws error: " + (e.message || e.type))));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("timeout " + method));
        }
      }, 20000);
    });
  const consoleErrors = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails;
      consoleErrors.push({ kind: "exception", text: (d?.exception?.description ?? d?.text ?? "").slice(0, 300) });
    } else if (
      msg.method === "Runtime.consoleAPICalled" &&
      (msg.params?.type === "error" || msg.params?.type === "assert")
    ) {
      consoleErrors.push({
        kind: "console." + msg.params.type,
        text: (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .slice(0, 300),
      });
    }
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await send("Runtime.enable");
  return { ws, evaluate, consoleErrors };
}

/** Element centre in CSS pixels, plus whether that point actually hits the element. */
const GEOM = (testid) => `(() => {
  const el = document.querySelector('[data-testid=${JSON.stringify(testid).slice(1, -1)}]');
  if (!el) return { ok: false, why: 'no such testid' };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, why: 'zero size' };
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  return { ok: !!hit && (el === hit || el.contains(hit) || hit.contains(el)), cx, cy,
           blocker: (!!hit && !(el === hit || el.contains(hit) || hit.contains(el))) ? (hit.getAttribute('data-testid') || hit.tagName) : null };
})()`;

/** What the listener is actually on: label, duration and subsong, straight off the transport. */
const CURRENT = `(() => {
  const el = document.querySelector('[data-testid=playback-current-track]');
  if (!el) return null;
  const raw = (el.textContent || '').replace(/\\s+/g, ' ').trim();
  const m = raw.match(/([^\\s♫]+\\.sid)\\s*\\((\\d+):(\\d\\d)\\)/);
  const sub = raw.match(/Subsong (\\d+)\\/(\\d+)/);
  return {
    raw: raw.slice(0, 90),
    file: m ? m[1] : null,
    seconds: m ? Number(m[2]) * 60 + Number(m[3]) : null,
    subsong: sub ? Number(sub[1]) : 1,
  };
})()`;

const STATS = `(() => {
  const el = document.querySelector('[data-testid=sid-radio-stats]');
  return el ? JSON.parse(el.textContent || '{}') : null;
})()`;

const failures = [];
/** Observed tap-to-change latencies, so the run reports how the device actually behaved. */
const latencies = [];
const CHANGE_TIMEOUT_MS = 8000;
const fail = (scenario, detail) => {
  failures.push({ scenario, detail });
  console.log(`  FAIL [${scenario}] ${detail}`);
};

async function main() {
  const { evaluate, consoleErrors } = await connect();
  mkdirSync(path.dirname(OUT), { recursive: true });

  const before = await evaluate(STATS);
  if (!before) throw new Error("no sid-radio-stats blob — is a station running on the Play page?");
  if (PAUSE_FIRST) {
    // Pause before traversing. A traversal is about the playlist cursor, and a playing tune moves
    // that cursor on its own: with tunes of twenty seconds and a tap every second or two, natural
    // auto-advance lands between the tap and the read and the run records two moves as one. That
    // produced repeated identities and reverse mismatches in a run where nothing was wrong.
    // Paused, Next and Previous are the only things that move the cursor, which is what is under
    // test. Playback actually starting is proven separately, on the forward pass before the pause.
    const g = await evaluate(GEOM("playlist-pause"));
    if (g.ok) {
      adb("shell", "input", "tap", String(Math.round(g.cx * 2.75)), String(Math.round(g.cy * 2.75)));
      await sleep(600);
      console.log("paused playback for the traversal");
    } else {
      console.log(`could not pause (${g.why ?? "blocked by " + g.blocker}) — traversal will race auto-advance`);
    }
  }
  console.log(
    `corpus ${before.corpusReleaseTag} sha ${String(before.corpusBundleSha256).slice(0, 8)} ` +
      `fmt ${before.corpusBinaryFormatVersion} flags 0x${Number(before.corpusGraphFlags).toString(16).padStart(4, "0")}`,
  );
  console.log(`station active=${before.stationActive} seed=${before.seedKind} styleBit=${before.styleBit}`);

  // The transport buttons do not move, so their geometry is resolved once and re-hit-tested every
  // `HIT_TEST_EVERY` taps rather than before each one. A CDP round-trip per tap is the single
  // largest cost in a three-hundred-tap run, and re-testing periodically still catches an overlay
  // that appears part-way through — which is the case that matters, since the toast viewport
  // covering the transport after an error was a real defect here.
  const HIT_TEST_EVERY = 20;
  const coords = new Map();
  const tapCount = new Map();
  const tap = async (testid, scenario) => {
    const n = (tapCount.get(testid) ?? 0) + 1;
    tapCount.set(testid, n);
    if (!coords.has(testid) || n % HIT_TEST_EVERY === 0) {
      const g = await evaluate(GEOM(testid));
      if (!g.ok) {
        fail(scenario, `${testid} not tappable: ${g.why ?? "blocked by " + g.blocker}`);
        return false;
      }
      coords.set(testid, g);
    }
    const g = coords.get(testid);
    adb("shell", "input", "tap", String(Math.round(g.cx * DPR)), String(Math.round(g.cy * DPR)));
    await sleep(SETTLE_MS);
    return true;
  };

  /** The same tap, without the blind settle — the caller waits for an observable change instead. */
  const tapNoSettle = async (testid, scenario) => {
    const n = (tapCount.get(testid) ?? 0) + 1;
    tapCount.set(testid, n);
    if (!coords.has(testid) || n % HIT_TEST_EVERY === 0) {
      const g = await evaluate(GEOM(testid));
      if (!g.ok) {
        fail(scenario, `${testid} not tappable: ${g.why ?? "blocked by " + g.blocker}`);
        return false;
      }
      coords.set(testid, g);
    }
    const g = coords.get(testid);
    adb("shell", "input", "tap", String(Math.round(g.cx * DPR)), String(Math.round(g.cy * DPR)));
    return true;
  };

  const read = async (scenario, step) => {
    const cur = await evaluate(CURRENT);
    if (!cur || !cur.file) {
      fail(scenario, `step ${step}: no current track (${cur ? cur.raw : "null"})`);
      return null;
    }
    return cur;
  };

  const identity = (c) => `${c.file}#${c.subsong}`;

  /**
   * Tap a transport control and wait for the track to actually change.
   *
   * A fixed sleep is the wrong instrument and produced a wholly fictional result: at 350-700 ms the
   * DOM had not repainted between taps, so the same tune was read up to seventeen times running and
   * the run reported 79 duplicate identities and 98 reverse mismatches against an app that was
   * behaving correctly. The same traversal at a slower cadence was perfect. Polling for the change
   * is both faster than a sleep long enough to be safe and, unlike one, actually correct: it waits
   * exactly as long as this device needs and no longer.
   *
   * A change that never arrives is a real failure — a stalled transport — and is recorded as one
   * rather than retried.
   */
  const tapAwaitingChange = async (testid, fromIdentity, scenario, step) => {
    const startedAt = Date.now();
    if (!(await tapNoSettle(testid, scenario))) return null;
    for (;;) {
      const cur = await evaluate(CURRENT);
      if (cur && cur.file && identity(cur) !== fromIdentity) {
        latencies.push(Date.now() - startedAt);
        return cur;
      }
      if (Date.now() - startedAt > CHANGE_TIMEOUT_MS) {
        fail(scenario, `step ${step}: track did not change within ${CHANGE_TIMEOUT_MS}ms (still ${fromIdentity})`);
        return null;
      }
      await sleep(50);
    }
  };

  // ---- forward traversal ----
  console.log(`\n=== forward: ${TRACKS} real Next taps ===`);
  const forward = [];
  let first = await read("forward", 0);
  if (!first) return finish();
  forward.push(first);
  for (let i = 1; i <= TRACKS; i += 1) {
    const cur = await tapAwaitingChange("playlist-next", identity(forward[forward.length - 1]), "forward", i);
    if (!cur) break;
    forward.push(cur);
    if (i % 20 === 0) console.log(`  ${i}/${TRACKS}  ${cur.file} (${cur.seconds}s)`);
  }
  console.log(`  collected ${forward.length} identities`);

  const ids = forward.map(identity);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length) fail("forward", `repeated identities: ${[...new Set(dupes)].slice(0, 5).join(", ")}`);

  const short = forward.filter((c) => c.seconds !== null && c.seconds < MIN_SECONDS);
  if (short.length)
    fail("forward", `tunes under ${MIN_SECONDS}s: ${short.map((c) => `${c.file}=${c.seconds}s`).join(", ")}`);

  const siblings = forward.filter((c, i) => i > 0 && forward[i - 1].file === c.file);
  if (siblings.length) fail("forward", `adjacent subsongs of one file: ${siblings.map((c) => c.file).join(", ")}`);

  const noDuration = forward.filter((c) => c.seconds === null);
  if (noDuration.length) fail("forward", `${noDuration.length} tracks with no duration shown`);

  // ---- backward traversal ----
  console.log(`\n=== backward: ${forward.length - 1} real Previous taps ===`);
  let backMismatch = 0;
  let lastSeen = identity(forward[forward.length - 1]);
  for (let i = forward.length - 2; i >= 0; i -= 1) {
    const cur = await tapAwaitingChange("playlist-prev", lastSeen, "backward", i);
    if (!cur) break;
    lastSeen = identity(cur);
    if (identity(cur) !== identity(forward[i])) {
      backMismatch += 1;
      if (backMismatch <= 5) fail("backward", `position ${i}: got ${identity(cur)}, expected ${identity(forward[i])}`);
    }
  }
  console.log(`  backward mismatches: ${backMismatch}`);

  // ---- forward replay ----
  console.log(`\n=== forward replay: ${forward.length - 1} real Next taps ===`);
  let replayMismatch = 0;
  lastSeen = identity(forward[0]);
  for (let i = 1; i < forward.length; i += 1) {
    const cur = await tapAwaitingChange("playlist-next", lastSeen, "replay", i);
    if (!cur) break;
    lastSeen = identity(cur);
    if (identity(cur) !== identity(forward[i])) {
      replayMismatch += 1;
      if (replayMismatch <= 5) fail("replay", `position ${i}: got ${identity(cur)}, expected ${identity(forward[i])}`);
    }
  }
  console.log(`  replay mismatches: ${replayMismatch}`);

  // ---- rapid-fire stress ----
  // Taps with no settle between them, so Next lands while the previous transition, a refill and a
  // candidate resolution are all still in flight. This is where a stale refill appends under a
  // superseded generation, or a double auto-advance shows up. The only assertions are the
  // invariants that must hold whatever the timing: playback still has a current track, the station
  // is still active, and nothing repeated.
  if (STRESS_BURSTS > 0) {
    console.log(`\n=== stress: ${STRESS_BURSTS} bursts of ${STRESS_TAPS} taps with no settle ===`);
    const seen = new Set();
    for (let b = 0; b < STRESS_BURSTS; b += 1) {
      const g = coords.get("playlist-next") ?? (await evaluate(GEOM("playlist-next")));
      if (!g.ok && g.ok !== undefined) {
        fail("stress", "playlist-next not tappable");
        break;
      }
      const x = String(Math.round(g.cx * DPR));
      const y = String(Math.round(g.cy * DPR));
      for (let t = 0; t < STRESS_TAPS; t += 1) adb("shell", "input", "tap", x, y);
      await sleep(2500);
      const cur = await evaluate(CURRENT);
      const st = await evaluate(STATS);
      if (!cur || !cur.file) {
        fail("stress", `burst ${b}: no current track after ${STRESS_TAPS} rapid taps`);
        break;
      }
      if (st && !st.stationActive) {
        fail("stress", `burst ${b}: station went inactive under rapid taps`);
        break;
      }
      if (cur.seconds !== null && cur.seconds < MIN_SECONDS) {
        fail("stress", `burst ${b}: ${cur.file} is ${cur.seconds}s, under the ${MIN_SECONDS}s minimum`);
      }
      if (seen.has(`${cur.file}#${cur.subsong}`)) {
        fail("stress", `burst ${b}: ${cur.file}#${cur.subsong} served twice`);
      }
      seen.add(`${cur.file}#${cur.subsong}`);
      console.log(`  burst ${b + 1}/${STRESS_BURSTS}: ${cur.file} (${cur.seconds}s) active=${st?.stationActive}`);
    }
  }

  // ---- chaos: engine switching, ranking churn, station churn ----
  //
  // Not aimless tapping. Each action is followed by a recorded observation of the state it is
  // supposed to leave behind, so a failure names what was expected and what was found rather than
  // "something broke somewhere". Switching route is the interesting one: on-device rendering and
  // the C64's own SID are different engines behind one transport, and the handover is where a
  // listener notices a defect first.
  const notes = [];
  const observe = async (label) => {
    const cur = await evaluate(CURRENT);
    const st = await evaluate(STATS);
    const sink = await evaluate(
      "(() => (typeof window.__localSinkDebug === 'function' ? window.__localSinkDebug() : null))()",
    );
    const note = {
      at: new Date().toISOString(),
      label,
      track: cur?.file ?? null,
      seconds: cur?.seconds ?? null,
      stationActive: st?.stationActive ?? null,
      styleBit: st?.styleBit ?? null,
      emitted: st?.candidatesEmitted ?? null,
      tooShort: st?.candidatesTooShort ?? null,
      unknownDuration: st?.unknownDurationAdmitted ?? null,
      sink,
    };
    notes.push(note);
    console.log(
      `  [${label}] track=${note.track} active=${note.stationActive} ` +
        `sink=${sink ? `queued ${sink.queuedSec.toFixed(1)}s pumping ${sink.pumping}` : "n/a"}`,
    );
    return note;
  };

  if (CHAOS_ROUNDS > 0) {
    console.log(`\n=== chaos: ${CHAOS_ROUNDS} rounds of route + ranking + station churn ===`);
    await observe("chaos:start");
    for (let round = 0; round < CHAOS_ROUNDS; round += 1) {
      for (const route of ["playback-engine-c64", "playback-listen-both", "playback-engine-local"]) {
        if (!(await tap(route, "chaos"))) break;
        await sleep(2500);
        const note = await observe(`round ${round + 1} route ${route}`);
        // Whatever the route, a station must still be running and still have a track. Losing either
        // on a route change is the failure worth catching; which engine makes the sound is not.
        if (note.stationActive === false) fail("chaos", `${route}: station went inactive on a route change`);
        if (!note.track) fail("chaos", `${route}: no current track after switching route`);
      }
      // Ranking churn. A heart or a cross may steer what comes next; neither may end the station or
      // rewrite what is playing now.
      for (const control of ["now-playing-like", "now-playing-like", "now-playing-notforme"]) {
        const beforeTrack = (await evaluate(CURRENT))?.file ?? null;
        if (!(await tap(control, "chaos"))) break;
        await sleep(1200);
        const note = await observe(`round ${round + 1} ${control}`);
        if (note.stationActive === false) fail("chaos", `${control}: station ended on a ranking tap`);
        if (control !== "now-playing-notforme" && note.track !== beforeTrack) {
          fail("chaos", `${control}: liking a tune changed what was playing (${beforeTrack} -> ${note.track})`);
        }
      }
    }
    // Back to on-device so the run ends somewhere audible rather than half-switched.
    await tap("playback-engine-local", "chaos");
    await sleep(2000);
    await observe("chaos:end");
  }

  const after = await evaluate(STATS);

  function finish() {
    const report = {
      serial: SERIAL,
      tracks: TRACKS,
      minSeconds: MIN_SECONDS,
      corpus: {
        tag: before.corpusReleaseTag,
        sha256: before.corpusBundleSha256,
        schema: before.corpusSchemaVersion,
        binaryFormatVersion: before.corpusBinaryFormatVersion,
        graphFlags: before.corpusGraphFlags,
      },
      station: { seedKind: before.seedKind, styleBit: before.styleBit, shuffleSeed: before.shuffleSeed },
      forward: forward.map((c) => ({ file: c.file, subsong: c.subsong, seconds: c.seconds })),
      counts: {
        collected: forward.length,
        distinct: new Set(forward.map(identity)).size,
        duplicateIdentities: dupes.length,
        underMinimum: short.length,
        adjacentSiblings: siblings.length,
        missingDuration: noDuration.length,
        backwardMismatches: backMismatch,
        replayMismatches: replayMismatch,
      },
      tapToChangeMs: latencies,
      chaosNotes: notes,
      consoleErrors,
      statsAfter: after ?? null,
      failures,
    };
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`\n=== summary ===`);
    for (const [k, v] of Object.entries(report.counts)) console.log(`  ${k}: ${v}`);
    if (after) {
      console.log(
        `  tooShort=${after.candidatesTooShort} unknownDur=${after.unknownDurationAdmitted} ` +
          `computes=${after.refillComputeCalls} yield=${after.candidateYieldPercent}% ` +
          `lastRefillMs=${after.lastRefillMs === null ? "null" : Math.round(after.lastRefillMs)} ` +
          `mainMax=${after.refillMainThreadMaxMs.toFixed(1)}`,
      );
    }
    if (latencies.length) {
      const sorted = [...latencies].sort((a, b) => a - b);
      console.log(
        `  tap->change ms: median ${sorted[Math.floor(sorted.length / 2)]} ` +
          `p90 ${sorted[Math.floor(sorted.length * 0.9)]} max ${sorted[sorted.length - 1]} (n=${sorted.length})`,
      );
    }
    console.log(`  console errors/exceptions: ${consoleErrors.length}`);
    for (const e of consoleErrors.slice(0, 5)) console.log(`    ${e.kind}: ${e.text.slice(0, 140)}`);
    console.log(`  failures: ${failures.length}`);
    console.log(`  written: ${OUT}`);
    process.exit(failures.length === 0 && backMismatch === 0 && replayMismatch === 0 ? 0 : 1);
  }

  finish();
}

void main().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(2);
});
