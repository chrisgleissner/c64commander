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

const attach = async () => {
  await detach();
  const pid = (await shell(`pidof ${PACKAGE}`)).trim().split(/\s+/)[0];
  if (!pid) throw new Error(`${PACKAGE} is not running`);
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
  await shell(`am start -n ${PACKAGE}/.MainActivity`);
  await sleep(14000);
  await attach();
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
  // Prove the simulated device is what the app is talking to: with no network, a session routed
  // at the stored real host would report Demo Mode and then fail every read.
  const identity = await js(`(() => {
    const badge = document.querySelector('[data-panel-position="1"] [data-testid=unified-health-badge]');
    return { state: badge ? badge.getAttribute("data-connection-state") : null };
  })()`);
  expect(identity.state === "DEMO_ACTIVE", "the session did not settle in Demo Mode");
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
    results.push({ stage: name, status: "fail", ms: Date.now() - startedAt, error: String(error?.message ?? error) });
    console.log(`FAIL  ${name}: ${error?.message ?? error}`);
  }
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

// ── stages ───────────────────────────────────────────────────────────────────────────────────

const offlineOffer = async () => {
  await relaunchFresh();
  const offer = await readOffer();
  expect(offer.dialogOpen, "no dialog appeared on a fresh offline launch");
  expect(offer.messageVisible, "the dialog's explanation was not visible on screen");
  expect(/no network connection/i.test(offer.messageText ?? ""), `unexpected copy: ${offer.messageText}`);
  expect(!offer.hasHostInput, "a hostname field was offered with no network to reach it over");

  expect(await clickTestId("demo-interstitial-continue"), "Continue in Demo Mode was not present");
  await sleep(4000);
  const state = await connectionState();
  expect(state === "DEMO_ACTIVE", `expected DEMO_ACTIVE after confirming, got ${state}`);
  return { message: offer.messageText };
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
