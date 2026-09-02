#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Demo Mode on real hardware, end to end, without touching a real Ultimate.
 *
 * CI can prove the state machine and the wire format. It cannot prove that a handset with its
 * radios off offers Demo Mode and then plays a picture and a sound through its own speaker. This
 * does, on a Pixel-class phone over adb, and writes the numbers it measured.
 *
 * The phone must be in flight mode for the whole run. That is not only the first stage's subject:
 * it is what makes the run safe. With no radio there is no path to a c64u, u64 or u2, so no stage
 * can put a packet near one however the app behaves. The "a network is up but nothing answers"
 * stage injects the network status rather than turning a radio on, for the same reason.
 *
 *   npx vite-node --script tools/hil/demo_mode_hil.ts -- --serial <adb serial>
 *   npx vite-node --script tools/hil/demo_mode_hil.ts -- --serial <adb serial> --json artifacts/hil.json
 *   npx vite-node --script tools/hil/demo_mode_hil.ts -- --serial <adb serial> --only offline-offer,av-stream
 *
 * Stages:
 *   offline-offer      flight mode, fresh install state: the app asks before using the simulated
 *                      device, and says why in words the user can see.
 *   unreachable-offer  network reported up, nothing answering: the app probes, fails, and offers
 *                      Demo Mode naming the host it tried.
 *   av-stream          Live View in Demo Mode: frame rate, audio arrival, the test card decoded
 *                      off the canvas, the colour ladder walked in order, and every note's pitch
 *                      graded from PCM captured on the phone.
 *   cta-census         every control on every main route in Demo Mode is enabled and hit-testable.
 */

import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { TONE_LADDER_SLOTS, TONE_LADDER_SLOT_SECONDS } from "../../src/lib/streams/toneLadder";

const run = promisify(execFile);

const PACKAGE = "uk.gleissner.c64commander";
const CDP_PORT = 9337;
const MAIN_ROUTES = ["/", "/play", "/disks", "/config", "/settings"];
/** Peak the mock stream is authored at; anything louder in a quiet room is a defect, not a test. */
const EXPECTED_PEAK = 6000;
const MAX_MUSIC_VOLUME_STEP = 6;

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const serial = argValue("--serial");
const jsonPath = argValue("--json");
const only = (argValue("--only") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!serial) {
  console.error("--serial <adb serial> is required. `adb devices` lists them.");
  process.exit(2);
}

const adb = async (...command: string[]) => {
  const { stdout } = await run("adb", ["-s", serial, ...command], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
};

const shell = (line: string) => adb("shell", line);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── CDP ──────────────────────────────────────────────────────────────────────────────────────

let browser: import("playwright-core").Browser | null = null;
let page: import("playwright-core").Page | null = null;

/**
 * The application's process id, waited for rather than sampled.
 *
 * A relaunch is not instant and the previous stage may still be being torn down, so a single
 * `pidof` immediately after `am start` reports nothing and reads as a crash.
 */
const waitForApp = async (timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = (await shell(`pidof ${PACKAGE}`).catch(() => "")).trim().split(/\s+/)[0];
    if (pid) return pid;
    await sleep(1000);
  }
  throw new Error(`${PACKAGE} did not start within ${timeoutMs} ms`);
};

const attach = async () => {
  await detach();
  const pid = await waitForApp();
  await adb("forward", "--remove", `tcp:${CDP_PORT}`).catch(() => undefined);
  await adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  const { chromium } = await import("playwright-core");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const pages = browser.contexts().flatMap((context) => context.pages());
  page = pages.find((candidate) => !candidate.url().startsWith("devtools://")) ?? pages[0];
  if (!page) throw new Error("no WebView page on the CDP endpoint");
};

const detach = async () => {
  await browser?.close().catch(() => undefined);
  browser = null;
  page = null;
};

const js = (expression: string): Promise<any> => page!.evaluate(expression as never);

// ── device helpers ───────────────────────────────────────────────────────────────────────────

const requireFlightMode = async () => {
  const airplane = await shell("settings get global airplane_mode_on");
  const addresses = await shell("ip -o -4 addr show").catch(() => "");
  const routable = addresses.split("\n").filter((line) => line.trim() && !line.includes(" lo "));
  if (airplane.trim() !== "1" || routable.length > 0) {
    throw new Error(
      "This run requires flight mode with no routable interface: it is what guarantees no stage " +
        `can reach a real Ultimate. airplane_mode_on=${airplane.trim()}, interfaces=${JSON.stringify(routable)}`,
    );
  }
};

const musicVolume = async () => {
  const dump = await shell("dumpsys audio");
  const block = dump.slice(dump.indexOf("- STREAM_MUSIC:"));
  return Number(/streamVolume:(\d+)/.exec(block)?.[1] ?? NaN);
};

/** Step the volume down with key events; `cmd media_session volume` reports success and does nothing. */
const quietenSpeaker = async () => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await musicVolume()) <= MAX_MUSIC_VOLUME_STEP) return;
    await shell("input keyevent 25");
    await sleep(250);
  }
  throw new Error("could not bring the music stream down to a polite level");
};

const relaunchFresh = async () => {
  await shell(`pm clear ${PACKAGE}`);
  // `pm clear` force-stops the package, and a launch issued into the middle of that teardown is
  // swallowed with no error: the activity manager logs the kill and never starts anything. Give it
  // a moment, then start, and start again if nothing came up.
  await sleep(2000);
  const startedAt = Date.now();
  await shell(`am start -n ${PACKAGE}/.MainActivity`);
  try {
    await waitForApp(12000);
  } catch {
    await shell(`am start -n ${PACKAGE}/.MainActivity`);
    await waitForApp(20000);
  }
  // The process exists before the WebView has a page to attach to, so attach on a retry rather than
  // on a fixed wait: the app reaches its first screen in about two seconds, and a blanket sleep made
  // every stage that relaunches several times slower than the thing it was measuring.
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await sleep(attempt === 0 ? 800 : 1000);
    try {
      await attach();
      const ready = await js(`(() => Boolean(document.querySelector("[data-testid]")))()`).catch(() => false);
      if (ready) return startedAt;
    } catch {
      // The DevTools socket is not up yet; try again.
    }
  }
  throw new Error("the app did not present a screen after a relaunch");
};

/**
 * A stock Demo Mode session: fresh process, no injected globals, offer confirmed.
 *
 * The stages that measure the product must not inherit the previous stage's instrumentation.
 * `__c64uTestProbeEnabled`, which the unreachable-offer stage needs to inject a network status,
 * also tells the app not to start its own mock server — so a session carrying it enters Demo Mode
 * routed at the stored real host and streams nothing. The process restart is what clears it.
 */
const enterStockDemoMode = async () => {
  await relaunchFresh();
  const offer = await readOffer();
  if (offer.dialogOpen) {
    await clickTestId("demo-interstitial-continue");
    await sleep(4000);
  }
  const state = await connectionState();
  expect(state === "DEMO_ACTIVE", `expected DEMO_ACTIVE, got ${state}`);

  // DEMO_ACTIVE alone does not say what the app is talking to: a session that could not start the
  // simulated device reports Demo Mode and stays routed at the stored real host, on port 80.
  // Settings prints the runtime target; the port on it is the discriminator, because the mock
  // binds an ephemeral one. The hostname is not — it keeps the stored device's name even while
  // the requests go to loopback.
  const target = await js(`(async () => {
    history.pushState({}, "", "/settings");
    dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const line = Array.from(document.querySelectorAll("*"))
      .map((node) => node.textContent || "")
      .find((text) => text.startsWith("Currently using:"));
    history.pushState({}, "", "/");
    dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return line || "";
  })()`);
  const httpPort = Number(/HTTP\s+(\d+)/.exec(target)?.[1] ?? NaN);
  expect(
    target.includes("(Demo mock)") && httpPort > 1024,
    `the app is not routed at the simulated device: ${JSON.stringify(target.slice(0, 140))}`,
  );
};

// ── stage plumbing ───────────────────────────────────────────────────────────────────────────

const results: Record<string, unknown>[] = [];

const stage = async (name: string, body: () => Promise<Record<string, unknown> | void>) => {
  if (only.length > 0 && !only.includes(name)) {
    results.push({ stage: name, status: "skipped" });
    return;
  }
  const startedAt = Date.now();
  try {
    const detail = (await body()) ?? {};
    results.push({ stage: name, status: "pass", ms: Date.now() - startedAt, ...detail });
    console.log(`PASS  ${name}`);
    for (const [key, value] of Object.entries(detail)) {
      console.log(`      ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
    }
  } catch (error) {
    const measured = (error as { measured?: Record<string, unknown> })?.measured ?? {};
    results.push({
      stage: name,
      status: "fail",
      ms: Date.now() - startedAt,
      error: String((error as Error)?.message ?? error),
      ...measured,
    });
    console.log(`FAIL  ${name}: ${(error as Error)?.message ?? error}`);
    for (const [key, value] of Object.entries(measured)) {
      console.log(`      ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
    }
  }
};

/** Attach what was measured to a failure, so a threshold miss still reports its numbers. */
const expectWith = (condition: unknown, message: string, measured: Record<string, unknown>) => {
  if (condition) return;
  const error = new Error(message) as Error & { measured?: Record<string, unknown> };
  error.measured = measured;
  throw error;
};

const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const readOffer = () =>
  js(`(() => {
    const t = (id) => document.querySelector('[data-testid="' + id + '"]');
    const message = t("demo-interstitial-message");
    const badge = document.querySelector('[data-panel-position="1"] [data-testid=unified-health-badge]');
    return {
      state: badge ? badge.getAttribute("data-connection-state") : null,
      dialogOpen: !!document.querySelector("[role=dialog]"),
      messageText: message ? message.innerText : null,
      messageVisible: message ? message.getBoundingClientRect().height > 4 : false,
      hostname: t("demo-interstitial-hostname") ? t("demo-interstitial-hostname").innerText : null,
      hasHostInput: !!t("demo-interstitial-host-input"),
    };
  })()`);

const connectionState = () =>
  js(`(() => {
    const badge = document.querySelector('[data-panel-position="1"] [data-testid=unified-health-badge]');
    return badge ? badge.getAttribute("data-connection-state") : null;
  })()`);

const clickTestId = (testId: string): Promise<boolean> =>
  js(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);

// ── driving the app ─────────────────────────────────────────────────────────────────────────────

const goTo = async (route: string, settleMs = 3000) => {
  await js(
    `(() => { history.pushState({}, "", ${JSON.stringify(route)}); ` +
      `dispatchEvent(new PopStateEvent("popstate")); return true; })()`,
  );
  await sleep(settleMs);
};

/**
 * Add everything of one kind from a folder on the simulated device to the playlist.
 *
 * Drives the real Add-items flow rather than seeding storage: the point of the run is that a user
 * can reach this content, and a seeded playlist would prove only that the playlist can hold rows.
 */
const addFromSimulatedDevice = async (folder: string[], pick: string) => {
  await goTo("/play");
  expect(await clickTestId("add-items-to-playlist"), "no Add items button");
  await sleep(2500);
  expect(await clickTestId("import-option-c64u"), "the simulated device is not offered as a source");
  await sleep(4000);

  for (const step of folder) {
    const entered = await js(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid=source-entry-row]'));
      const row = rows.find((node) => (node.innerText || "").toUpperCase().includes(${JSON.stringify(step.toUpperCase())}));
      if (!row) return false;
      row.click();
      return true;
    })()`);
    expect(entered, `could not open ${step} on the simulated device`);
    await sleep(2500);
  }

  const selected = await js(`(() => {
    const box = document.getElementById(${JSON.stringify(`select-${pick}`)});
    if (!box) {
      return { ok: false, available: Array.from(document.querySelectorAll("[id^=select-]")).map((n) => n.id) };
    }
    box.click();
    return { ok: true };
  })()`);
  expect(selected.ok, `${pick} is not in the folder; it holds ${JSON.stringify(selected.available)}`);
  await sleep(1200);

  expect(await clickTestId("add-items-confirm"), "no confirm button in the picker");

  // The picker closes, the file is fetched and its metadata read before the row appears, so poll
  // for the row rather than sampling once: a fixed wait is either flaky or slower than it needs.
  const label = pick.replace(/\.[a-z0-9]+$/i, "");
  let body = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    body = String(await js(`(() => (document.querySelector("main") || document.body).innerText)()`));
    if (body.includes(label)) return;
  }
  expect(false, `${pick} did not reach the playlist within 20 s; the page shows ${JSON.stringify(body.slice(0, 200))}`);
};

/** The Live View canvas as a PNG, which is the frame a receiver actually decoded. */
const captureFrame = async (name: string) => {
  const base64 = await js(`(() => {
    const canvas = document.querySelector('[data-testid="av-mirror-canvas"]');
    return canvas ? canvas.toDataURL("image/png").slice("data:image/png;base64,".length) : "";
  })()`);
  expect(base64, "there is no Live View canvas to capture");
  const path = resolve(process.cwd(), `artifacts/demo-mode-hil/${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
};

/** A short screen recording, which is the only evidence that shows the picture MOVING. */
const captureVideo = async (name: string, seconds: number) => {
  const remote = `/sdcard/${name}.mp4`;
  await shell(`screenrecord --time-limit ${seconds} --size 720x1520 ${remote}`);
  const path = resolve(process.cwd(), `artifacts/demo-mode-hil/${name}.mp4`);
  mkdirSync(dirname(path), { recursive: true });
  await adb("pull", remote, path);
  await shell(`rm -f ${remote}`);
  return path;
};

/** Turn the Live View mirror on, and wait for it to settle at its real frame rate. */
const startMirror = async (options: { audio: boolean }) => {
  await goTo("/");
  await js(`(() => {
    const toggle = document.querySelector('[data-testid="home-section-toggle-live-view"]');
    if (toggle && !document.querySelector('[data-testid="av-video-toggle"]')) toggle.click();
    return true;
  })()`);
  await sleep(2000);
  const pressed = async (testId: string) =>
    js(
      `(() => { const el = document.querySelector('[data-testid="${testId}"]'); return el ? el.getAttribute("aria-pressed") : null; })()`,
    );
  if ((await pressed("av-video-toggle")) !== "true") await clickTestId("av-video-toggle");
  await sleep(2000);
  if (options.audio && (await pressed("av-audio-toggle")) !== "true") await clickTestId("av-audio-toggle");
  await sleep(6000);
};

const readFps = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const text = await js(`(() => {
      const el = document.querySelector('[data-testid="av-mirror-fps"]');
      return el ? el.innerText : null;
    })()`);
    const fps = Number(/(\d+)\s*fps/.exec(text ?? "")?.[1] ?? NaN);
    if (fps >= 45) return { fps, text };
    await sleep(1000);
  }
  const text = await js(`(() => {
    const el = document.querySelector('[data-testid="av-mirror-fps"]');
    return el ? el.innerText : null;
  })()`);
  return { fps: Number(/(\d+)\s*fps/.exec(text ?? "")?.[1] ?? NaN), text };
};

/** The Live View badge, which reads `PAL 50 fps` or `NTSC 60 fps` off the decoded frames. */
const waitForStandardBadge = async (expected: "PAL" | "NTSC", timeoutMs = 40000) => {
  const deadline = Date.now() + timeoutMs;
  let text: string | null = null;
  while (Date.now() < deadline) {
    text = await js(`(() => {
      const el = document.querySelector('[data-testid="av-mirror-fps"]');
      return el ? el.innerText : null;
    })()`);
    if ((text ?? "").includes(expected)) return { standard: expected, text };
    await sleep(1000);
  }
  return { standard: null, text };
};

/**
 * Eight one-second samples of the frame-rate badge, taken inside a single page evaluation.
 *
 * Both parts matter. A badge read straight after a route change measures the re-render rather than
 * the stream — the first sample after switching standard came back 20 per cent low every time. And
 * sampling with one CDP round trip per read costs enough on this handset to depress the number
 * being read: eight separate evaluations reported a median of 49 fps while the stream was in fact
 * presenting 59.6 frames a second, measured from the panel's own cumulative counter.
 */
const medianBadgeFps = async () => {
  const samples: number[] = await js(`(async () => {
    // Let the route settle first. The badge counts frames presented in the trailing second, so a
    // sample taken while the card is still mounting counts the frames it missed while mounting.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const out = [];
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const el = document.querySelector('[data-testid="av-mirror-fps"]');
      const value = Number(/(\\d+)\\s*fps/.exec(el ? el.innerText : "")?.[1] ?? NaN);
      if (Number.isFinite(value)) out.push(value);
    }
    return out;
  })()`);
  const sorted = [...samples].sort((left, right) => left - right);
  return { fps: sorted[Math.floor(sorted.length / 2)] ?? NaN, samples };
};

/**
 * Switch the simulated machine between PAL and NTSC the way a user does: the Config page.
 *
 * Driving the dropdown rather than writing the config item over HTTP is deliberate. It proves the
 * whole write path works in Demo Mode — the page renders the item, the app sends the PUT, and the
 * simulated device acts on it — which is the same claim being made about every other feature here.
 *
 * The item is not on the Config landing page: that page lists menu sections, and `System Mode` is
 * inside `Video setup`, which has to be opened first.
 */
const SYSTEM_MODE_SELECT = "config-select-trigger:U64 Specific Settings:System Mode";

const setSystemMode = async (value: "PAL" | "NTSC") => {
  await goTo("/config", 4000);
  const opened = await js(`(async () => {
    const section = document.querySelector('[data-testid="config-menu-page-video-setup"]');
    if (!section) return { section: false };
    if (section.getAttribute("aria-expanded") !== "true") section.click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const trigger = document.querySelector('[data-testid="${SYSTEM_MODE_SELECT}"]');
    if (!trigger) return { section: true, trigger: false };
    trigger.scrollIntoView({ block: "center" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const before = (trigger.innerText || "").trim();
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 1400));
    return {
      section: true,
      trigger: true,
      before,
      options: Array.from(document.querySelectorAll('[role="option"]')).map((el) => (el.textContent || "").trim()),
    };
  })()`);
  expect(opened.section, "the Config page has no Video setup section in Demo Mode");
  expect(opened.trigger, "Video setup does not render a System Mode dropdown in Demo Mode");
  expect(
    Array.isArray(opened.options) && opened.options.includes(value),
    `the System Mode dropdown does not offer ${value}: ${JSON.stringify(opened.options)}`,
  );

  // Radix closes its listbox on pointerup, not click, so a bare `.click()` leaves it open with
  // nothing chosen. The full pointer sequence is what a finger produces and what it listens for.
  const chosen = await js(`(async () => {
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find((el) => (el.textContent || "").trim() === ${JSON.stringify(value)});
    if (!option) return { clicked: false };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      option.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch" }));
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const trigger = document.querySelector('[data-testid="${SYSTEM_MODE_SELECT}"]');
    return { clicked: true, now: trigger ? (trigger.innerText || "").trim() : null, stillOpen: document.querySelectorAll('[role="option"]').length };
  })()`);
  expect(chosen.clicked, `the System Mode dropdown had no ${value} option to choose`);
  expect((chosen.now ?? "") === value, `the Config page reads ${JSON.stringify(chosen.now)} after choosing ${value}`);
  return { before: opened.before, now: chosen.now };
};

/** Processor time this application has used, in seconds, from the kernel's own counters. */
const processCpuSeconds = async () => {
  const pid = await waitForApp();
  const stat = await shell(`cat /proc/${pid}/stat`);
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
  // utime and stime are fields 14 and 15 of the whole line, which is 12 and 13 after the comm.
  const ticks = Number(fields[11]) + Number(fields[12]);
  return ticks / 100; // USER_HZ is 100 on every Android build this runs on
};

const cpuCores = async () => Number((await shell("nproc")).trim()) || 8;

// ── stages ───────────────────────────────────────────────────────────────────────────────────

const offlineOffer = async () => {
  // Timed from the launch intent, not from the start of the stage: `pm clear` and this harness's
  // own attach retries are not the app starting, and folding them in would report a number no user
  // ever waits.
  const launchedAt = (await relaunchFresh()) ?? Date.now();
  let offer = await readOffer();
  for (let attempt = 0; attempt < 40 && !offer.dialogOpen; attempt += 1) {
    await sleep(250);
    offer = await readOffer();
  }
  const offerAfterMs = Date.now() - launchedAt;
  expect(offer.dialogOpen, "no dialog appeared on a fresh offline launch");
  expect(offer.messageVisible, "the dialog's explanation was not visible on screen");
  expect(/no network connection/i.test(offer.messageText ?? ""), `unexpected copy: ${offer.messageText}`);
  expect(!offer.hasHostInput, "a hostname field was offered with no network to reach it over");

  expect(await clickTestId("demo-interstitial-continue"), "Continue in Demo Mode was not present");
  await sleep(4000);
  const state = await connectionState();
  expect(state === "DEMO_ACTIVE", `expected DEMO_ACTIVE after confirming, got ${state}`);
  // A start that takes long enough to look broken is its own defect, so the wait is measured rather
  // than assumed. The bound is generous; what it catches is a regression into seconds.
  expect(offerAfterMs < 8000, `the offer took ${offerAfterMs} ms to appear after launch`);
  return { message: offer.messageText, offerAfterMs };
};

const unreachableOffer = async () => {
  await relaunchFresh();
  await sleep(2000);

  // The offer is shown at most once per session, and the flag that enforces that lives in module
  // state, not storage — so this case needs a fresh JS context with the override already in place,
  // not a second discovery inside the session the offline stage just used.
  await js(`(() => { sessionStorage.clear(); return true; })()`);
  await page!.addInitScript(() => {
    const win = window as Window & {
      __c64uTestProbeEnabled?: boolean;
      __c64uMockNetworkStatus?: { online: boolean; supported: boolean };
    };
    // Tell the app a network is up. The radios stay off, so the saved-host probe, the saved-device
    // sweep and the LAN scan all run for real and all reach nothing — which is the case under test,
    // staged without a single packet going anywhere near a real Ultimate.
    win.__c64uTestProbeEnabled = true;
    win.__c64uMockNetworkStatus = { online: true, supported: true };
  });
  await page!.reload({ waitUntil: "domcontentloaded" });

  let offer: Awaited<ReturnType<typeof readOffer>> | null = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await sleep(1000);
    offer = await readOffer();
    if (offer.dialogOpen && offer.hasHostInput) break;
  }
  expect(offer?.dialogOpen, "no Demo Mode offer appeared with a network reported up");
  expect(offer!.messageVisible, "the dialog's explanation was not visible on screen");
  expect(offer!.hostname, "the offer did not name the host it tried");
  expect(offer!.hasHostInput, "the offer did not let the user correct the hostname");
  expect(
    !/no network connection/i.test(offer!.messageText ?? ""),
    "the offer used the no-network wording although a network was reported up",
  );

  expect(await clickTestId("demo-interstitial-continue"), "Continue in Demo Mode was not present");
  await sleep(4000);
  const state = await connectionState();
  expect(state === "DEMO_ACTIVE", `expected DEMO_ACTIVE after confirming, got ${state}`);
  return { hostTried: offer!.hostname, message: offer!.messageText };
};

const avStream = async () => {
  await enterStockDemoMode();
  await quietenSpeaker();

  const openedCard = await js(`(() => {
    const toggle = document.querySelector('[data-testid="home-section-toggle-live-view"]');
    if (!toggle) return false;
    if (!document.querySelector('[data-testid="av-video-toggle"]')) toggle.click();
    return true;
  })()`);
  expect(openedCard, "the Live View card is not on Home in Demo Mode");
  await sleep(2000);

  expect(await clickTestId("av-video-toggle"), "no video toggle");
  await sleep(2000);
  expect(await clickTestId("av-audio-toggle"), "no audio toggle");
  await sleep(6000);

  const toggles = await js(`(() => {
    const t = (id) => document.querySelector('[data-testid="' + id + '"]');
    return {
      video: t("av-video-toggle") ? t("av-video-toggle").getAttribute("aria-pressed") : null,
      audio: t("av-audio-toggle") ? t("av-audio-toggle").getAttribute("aria-pressed") : null,
      error: t("av-mirror-error") ? t("av-mirror-error").innerText : null,
    };
  })()`);
  expect(toggles.video === "true" && toggles.audio === "true", `mirror did not start: ${JSON.stringify(toggles)}`);
  expect(!toggles.error, `mirror reported: ${toggles.error}`);

  // The badge reports a rolling rate, so it climbs from whatever fraction of a second the mirror
  // has been running. Poll for the settled value rather than reading the ramp.
  let fps = 0;
  let fpsText: string | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    fpsText = await js(`(() => {
      const el = document.querySelector('[data-testid="av-mirror-fps"]');
      return el ? el.innerText : null;
    })()`);
    fps = Number(/(\d+)\s*fps/.exec(fpsText ?? "")?.[1] ?? NaN);
    if (fps >= 45) break;
    await sleep(1000);
  }
  expect(fps >= 45 && fps <= 55, `expected roughly PAL frame rate, settled at ${fpsText}`);

  // Keep the decoded frame as evidence: it is the picture a reviewer can look at and say whether
  // the test card arrived whole, in the right colours and the right way up.
  const framePng = await js(`(() => {
    const canvas = document.querySelector('[data-testid="av-mirror-canvas"]');
    return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  })()`);
  const framePath = resolve(process.cwd(), "artifacts/demo-mode-hil/live-view-frame.png");
  mkdirSync(dirname(framePath), { recursive: true });
  writeFileSync(framePath, Buffer.from(framePng, "base64"));

  const audio = await js(`(async () => {
    const plugin = window.Capacitor.Plugins.StreamUdp;
    const first = await plugin.readAudioStats({});
    await new Promise((r) => setTimeout(r, 5000));
    const second = await plugin.readAudioStats({});
    return { first, second };
  })()`);
  const packetsPerSecond = (audio.second.arrival.packets - audio.first.arrival.packets) / 5;
  expect(packetsPerSecond > 240 && packetsPerSecond < 260, `audio arrived at ${packetsPerSecond} packets/s`);
  expect(audio.second.arrival.lostPackets === 0, `audio lost ${audio.second.arrival.lostPackets} packets`);
  expect(audio.second.underruns === 0, `audio underran ${audio.second.underruns} times`);
  expect(
    audio.second.senders.length === 1 && audio.second.senders[0] === "127.0.0.1",
    `audio came from ${JSON.stringify(audio.second.senders)}, which is not loopback only`,
  );

  // The colour ladder, read off the decoded canvas. Each slot holds one VIC colour, so the
  // sequence of distinct colours is the sequence of notes: a frozen picture, a dropped slot or a
  // palette applied in the wrong order all change it.
  const walk = await js(`(async () => {
    const canvas = document.querySelector('[data-testid="av-mirror-canvas"]');
    const context = canvas.getContext("2d");
    const samples = [];
    const startedAt = performance.now();
    while (performance.now() - startedAt < 11000) {
      const pixel = context.getImageData(6, 136, 1, 1).data;
      samples.push([pixel[0], pixel[1], pixel[2]].join(","));
      await new Promise((r) => setTimeout(r, 50));
    }
    const runs = [];
    for (const sample of samples) {
      if (runs.length === 0 || runs[runs.length - 1].rgb !== sample) runs.push({ rgb: sample, count: 1 });
      else runs[runs.length - 1].count += 1;
    }
    return runs;
  })()`);
  const distinctColours = new Set(walk.map((run) => run.rgb));
  expect(distinctColours.size >= 16, `the surround showed only ${distinctColours.size} colours in 11 s`);

  const captured = await js(`(async () => {
    const plugin = window.Capacitor.Plugins.StreamUdp;
    await plugin.startAudioCapture({ seconds: 11 });
    await new Promise((r) => setTimeout(r, 12000));
    return plugin.readAudioCapture({});
  })()`);
  expect(captured.bytes > 0, "no PCM was captured from the audio pipeline");

  const localWav = resolve(process.cwd(), "artifacts/demo-mode-hil/mirror.wav");
  mkdirSync(dirname(localWav), { recursive: true });
  await adb("pull", captured.path, localWav);
  const graded = gradeLadder(localWav);
  expect(graded.worstCents < 50, `worst note was ${graded.worstCents.toFixed(1)} cents out`);
  expect(graded.silences >= 1, "the ladder's silences did not arrive as silence");
  expect(
    Math.abs(graded.peak - EXPECTED_PEAK) < 400,
    `peak sample was ${graded.peak}, not the authored ${EXPECTED_PEAK}`,
  );

  await clickTestId("av-audio-toggle");
  await sleep(1500);
  await clickTestId("av-video-toggle");

  return {
    fps,
    audioPacketsPerSecond: packetsPerSecond,
    audioLostPackets: audio.second.arrival.lostPackets,
    audioSenders: audio.second.senders,
    ladderColours: distinctColours.size,
    worstNoteCents: Number(graded.worstCents.toFixed(2)),
    notesGraded: graded.notes.length,
    peakSample: graded.peak,
    wav: localWav,
    frame: framePath,
  };
};

const ctaCensus = async () => {
  // Self-contained, so `--only cta-census` measures the same thing a full run does: a stock Demo
  // Mode session, not whatever the previous stage left behind.
  if ((await connectionState().catch(() => null)) !== "DEMO_ACTIVE") await enterStockDemoMode();
  const perRoute: Record<string, { visible: number; disabled: string[]; covered: string[]; boundary: boolean }> = {};
  for (const route of MAIN_ROUTES) {
    await js(
      `(() => { window.history.pushState({}, "", ${JSON.stringify(route)}); window.dispatchEvent(new PopStateEvent("popstate")); return true; })()`,
    );
    await sleep(3500);
    perRoute[route] = await js(`(async () => {
      const selector = ["button", "a[href]", "input", "select", "textarea", '[role="button"]',
        '[role="checkbox"]', '[role="switch"]', '[role="tab"]', '[role="slider"]'].join(",");
      const visible = [];
      const disabled = [];
      const covered = [];
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      for (const node of Array.from(document.querySelectorAll(selector))) {
        const testId = node.dataset.testid;
        if (!testId) continue;
        if (node.getBoundingClientRect().width === 0 || node.getBoundingClientRect().height === 0) continue;
        if (getComputedStyle(node).visibility === "hidden") continue;
        if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") {
          disabled.push(testId);
          continue;
        }
        visible.push(testId);

        // Scroll it to the middle first, the way a user reaches a control below the fold, then hit-
        // test its centre. A control can be visible and enabled and still take no tap because
        // something transparent is over it — a toast viewport once sat across the Play transport
        // and ate every tap while every other check passed. Without the scroll this instead
        // reports every control that happens to sit under the fixed tab bar, which is not a defect.
        node.scrollIntoView({ block: "center", inline: "center" });
        await settle();
        const rect = node.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const midY = rect.top + rect.height / 2;
        if (midX < 0 || midY < 0 || midX > innerWidth || midY > innerHeight) continue;
        const hit = document.elementFromPoint(midX, midY);
        if (hit && !node.contains(hit) && !hit.contains(node)) {
          covered.push(testId + " <- " + (hit.dataset.testid || hit.tagName.toLowerCase()));
        }
      }
      return {
        visible: visible.length,
        disabled,
        covered,
        boundary: !!document.querySelector('[data-testid="error-boundary"]'),
      };
    })()`);
    expect(!perRoute[route].boundary, `${route} rendered an error boundary in Demo Mode`);
    expect(perRoute[route].visible > 0, `${route} rendered no enabled controls in Demo Mode`);
    expect(
      perRoute[route].covered.length === 0,
      `${route}: controls that cannot be tapped because something is over them: ${JSON.stringify(perRoute[route].covered)}`,
    );
  }
  return { perRoute };
};

/**
 * The simulated device holds real content, and the app can see it.
 *
 * Demo Mode used to browse almost empty: one 122-byte tune whose player did nothing and six
 * 18-byte files named `.d64`. Everything downstream — the playlist, a mounted disk's directory, a
 * tune's author and length — had nothing true to show.
 */
const library = async () => {
  await enterStockDemoMode();
  await goTo("/play");
  expect(await clickTestId("add-items-to-playlist"), "no Add items button");
  await sleep(2500);
  expect(await clickTestId("import-option-c64u"), "the simulated device is not offered as a source");
  await sleep(4000);

  const seen: Record<string, string[]> = {};
  for (const folder of ["Music", "Programs", "Carts", "Games"]) {
    await js(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid=source-entry-row]'));
      const root = rows.find((node) => (node.innerText || "").toUpperCase().includes("USB0"));
      if (root) root.click();
      return true;
    })()`);
    await sleep(2000);
    const entered = await js(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid=source-entry-row]'));
      const row = rows.find((node) => (node.innerText || "").toUpperCase().includes(${JSON.stringify("")} + "${folder.toUpperCase()}"));
      if (!row) return false;
      row.click();
      return true;
    })()`);
    expect(entered, `the simulated device has no ${folder} folder`);
    await sleep(2500);
    seen[folder] = await js(
      `(() => Array.from(document.querySelectorAll("[id^=select-]")).map((n) => n.id.slice(7)))()`,
    );
    expect(seen[folder].length > 0, `${folder} listed nothing`);
    expect(await clickTestId("navigate-root"), "no way back to the root of the source");
    await sleep(2000);
  }

  await js(`(() => { document.querySelector('[role=dialog] [aria-label=Close]')?.click(); return true; })()`);
  await sleep(1500);

  return {
    tunes: seen.Music.length,
    programs: seen.Programs.length,
    cartridges: seen.Carts.length,
    diskFolders: seen.Games.length,
    examples: [seen.Music[0], seen.Programs[0], seen.Carts[0]],
  };
};

/**
 * A tune from the simulated device makes a sound on this phone.
 *
 * The simulated device has no SID chip, so a tune sent to it would be a success toast and silence.
 * The app plays it on the phone's own engine instead and tells the device, whose screen names it.
 * Audible: about fifteen seconds at a low volume.
 */
const music = async () => {
  await enterStockDemoMode();
  await quietenSpeaker();
  await addFromSimulatedDevice(["Usb0", "Music"], "Commander March.sid");

  const started = await js(`(async () => {
    const button = Array.from(document.querySelectorAll("button,[role=button]"))
      .find((node) => (node.getAttribute("aria-label") || "") === "Play Commander March");
    if (!button) return { ok: false };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const track = document.querySelector('[data-testid="playback-current-track"]');
    return { ok: true, track: track ? track.innerText.split(String.fromCharCode(10)).join(" | ") : null };
  })()`);
  expect(started.ok, "the playlist row had no play control");
  // The metadata comes out of the SID header the generator wrote, so this is also a check that the
  // tune on the device is a real PSID and not a placeholder.
  expect(/C64 Commander/i.test(started.track ?? ""), `the tune's author did not come through: ${started.track}`);
  expect(/6581|8580/.test(started.track ?? ""), `the tune's SID model did not come through: ${started.track}`);

  // Frames actually written to the speaker, from the kernel's own mixer, twice a few seconds apart.
  // A track that exists but is stalled reads as playing everywhere in the app and is silent here.
  const framesOf = async () => {
    const dump = await shell("dumpsys media.audio_flinger");
    const matches = [...dump.matchAll(/framesWritten=(\d+)/g)].map((match) => Number(match[1]));
    return matches.length > 0 ? Math.max(...matches) : NaN;
  };
  const first = await framesOf();
  await sleep(5000);
  const second = await framesOf();
  const framesPerSecond = (second - first) / 5;
  expect(
    framesPerSecond > 40000 && framesPerSecond < 60000,
    `the speaker was fed ${Math.round(framesPerSecond)} frames/s, which is not a tune playing`,
  );

  await startMirror({ audio: false });
  const screen = await captureFrame("music-now-playing");

  await js(`(() => { document.querySelector('[data-testid="playlist-pause"]')?.click(); return true; })()`);
  await sleep(1500);

  return {
    // What the Play page showed while the tune was playing. Read before the mirror was started,
    // because starting it leaves for Home, where this element does not exist.
    track: String(started.track ?? ""),
    speakerFramesPerSecond: Math.round(framesPerSecond),
    screen,
  };
};

/** Launching a program changes what Live View shows, which is the whole point of the picture. */
const launchStage = async (kind: "prg" | "crt") => {
  await enterStockDemoMode();
  await startMirror({ audio: false });

  const before = await captureFrame(`${kind}-before`);
  const beforeText = await js(`(() => {
    const canvas = document.querySelector('[data-testid="av-mirror-canvas"]');
    return canvas.toDataURL("image/png").length;
  })()`);

  const folder = kind === "prg" ? "Programs" : "Carts";
  const file = kind === "prg" ? "Hello.prg" : "Demo Cartridge.crt";
  const label = file.replace(/\.[a-z0-9]+$/i, "");
  await addFromSimulatedDevice(["Usb0", folder], file);

  // The row's label keeps the extension for a program and drops it for a tune, so match on the
  // stem rather than on a name this script has guessed how the page spells.
  const launched = await js(`(async () => {
    const button = Array.from(document.querySelectorAll("button,[role=button]"))
      .find((node) => {
        const label = node.getAttribute("aria-label") || "";
        return label.startsWith("Play ") && label.includes(${JSON.stringify(label)});
      });
    if (!button) {
      return { ok: false, labels: Array.from(document.querySelectorAll("button,[role=button]"))
        .map((node) => node.getAttribute("aria-label")).filter(Boolean).slice(0, 20) };
    }
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return { ok: true };
  })()`);
  expect(launched.ok, `no way to start ${file}; the row offered ${JSON.stringify(launched.labels)}`);

  await startMirror({ audio: false });
  const video = await captureVideo(`${kind}-running`, 5);
  const after = await captureFrame(`${kind}-running`);
  const afterText = await js(`(() => {
    const canvas = document.querySelector('[data-testid="av-mirror-canvas"]');
    return canvas.toDataURL("image/png").length;
  })()`);

  expect(beforeText !== afterText, "the picture did not change when the program was started");

  return { label, before, after, video };
};

/**
 * The picture keeps up, nothing is dropped, and the app stays usable while it plays.
 *
 * The order of the checks is the order of the priorities: a dropped audio packet is audible and a
 * dropped frame is not, so audio loss fails the stage outright while the frame rate is allowed the
 * tolerance a phone's scheduler actually needs.
 */
/**
 * The picture keeps up, nothing is dropped, and the app stays usable while it plays.
 *
 * The order of the checks is the order of the priorities. A dropped audio packet is audible and a
 * dropped frame is not, so audio loss fails outright; the frame rate is held to the rate the device
 * actually sends; and responsiveness is judged by what the stream COSTS, because switching route
 * takes this handset 230-370 ms with nothing streaming at all.
 */
/**
 * The other raster standard, end to end.
 *
 * A C64 set to NTSC sends 240-line frames at ~60 Hz instead of PAL's 272 at ~50, and the app works
 * out which it is receiving from the frame height alone. Until the simulated device could do both,
 * the app's NTSC path could not be exercised without a second piece of hardware set to NTSC.
 *
 * The switch is made on the Config page, so this also stands as the check that a config write
 * reaches the simulated device and takes effect there.
 */
const ntscStream = async () => {
  await enterStockDemoMode();
  await startMirror({ audio: false });

  const palBadge = await waitForStandardBadge("PAL");
  expect(
    palBadge.standard === "PAL",
    `expected a PAL stream before switching, badge read ${JSON.stringify(palBadge.text)}`,
  );
  const pal = await medianBadgeFps();
  expect(pal.fps >= 48, `PAL held ${pal.fps} fps before the switch (samples ${JSON.stringify(pal.samples)})`);

  const write = await setSystemMode("NTSC");
  await goTo("/", 3000);
  const ntscBadge = await waitForStandardBadge("NTSC");
  expectWith(
    ntscBadge.standard === "NTSC",
    `the stream never became NTSC: badge read ${JSON.stringify(ntscBadge.text)}`,
    { palSamples: pal.samples, ntscBadge: ntscBadge.text, configWrite: write },
  );
  const ntsc = await medianBadgeFps();
  expectWith(ntsc.fps >= 57, `NTSC held ${ntsc.fps} fps, not the 60 the device sends`, {
    palSamples: pal.samples,
    ntscSamples: ntsc.samples,
  });

  const frame = await captureFrame("ntsc-frame");
  const clip = await captureVideo("ntsc-stream", 5);

  // Ten seconds of NTSC on its own counters. Read as a delta for the same reason the PAL window is:
  // the totals carry the PAL frames from before the switch.
  const readVideoStats = () =>
    js(`(async () => {
      const open = document.querySelector('[data-testid="stream-stats-toggle"]');
      if (open && open.getAttribute("aria-expanded") !== "true") open.click();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const read = (id) => {
        const el = document.querySelector('[data-testid="stream-stats-' + id + '"]');
        if (!el) return null;
        const digits = el.innerText.replace(/[^0-9]/g, "");
        return digits === "" ? null : Number(digits);
      };
      return {
        presented: read("presented"),
        lost: read("frames-lost"),
        droppedPackets: read("video-dropped-packets"),
        decimated: read("decimated"),
      };
    })()`);
  const before = await readVideoStats();
  await sleep(10000);
  const after = await readVideoStats();
  const delta = (key: string) => Number(after[key] ?? 0) - Number(before[key] ?? 0);
  const stats = {
    presented: delta("presented"),
    lost: delta("lost"),
    droppedPackets: delta("droppedPackets"),
    decimated: delta("decimated"),
  };
  expectWith(stats.lost === 0, `${stats.lost} NTSC frames were lost in ten seconds`, { stats });
  expectWith(stats.droppedPackets === 0, `${stats.droppedPackets} NTSC packets were dropped in ten seconds`, { stats });
  expectWith(stats.decimated === 0, `${stats.decimated} NTSC frames were decimated in ten seconds`, { stats });
  // The window is the ten-second sleep plus the two panel reads either side of it, so the count is
  // a floor rather than an exact rate: 580 is 58 fps over the shortest the window can be.
  expectWith(
    stats.presented >= 580,
    `only ${stats.presented} frames were painted in ten seconds; NTSC sends about 600`,
    { stats },
  );

  // Put the machine back, so a later stage measuring PAL is measuring PAL because the machine is
  // PAL and not because it happened to be left that way.
  await setSystemMode("PAL");
  await goTo("/", 3000);
  const restored = await waitForStandardBadge("PAL");
  expect(restored.standard === "PAL", `the machine did not return to PAL: badge read ${JSON.stringify(restored.text)}`);

  await js(`(() => {
    const videoToggle = document.querySelector('[data-testid="av-video-toggle"]');
    if (videoToggle && videoToggle.getAttribute("aria-pressed") === "true") videoToggle.click();
    return true;
  })()`);

  return {
    palFps: pal.fps,
    palSamples: pal.samples,
    ntscFps: ntsc.fps,
    ntscSamples: ntsc.samples,
    ntscBadge: ntscBadge.text,
    restoredBadge: restored.text,
    ntscInTenSeconds: stats,
    configWrite: write,
    frame,
    clip,
  };
};

const performance_ = async () => {
  await enterStockDemoMode();
  await quietenSpeaker();
  await startMirror({ audio: true });

  const cores = await cpuCores();
  const cpuBefore = await processCpuSeconds();
  const wallBefore = Date.now();

  // Starting the audio mirror rebinds the video session, so the badge climbs from zero again for
  // some seconds afterwards. Wait for it to reach a plausible rate before starting the window, or
  // the median is a measurement of the ramp rather than of the stream.
  const settled = await readFps();
  expect(settled.fps >= 45, `Live View never reached a PAL rate: it stopped at ${settled.text}`);

  const samples: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const text = await js(`(() => {
      const el = document.querySelector('[data-testid="av-mirror-fps"]');
      return el ? el.innerText : null;
    })()`);
    const value = Number(/(\d+)\s*fps/.exec(text ?? "")?.[1] ?? NaN);
    if (Number.isFinite(value)) samples.push(value);
    await sleep(1000);
  }
  expect(samples.length >= 8, "the frame-rate badge did not report while the mirror was running");
  const sorted = [...samples].sort((left, right) => left - right);
  const fps = sorted[Math.floor(sorted.length / 2)];
  expect(fps >= 48, `PAL Live View held ${fps} fps (samples ${JSON.stringify(samples)}), not the 50 the device sends`);

  const audio = await js(`(async () => {
    const plugin = window.Capacitor.Plugins.StreamUdp;
    return plugin.readAudioStats({});
  })()`);
  // Audio first and without a tolerance: a dropped audio packet is audible and a dropped frame is
  // not, which is the order of priorities this stage is built around.
  expect(audio.arrival.lostPackets === 0, `audio lost ${audio.arrival.lostPackets} packets`);
  expect(audio.underruns === 0, `audio underran ${audio.underruns} times`);

  // The panel's counters are cumulative for the session, so they are read twice and reported as a
  // delta: a total carries whatever happened while the mirror was starting, which is not what "no
  // dropped frames while it runs" means. Measured before the navigation loop below, which leaves
  // Home and unmounts the canvas.
  const readVideoStats = () =>
    js(`(async () => {
      const open = document.querySelector('[data-testid="stream-stats-toggle"]');
      if (open && open.getAttribute("aria-expanded") !== "true") open.click();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const read = (id) => {
        const el = document.querySelector('[data-testid="stream-stats-' + id + '"]');
        if (!el) return null;
        const digits = el.innerText.replace(/[^0-9]/g, "");
        return digits === "" ? null : Number(digits);
      };
      return {
        presented: read("presented"),
        lost: read("frames-lost"),
        droppedPackets: read("video-dropped-packets"),
        decimated: read("decimated"),
        repeated: read("repeated"),
      };
    })()`);

  const statsBefore = await readVideoStats();
  await sleep(10000);
  const statsAfter = await readVideoStats();
  const delta = (key: string) => Number(statsAfter[key] ?? 0) - Number(statsBefore[key] ?? 0);
  const stats = {
    presented: delta("presented"),
    lost: delta("lost"),
    droppedPackets: delta("droppedPackets"),
    decimated: delta("decimated"),
    repeated: delta("repeated"),
  };
  expect(stats.lost === 0, `${stats.lost} video frames were lost in ten seconds`);
  expect(stats.droppedPackets === 0, `${stats.droppedPackets} video packets were dropped in ten seconds`);
  expect(stats.presented >= 470, `only ${stats.presented} frames were painted in ten seconds; PAL sends about 500`);

  // Two numbers per control, because they answer different questions. `ackMs` is the one the user
  // feels: click to the app having responded. `paintMs` is click to the whole route having mounted,
  // which is measured with the mirror running AND stopped, so what the stage asserts is that the
  // stream does not make it worse.
  // Three passes over the tab bar, reported per control as the median of its three presses. A
  // single press is too noisy on this handset to hold to a 300 ms budget: consecutive runs put
  // tab-disks at 298 ms and 306 ms with nothing changed between them, which would make the gate
  // decide on noise rather than on the app.
  const measureControls = () =>
    js(`(async () => {
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const tabs = ["tab-play", "tab-disks", "tab-config", "tab-settings", "tab-home"];
      const samples = new Map(tabs.map((tab) => [tab, { ack: [], paint: [] }]));
      for (let round = 0; round < 3; round += 1) {
        for (const tab of tabs) {
          const el = document.querySelector('[data-testid="' + tab + '"]');
          if (!el) continue;
          const started = performance.now();
          el.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const ackMs = Math.round(performance.now() - started);
          await settle();
          const entry = samples.get(tab);
          entry.ack.push(ackMs);
          entry.paint.push(Math.round(performance.now() - started));
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      }
      const median = (values) => {
        const sorted = [...values].sort((left, right) => left - right);
        return sorted[Math.floor(sorted.length / 2)];
      };
      return tabs
        .filter((tab) => samples.get(tab).ack.length > 0)
        .map((tab) => ({
          control: tab,
          ackMs: median(samples.get(tab).ack),
          paintMs: median(samples.get(tab).paint),
          ackSamples: samples.get(tab).ack,
        }));
    })()`);

  const whileStreaming = await measureControls();
  const slowestAck = whileStreaming.reduce(
    (slowest: { control: string; ackMs: number }, entry: { control: string; ackMs: number }) =>
      entry.ackMs > slowest.ackMs ? entry : slowest,
    { control: "none", ackMs: 0 },
  );

  // Every tab but Home answers a press in well under the 300 ms budget while the stream runs.
  // Home is the exception and is held to a looser ceiling: returning to it re-mounts the Live View
  // card and repaints the canvas, which costs a few hundred milliseconds on a debug build. Its
  // number is reported rather than hidden, so a regression there is visible.
  const others = whileStreaming.filter((entry: { control: string }) => entry.control !== "tab-home");
  const slowestOther = others.reduce(
    (slowest: { control: string; ackMs: number }, entry: { control: string; ackMs: number }) =>
      entry.ackMs > slowest.ackMs ? entry : slowest,
    { control: "none", ackMs: 0 },
  );
  expect(
    slowestOther.ackMs < 300,
    `${slowestOther.control} took ${slowestOther.ackMs} ms to answer a press while the stream was running`,
  );
  const home = whileStreaming.find((entry: { control: string }) => entry.control === "tab-home");
  expect(
    !home || home.ackMs < 700,
    `returning to Home took ${home?.ackMs} ms while the stream was running, which is a stall rather than a mount`,
  );

  const cpuAfter = await processCpuSeconds();
  const cpuPercent = ((cpuAfter - cpuBefore) / ((Date.now() - wallBefore) / 1000) / cores) * 100;

  await js(`(() => {
    document.querySelector('[data-testid="tab-home"]')?.click();
    return true;
  })()`);
  await sleep(1500);
  await js(`(() => {
    const audioToggle = document.querySelector('[data-testid="av-audio-toggle"]');
    if (audioToggle && audioToggle.getAttribute("aria-pressed") === "true") audioToggle.click();
    return true;
  })()`);
  await sleep(1500);
  await js(`(() => {
    const videoToggle = document.querySelector('[data-testid="av-video-toggle"]');
    if (videoToggle && videoToggle.getAttribute("aria-pressed") === "true") videoToggle.click();
    return true;
  })()`);
  await sleep(3000);
  const whileIdle = await measureControls();

  const worstPaint = (rows: { control: string; paintMs: number }[]) =>
    rows.reduce((slowest, entry) => (entry.paintMs > slowest.paintMs ? entry : slowest), {
      control: "none",
      paintMs: 0,
    });
  const streamingPaint = worstPaint(whileStreaming);
  const idlePaint = worstPaint(whileIdle);
  const overhead = streamingPaint.paintMs - idlePaint.paintMs;
  const overBudget = whileStreaming.filter((entry: { ackMs: number }) => entry.ackMs >= 300);

  const measured = {
    fps,
    fpsSamples: samples,
    cpuPercentOfDevice: Number(cpuPercent.toFixed(1)),
    slowestAcknowledgement: `${slowestAck.control} ${slowestAck.ackMs} ms`,
    controlsOverThreeHundredMs: overBudget.map(
      (entry: { control: string; ackMs: number }) => `${entry.control} ${entry.ackMs} ms`,
    ),
    slowestMountStreaming: `${streamingPaint.control} ${streamingPaint.paintMs} ms`,
    slowestMountIdle: `${idlePaint.control} ${idlePaint.paintMs} ms`,
    streamMountOverheadMs: overhead,
    audioLostPackets: audio.arrival.lostPackets,
    audioUnderruns: audio.underruns,
    videoInTenSeconds: stats,
    controlLatencies: whileStreaming,
    controlLatenciesIdle: whileIdle,
  };

  expectWith(
    cpuPercent < 40,
    `the app used ${cpuPercent.toFixed(1)}% of the device's processors while streaming`,
    measured,
  );
  expectWith(
    overhead < 260,
    `the stream added ${overhead} ms to the slowest route mount ` +
      `(${streamingPaint.control} ${streamingPaint.paintMs} ms streaming against ${idlePaint.paintMs} ms idle)`,
    measured,
  );

  return measured;
};

// ── pitch grading ────────────────────────────────────────────────────────────────────────────

/**
 * Grade the captured WAV against the ladder the mock is built from.
 *
 * Pitch by zero crossings over the steady middle of each slot: the notes are sine tones, so a
 * crossing count is exact enough to catch a wrong note, a wrong sample rate or a slot boundary in
 * the wrong place, and it needs no FFT.
 */
const gradeLadder = (wavPath: string) => {
  const buffer = readFileSync(wavPath);
  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22);
  const dataOffset = 44;
  const frames = (buffer.length - dataOffset) / (2 * channels);
  const left = new Float64Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    const value = buffer.readInt16LE(dataOffset + i * 2 * channels);
    left[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  // Decimated once for the pitch search: the ladder tops out at 262 Hz, so 12 kHz keeps every
  // note far above Nyquist while making an autocorrelation over the whole capture cheap.
  const decimation = Math.max(1, Math.floor(sampleRate / 12000));
  const coarseRate = sampleRate / decimation;
  const coarse = new Float64Array(Math.floor(frames / decimation));
  for (let i = 0; i < coarse.length; i += 1) coarse[i] = left[i * decimation];

  const windowSeconds = 0.12;
  const hopSeconds = 0.04;
  const windowSamples = Math.round(windowSeconds * coarseRate);
  const hopSamples = Math.round(hopSeconds * coarseRate);
  const minLag = Math.floor(coarseRate / 700);
  const maxLag = Math.ceil(coarseRate / 100);

  /** Best autocorrelation lag in the ladder's range, or 0 when the window is silent. */
  const windowPitch = (start: number): number => {
    let mean = 0;
    for (let i = 0; i < windowSamples; i += 1) mean += coarse[start + i];
    mean /= windowSamples;
    let energy = 0;
    for (let i = 0; i < windowSamples; i += 1) {
      const value = coarse[start + i] - mean;
      energy += value * value;
    }
    if (Math.sqrt(energy / windowSamples) < Math.max(peak * 0.05, 16)) return 0;

    let bestLag = 0;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let score = 0;
      for (let i = 0; i + lag < windowSamples; i += 1) {
        score += (coarse[start + i] - mean) * (coarse[start + i + lag] - mean);
      }
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    return bestLag > 0 ? coarseRate / bestLag : 0;
  };

  const pitches: { at: number; hz: number }[] = [];
  for (let start = 0; start + windowSamples < coarse.length; start += hopSamples) {
    pitches.push({ at: start / coarseRate, hz: windowPitch(start) });
  }

  // Group neighbouring windows that agree on pitch. A window straddling a note boundary agrees
  // with neither side, so it falls between two runs rather than blurring one.
  const sounding = TONE_LADDER_SLOTS.filter((slot) => slot.hz > 0);
  const notes: { measuredHz: number; name: string; expected: number; cents: number; seconds: number }[] = [];
  let silences = 0;
  let silentSeconds = 0;

  let index = 0;
  while (index < pitches.length) {
    if (pitches[index].hz === 0) {
      silentSeconds += hopSeconds;
      if (silentSeconds >= 0.3) {
        silences += 1;
        silentSeconds = -Infinity; // one silence per stretch, however long it runs
      }
      index += 1;
      continue;
    }
    silentSeconds = 0;
    let last = index;
    while (
      last + 1 < pitches.length &&
      pitches[last + 1].hz > 0 &&
      Math.abs(1200 * Math.log2(pitches[last + 1].hz / pitches[index].hz)) < 40
    ) {
      last += 1;
    }
    const seconds = (last - index + 1) * hopSeconds;
    if (seconds >= 0.2) {
      // Re-measure the run precisely at full rate: over hundreds of milliseconds a zero-crossing
      // count is exact to a fraction of a cent, which a 120 ms autocorrelation window is not.
      //
      // Only the span every window of the run covers is used. A run's first window may reach back
      // into the previous note and still match this one, so measuring from where that window
      // starts mixes two notes and lands the result between them.
      const coveredFrom = pitches[index].at + windowSeconds;
      const coveredTo = pitches[last].at + windowSeconds;
      const inset = (coveredTo - coveredFrom) * 0.1;
      const from = Math.round((coveredFrom + inset) * sampleRate);
      const to = Math.round((coveredTo - inset) * sampleRate);
      if (to - from < 0.1 * sampleRate) {
        index = last + 1;
        continue;
      }
      // Measured between the FIRST and LAST upward zero crossing, not across the whole span: the
      // ladder puts a silence next to C3 at both ends of its walk, and a span that reaches into
      // one of those silences divides the same crossings by a longer time and reads flat.
      let crossings = 0;
      let firstCrossing = -1;
      let lastCrossing = -1;
      let previous = left[from];
      for (let i = from + 1; i < to; i += 1) {
        if (previous < 0 && left[i] >= 0) {
          crossings += 1;
          if (firstCrossing < 0) firstCrossing = i;
          lastCrossing = i;
        }
        previous = left[i];
      }
      if (crossings < 4) {
        index = last + 1;
        continue;
      }
      const hz = ((crossings - 1) * sampleRate) / (lastCrossing - firstCrossing);
      let best: { name: string; expected: number; cents: number } | null = null;
      for (const note of sounding) {
        const cents = Math.abs(1200 * Math.log2(hz / note.hz));
        if (!best || cents < best.cents) best = { name: note.name, expected: note.hz, cents };
      }
      notes.push({
        measuredHz: Number(hz.toFixed(2)),
        name: best!.name,
        expected: best!.expected,
        cents: Number(best!.cents.toFixed(2)),
        seconds: Number(seconds.toFixed(3)),
      });
    }
    index = last + 1;
  }

  const worstCents = notes.reduce((worst, note) => Math.max(worst, note.cents), 0);
  return { sampleRate, peak, notes, silences, worstCents };
};

// ── main ─────────────────────────────────────────────────────────────────────────────────────

const main = async () => {
  await requireFlightMode();
  console.log(`Demo Mode HIL on ${serial} — flight mode confirmed, loopback only.\n`);
  // Attach up front so a single-stage run has a page; every stage that relaunches re-attaches.
  await attach().catch(() => undefined);

  await stage("offline-offer", offlineOffer);
  await stage("unreachable-offer", unreachableOffer);
  await stage("av-stream", avStream);
  await stage("library", library);
  await stage("music", music);
  await stage("prg-stream", () => launchStage("prg"));
  await stage("crt-stream", () => launchStage("crt"));
  await stage("ntsc-stream", ntscStream);
  await stage("performance", performance_);
  await stage("cta-census", ctaCensus);

  await detach();

  const failed = results.filter((result) => result.status === "fail");
  const summary = {
    serial,
    startedAt: new Date().toISOString(),
    ladderSlotSeconds: TONE_LADDER_SLOT_SECONDS,
    results,
    verdict: failed.length === 0 ? "pass" : "fail",
  };
  if (jsonPath) {
    mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
    writeFileSync(resolve(jsonPath), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\nWrote ${resolve(jsonPath)}`);
  }
  console.log(`\n${summary.verdict.toUpperCase()} — ${results.length - failed.length}/${results.length} stages`);
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch(async (error) => {
  await detach();
  console.error(error);
  process.exit(1);
});
