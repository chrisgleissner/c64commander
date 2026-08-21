#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Exhaustive keypad-only reachability and layout gate, driven by real hardware key events.
 *
 * The target device is the Commodore Callback 8020: a 480x640 / DPR 1.5 panel (320 x 426.7 CSS
 * px), no Google services, and a physical keypad with the touchscreen disabled by default. The
 * app therefore has to be fully operable with the D-pad, the soft keys and the number keys, and
 * every control has to be both reachable by the focus ring and legible at that size.
 *
 * This walks the ring with `adb shell input keyevent` — the same key codes the Callback's keypad
 * produces — and reads the resulting state over CDP after every press. Nothing here dispatches a
 * synthetic DOM event, so a control that only responds to a tap fails the way it would on the
 * real device.
 *
 * What it asserts, per route and per dialog:
 *   - every interactive element in the scope is reached by the ring (no unreachable control);
 *   - the ring terminates: it wraps to its first stop rather than growing without bound;
 *   - every stop is scrolled into view when it is selected (viewport-follows-focus);
 *   - every stop's effective hit area clears 44x44 CSS px, measuring the wrapping <label> where
 *     one exists, because a real tap on the label activates the control;
 *   - no rendered text sits below the 14 px floor;
 *   - nothing overflows the viewport horizontally.
 *
 * Usage:
 *   node tools/hil/keypad_reachability.mjs --package uk.gleissner.c64commander \
 *     [--routes 1,2,3,4,5,6] [--max-steps 120] [--out artifacts/keypad-reachability.json]
 *
 * Requires an existing `adb forward tcp:<CDP_PORT> localabstract:webview_devtools_remote_<pid>`.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORT = process.env.CDP_PORT || "9333";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PACKAGE = arg("package", "uk.gleissner.c64commander");
const ROUTE_KEYS = arg("routes", "1,2,3,4,5,6")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => n >= 1 && n <= 6);
const MAX_STEPS = Number(arg("max-steps", "140"));
const OUT = arg("out", "");

/** Android key codes. The Callback's keypad produces exactly these. */
const KEY = { UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22, CENTER: 23, BACK: 4, DIGIT: (d) => 7 + d };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (code) => execFileSync("adb", ["shell", "input", "keyevent", String(code)], { stdio: "ignore" });

async function connect() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  const pages = await res.json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl) || pages[0];
  if (!page) throw new Error("no CDP page found - is the adb forward up?");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    clearTimeout(slot.timer);
    if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
    else slot.resolve(msg.result);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", (e) => reject(new Error("ws error: " + (e.message || e.type))));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      // The timer is stored on the pending entry and cleared when the reply lands. Left uncancelled
      // it survives every successful call, and a gate run makes hundreds of them.
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error("timeout " + method));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result?.value;
  };
  return { ws, evaluate };
}

/**
 * Read everything one step of the walk needs, in a single round trip.
 *
 * The effective hit area is the wrapping <label> where there is one: the checkbox and switch
 * controls render a small box inside a full-width label, and a real tap on the label does
 * activate them — verified on device — so measuring the control's own box reports false
 * violations.
 */
const STATE_EXPR = String.raw`(() => {
  const INTERACTIVE = 'button,a[href],input:not([type=file]),select,textarea,[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="option"],[role="slider"],[tabindex]:not([tabindex="-1"])';
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const idOf = (e) => {
    const t = e.getAttribute('data-testid');
    if (t) return '#' + t;
    const txt = (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return e.tagName.toLowerCase() + (txt ? ':' + txt : '') + '@' + Math.round(e.getBoundingClientRect().top);
  };
  const hitBox = (e) => {
    const label = e.closest('label');
    const target = label && label.contains(e) ? label : e;
    const r = target.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), viaLabel: target !== e };
  };
  // The active scope is the topmost open overlay, else the page body.
  const overlays = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')].filter(visible);
  const scopeEl = overlays.length ? overlays[overlays.length - 1] : document.body;
  const scopeName = overlays.length ? (scopeEl.getAttribute('data-testid') || scopeEl.getAttribute('role') || 'overlay') : 'page';

  const inventory = [...scopeEl.querySelectorAll(INTERACTIVE)]
    .filter(visible)
    .filter((e) => !e.disabled && e.getAttribute('aria-hidden') !== 'true')
    // A control inside a label is represented by its label; the ring stops on one of them.
    .map((e) => ({ id: idOf(e), tag: e.tagName, box: hitBox(e) }));

  const sel = document.querySelector('[data-key-selected="true"]');
  let current = null;
  if (sel) {
    const r = sel.getBoundingClientRect();
    const box = hitBox(sel);
    current = {
      id: idOf(sel),
      tag: sel.tagName,
      role: sel.getAttribute('role'),
      text: (sel.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 48),
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
      vh: innerHeight,
      editable: sel.matches('input,textarea,[contenteditable="true"]'),
      // A card selected as one ring stop can be taller than the 218 px content area; the user then
      // descends into it. What must be true is that its START is on screen and it is not off to one
      // side — requiring the whole box would report every long card as a fault.
      inView:
        r.top >= -1 &&
        r.left >= -1 &&
        r.right <= innerWidth + 1 &&
        (r.bottom <= innerHeight + 1 || r.height > innerHeight - 1),
      isGroup: [...sel.querySelectorAll(INTERACTIVE)].filter(visible).filter((e) => !e.disabled).length > 0,
      descendants: [...sel.querySelectorAll(INTERACTIVE)]
        .filter(visible)
        .filter((e) => !e.disabled && e.getAttribute('aria-hidden') !== 'true')
        .map(idOf),
      hitW: box.w, hitH: box.h, viaLabel: box.viaLabel,
      fontSize: Math.round(parseFloat(getComputedStyle(sel).fontSize) * 10) / 10,
    };
  }

  // Rendered text below the 14 px floor, on elements that own their text node.
  const tiny = [];
  for (const e of scopeEl.querySelectorAll('*')) {
    if (!visible(e)) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 14) tiny.push({ el: idOf(e), fontSize: Math.round(fs * 10) / 10 });
  }

  return {
    route: location.pathname,
    vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
    profile: document.documentElement.dataset.displayProfile || null,
    scope: scopeName,
    overlayDepth: overlays.length,
    current,
    inventory,
    tiny: tiny.slice(0, 20),
    tinyCount: tiny.length,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
})()`;

/** Walk the ring in the current scope until it wraps, recording every stop. */
async function walkScope(evaluate, { maxSteps = MAX_STEPS, settleMs = 260 } = {}) {
  const stops = [];
  const seen = new Map();
  let wrapped = false;
  let first = null;
  for (let step = 0; step < maxSteps; step += 1) {
    key(KEY.DOWN);
    await sleep(settleMs);
    const state = await evaluate(STATE_EXPR);
    if (!state.current) {
      stops.push({ step, id: null, note: "no ring selection" });
      continue;
    }
    const id = state.current.id;
    if (first === null) first = id;
    else if (id === first && stops.length > 1) {
      wrapped = true;
      break;
    }
    if (seen.has(id)) {
      // Revisited a non-first stop: the ring is cycling inside a subset.
      const prior = seen.get(id);
      if (step - prior <= 1) {
        stops.push({ step, id, note: "ring did not advance" });
        break;
      }
    }
    seen.set(id, step);
    stops.push({ step, ...state.current });
  }
  const final = await evaluate(STATE_EXPR);
  return { stops, wrapped, final };
}

/**
 * Walk what OK opens on each card, then Back out.
 *
 * Navigation here is "OK to go in, Back to go out": the top-level ring traverses cards, and a
 * card's own controls only join the ring once it has been descended into. A sweep that never
 * pressed OK would report every one of those controls as unreachable.
 */
async function walkDescendants(evaluate, stops, { settleMs = 260 } = {}) {
  const reached = new Set();
  for (const stop of stops) {
    if (!stop.isGroup || !stop.id) continue;
    // Re-select this card: the ring has moved on since it was recorded.
    let landed = false;
    for (let attempt = 0; attempt < MAX_STEPS && !landed; attempt += 1) {
      const state = await evaluate(STATE_EXPR);
      if (state.current?.id === stop.id) {
        landed = true;
        break;
      }
      key(KEY.DOWN);
      await sleep(settleMs);
    }
    if (!landed) continue;

    const before = await evaluate(STATE_EXPR);
    key(KEY.CENTER);
    await sleep(settleMs + 240);
    const inside = await evaluate(STATE_EXPR);
    // OK on a card either descends into it or activates it. If the route changed or an overlay
    // opened, this was an activation, not a descend — undo it and move on. The route to compare
    // against is the one read immediately BEFORE the press: an earlier version compared against
    // `stops.routePath`, which is a property of an ARRAY and therefore always undefined, so the
    // guard collapsed to the overlay check and a route change with no overlay walked the wrong page.
    if (inside.route !== before.route || inside.overlayDepth > before.overlayDepth) {
      key(KEY.BACK);
      await sleep(settleMs + 200);
      continue;
    }
    for (let step = 0; step < 40; step += 1) {
      const state = await evaluate(STATE_EXPR);
      if (state.current?.id) reached.add(state.current.id);
      key(KEY.DOWN);
      await sleep(settleMs);
      const next = await evaluate(STATE_EXPR);
      if (!next.current?.id || reached.has(next.current.id)) break;
    }
    key(KEY.BACK);
    await sleep(settleMs + 200);
  }
  return reached;
}

function grade(routeLabel, { stops, wrapped, final }, descended = new Set()) {
  const visited = new Set([...stops.map((s) => s.id).filter(Boolean), ...descended]);
  // A card whose only interactive child is its own toggle is activated by OK directly rather than
  // descended into, so the ring never stops on that child. It is reached — through its card.
  for (const stop of stops) {
    if (stop.descendants?.length === 1) visited.add(stop.descendants[0]);
  }
  const unreachable = final.inventory.filter((i) => !visited.has(i.id)).map((i) => i.id);
  const offScreen = stops.filter((s) => s.inView === false).map((s) => ({ id: s.id, rect: s.rect, vh: s.vh }));
  const smallHits = stops
    .filter((s) => s.hitW !== undefined && (s.hitW < 44 || s.hitH < 44))
    .map((s) => ({ id: s.id, w: s.hitW, h: s.hitH, viaLabel: s.viaLabel }));
  return {
    route: routeLabel,
    path: final.route,
    viewport: `${final.vw}x${final.vh}@${final.dpr}`,
    profile: final.profile,
    scope: final.scope,
    stops: stops.length,
    wrapped,
    unreachable,
    offScreen,
    smallHits,
    tinyText: final.tiny,
    tinyCount: final.tinyCount,
    hScroll: final.hScroll,
    pass:
      unreachable.length === 0 &&
      offScreen.length === 0 &&
      smallHits.length === 0 &&
      final.tinyCount === 0 &&
      !final.hScroll &&
      wrapped,
  };
}

/**
 * Get the WebView back to its full height before measuring anything.
 *
 * The Pixel that stands in for the Callback has a soft keyboard, and focusing a text field shrinks
 * the WebView from 427 to 133 CSS px — after which every stop is "off-screen" and the whole sweep
 * is noise. The Callback itself has no IME (physical keypad plus T9), so this is a property of the
 * stand-in, not of the app.
 */
async function dismissKeyboard(evaluate, expectedHeight) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await evaluate(STATE_EXPR);
    if (state.vh >= expectedHeight - 8) return state;
    key(KEY.BACK);
    await sleep(400);
  }
  return evaluate(STATE_EXPR);
}

async function main() {
  const { ws, evaluate } = await connect();
  const results = [];
  try {
    let boot = await evaluate(STATE_EXPR);
    // The tallest height seen is the real viewport; anything less means the IME is up.
    const fullHeight = Math.round((boot.vw * 640) / 480);
    boot = await dismissKeyboard(evaluate, fullHeight);
    console.log(
      `viewport ${boot.vw}x${boot.vh} @ DPR ${boot.dpr} - display profile "${boot.profile}" - package ${PACKAGE}`,
    );
    if (boot.vh < fullHeight - 8) {
      throw new Error(
        `viewport is ${boot.vw}x${boot.vh}, expected about ${boot.vw}x${fullHeight}. Something is still covering the WebView (usually the soft keyboard); nothing measured here would be meaningful.`,
      );
    }
    if (boot.profile !== "compact") {
      // Fatal, not a warning. Every assertion below — the 44x44 hit areas, the 14px text floor, the
      // horizontal-overflow check — is scoped to the compact panel. Grading a different layout and
      // reporting a result for it is exactly the "gate that cannot report the fault it exists to
      // catch" shape this tool was written against.
      throw new Error(
        `display profile is "${boot.profile}", not "compact" — refusing to grade the wrong layout. ` +
          `The profile is frozen at mount unless screen orientation is Auto, so set the geometry ` +
          `(wm size 480x640; wm density 240) and then force-stop and relaunch the app.`,
      );
    }
    // Engage key-navigation modality; until a key arrives the app is in pointer modality and
    // renders no ring highlight at all.
    key(KEY.DOWN);
    await sleep(400);

    for (const digit of ROUTE_KEYS) {
      // Leave any field or overlay first. A digit typed while a text input has focus is claimed by
      // T9, not by the tab shortcut, so without this the sweep stays wherever it happened to stop.
      let switched = false;
      for (let attempt = 0; attempt < 3 && !switched; attempt += 1) {
        for (let back = 0; back < 3; back += 1) {
          key(KEY.BACK);
          await sleep(220);
        }
        const before = (await dismissKeyboard(evaluate, fullHeight)).route;
        key(KEY.DIGIT(digit));
        await sleep(1000);
        const after = await dismissKeyboard(evaluate, fullHeight);
        switched = after.overlayDepth === 0 && (after.route !== before || ROUTE_KEYS.indexOf(digit) === 0);
        if (!switched)
          console.log(`  (retry ${attempt + 1}: digit ${digit} did not switch route, still ${after.route})`);
      }
      key(KEY.DOWN);
      await sleep(300);
      const walk = await walkScope(evaluate);
      const descended = await walkDescendants(evaluate, walk.stops);
      const graded = grade(`digit-${digit}`, walk, descended);
      results.push({ ...graded, descended: [...descended], stopDetail: walk.stops });
      const flag = graded.pass ? "PASS" : "FAIL";
      console.log(
        `${flag}  ${graded.path.padEnd(10)} stops=${String(graded.stops).padStart(3)} wrapped=${graded.wrapped} unreachable=${graded.unreachable.length} offScreen=${graded.offScreen.length} smallHit=${graded.smallHits.length} tinyText=${graded.tinyCount} hScroll=${graded.hScroll}`,
      );
      for (const u of graded.unreachable.slice(0, 8)) console.log(`        unreachable: ${u}`);
      for (const o of graded.offScreen.slice(0, 8))
        console.log(`        off-screen : ${o.id} ${JSON.stringify(o.rect)}`);
      for (const s of graded.smallHits.slice(0, 8)) console.log(`        small hit  : ${s.id} ${s.w}x${s.h}`);
      for (const t of graded.tinyText.slice(0, 8)) console.log(`        tiny text  : ${t.el} ${t.fontSize}px`);
    }
  } finally {
    ws.close();
  }

  const failed = results.filter((r) => !r.pass);
  const summary = { package: PACKAGE, results, passed: results.length - failed.length, failed: failed.length };
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(summary, null, 2));
    console.log(`\nwrote ${OUT}`);
  }
  console.log(`\nKEYPAD REACHABILITY: ${summary.passed}/${results.length} routes pass`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
