/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Playback parity on the bench: playwright/parity/playbackParityScenarios.ts on the phone against real Ultimates, with
// real touches and a microphone at the grille, using generated tunes Seek_Counter (counts play calls, so C64 landings
// are exact) and Tone-Low (550 Hz, for no sound while a seek rewinds). Media volume is held at --volume (default 7 of
// 25, never above 10) and restored; for the u2 the c64u's Cartridge Preference is set to External and put back.
// Commands: docs/testing/remote-sid-seek.md.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runChaos, type ChaosDriver, type ChaosRecord } from "../../playwright/parity/chaosScenario";
import {
  PARITY_SCENARIOS,
  ParityFailure,
  type ClockRecording,
  type ClockTransition,
  type ParityRoute,
  type SoundTrace,
} from "../../playwright/parity/playbackParityScenarios";
import { locateSidPlayerClock } from "@/lib/playback/remoteSeek/sidPlayerClock";
import { readClockFromRow, SCREEN_COLUMNS } from "@/lib/playback/remoteSeek/sidPlayerScreen";
import { connectPage } from "./cdp_page.mjs";
import { createDroidDevice } from "./droidctl_device.mjs";
import { openMachineJournal, restoreFromMachineJournal } from "./remoteSeekHil/machineJournal";
import { callHzOfTune, counterPsid, type CounterTune } from "./remoteSeekHil/tunes";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const HOSTS = arg("hosts", "c64u,u2").split(",");
const ROUTES = arg("routes", "phone,c64").split(",") as ParityRoute[];
const OUT = arg("json", "artifacts/playback-parity.json");
/**
 * 7 of 25: the on-phone path reaches the microphone 7.5 dB quieter than the mirror, and the merge gate
 * found it too quiet to grade at 3 and 5. Never above 10.
 */
const VOLUME = Math.min(10, Number(arg("volume", "7")));
const MIC_DEVICE = arg("mic", "plughw:CARD=SF558,DEV=0");
const ONLY = arg("only", "");
/** Minutes of seeded chaos per host instead of the parity scenarios; 0 runs the scenarios. */
const CHAOS_MINUTES = Number(arg("chaos", "0"));
const CHAOS_SEED = Number(arg("seed", String(Date.now() % 1_000_000)));
const PACKAGE = "uk.gleissner.c64commander";
const CDP_PORT = 9333;
const COUNTER_TUNE: CounterTune = { name: "Seek_Counter", video: "PAL", busyLoops: 60, ciaTimer: null };
const TONE_HZ = 550;
const STORAGE = { c64u: "/USB2/SeekSoak", u64: "/USB2/SeekSoak", u2: "/USB0/SeekSoak" } as Record<string, string>;
const SCRATCH = "artifacts/playback-parity";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const log = (line: string) => console.log(`[parity] ${line}`);

const run = (command: string, args: string[]) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => {
    const child = spawn(command, args);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ ok: code === 0, out }));
  });

const rest = async (host: string, route: string, method = "GET") => {
  const response = await fetch(`http://${host}${route}`, { method, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${method} ${route} on ${host}: HTTP ${response.status}`);
  return response;
};
const configValue = async (host: string, category: string, item: string): Promise<string | null> => {
  const response = await fetch(
    `http://${host}/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as Record<string, Record<string, { current?: string }>>;
  return body[category]?.[item]?.current ?? null;
};
const setConfig = (host: string, category: string, item: string, value: string) =>
  rest(
    host,
    `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}?value=${encodeURIComponent(value)}`,
    "PUT",
  );

// ---- the tunes on the Ultimate ---------------------------------------------------------------------

const prepareTunes = async (host: string) => {
  mkdirSync(SCRATCH, { recursive: true });
  const counter = path.join(SCRATCH, "Seek_Counter.sid");
  writeFileSync(counter, counterPsid(COUNTER_TUNE));
  const tone = path.join(SCRATCH, "Tone-Low.sid");
  const generated = await run("node", [
    "scripts/generate-test-sid.mjs",
    "--hz",
    String(TONE_HZ),
    "--name",
    "Tone-Low",
    "--waveform",
    "sawtooth",
    "--volume",
    "15",
    "--out",
    tone,
  ]);
  if (!generated.ok) throw new Error(`could not generate the tone tune: ${generated.out}`);
  for (const file of [counter, tone]) {
    const uploaded = await run("curl", ["-s", "--ftp-create-dirs", "-T", file, `ftp://${host}${STORAGE[host]}/`]);
    if (!uploaded.ok) throw new Error(`could not upload ${file} to ${host}: ${uploaded.out}`);
  }
};

// ---- the phone -------------------------------------------------------------------------------------

type Page = Awaited<ReturnType<typeof connectPage>>;
const droid = await createDroidDevice({});
let page: Page | null = null;

const attach = async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await droid.forwardWebview(PACKAGE, CDP_PORT);
      page?.close();
      page = await connectPage(String(CDP_PORT));
      await page.evaluate("1");
      return;
    } catch (error) {
      log(`attaching to the WebView, attempt ${attempt}, failed: ${(error as Error).message}`);
      if (attempt === 8) throw error;
      await sleep(1500);
    }
  }
};
const js = async <T>(expression: string): Promise<T> => (await page!.evaluate(expression)) as T;

const readVolume = async () => {
  const stdout = await droid.shell(["dumpsys", "audio"]);
  const block = stdout.split("- STREAM_MUSIC:")[1] ?? "";
  return {
    muted: /Muted:\s*true/.test(block.split("- STREAM")[0] ?? ""),
    index: Number(/streamVolume:(\d+)/.exec(block)?.[1] ?? "-1"),
  };
};
/**
 * Stepped with the volume keys: `cmd media_session volume --set` leaves a muted stream where it was.
 * Volume up is pressed only on a level just read, and never from 10 of 25 or above.
 */
const setVolume = async (target: number) => {
  if (target > 10) throw new Error("the phone's media volume never goes above 10 of 25");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { muted, index } = await readVolume();
    if (index < 0) throw new Error("could not read the phone's media volume, so it was not changed");
    if (!muted && index === target) return;
    const up = muted || index < target;
    if (up && index >= 10) throw new Error(`the media volume is ${index} of 25; it is never raised from 10 or above`);
    await droid.pressKey(up ? 24 : 25);
    await sleep(250);
  }
  throw new Error(`could not set the media volume to ${target}`);
};

type Box = { x: number; y: number; w: number; h: number; dpr: number };
const boxOf = (testId: string) =>
  js<Box | null>(`(()=>{const e=document.querySelector('[data-testid="${testId}"]');if(!e)return null;
e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();
return {x:r.x,y:r.y,w:r.width,h:r.height,dpr:devicePixelRatio};})()`);
const touch = async (testId: string, fraction = 0.5, holdMs?: number) => {
  const box = await boxOf(testId);
  if (!box) throw new Error(`${testId} is not on the page`);
  await droid.call("droid_input.tap", {
    targetId: droid.targetId,
    x: box.x + box.w * fraction,
    y: box.y + box.h / 2,
    units: "css",
    dpr: box.dpr,
    ...(holdMs ? { hold: holdMs } : {}),
  });
};

/** Click through the app as a script, for setup only; scenarios use real touches. */
const click = (selector: string) =>
  js<boolean>(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true;})()`,
  );
const waitFor = async (selector: string, timeoutMs = 15000) => {
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    if (await js<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(250);
  }
  throw new Error(`${selector} did not appear`);
};

const openPlay = async () => {
  await click('[data-testid="tab-play"]');
  await waitFor('[data-testid="playlist-play"]');
};

const machineSettings = async (host: string): Promise<Record<string, string | null>> => ({
  cpu: await configValue(host, "U64 Specific Settings", "CPU Speed"),
  turbo: await configValue(host, "U64 Specific Settings", "Turbo Control"),
  master: await configValue(host, "Audio Mixer", "Vol Master"),
});

const uniqueIdOf = async (host: string) =>
  ((await (await rest(host, "/v1/info")).json()) as { unique_id?: string }).unique_id ?? null;

/** Point the app at `host` through the switch-device picker the health badge opens. */
const switchTo = async (host: string) => {
  const current = await js<string | null>(
    `document.querySelector('[data-testid="unified-health-badge"]')?.getAttribute("data-connected-device") ?? null`,
  );
  if (
    current &&
    (current.toLowerCase().includes(host) || (await uniqueIdOf(current).catch(() => null)) === (await uniqueIdOf(host)))
  )
    return;
  await js(
    `document.querySelector('[data-testid="unified-health-badge"]')?.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true}))`,
  );
  await waitFor('[data-testid="switch-device-sheet"]');
  // A saved device is labelled by the name or address it was added with, and a machine on both Ethernet
  // and Wi-Fi answers on either, so rows are matched by the machine's own id rather than by text.
  const wanted = await uniqueIdOf(host);
  const labels = await js<string[]>(
    `[...document.querySelectorAll('[data-testid^="switch-device-row-"]')].map(r=>(r.innerText||"").trim().split(/\\s/)[0])`,
  );
  const index = (await Promise.all(labels.map((label) => uniqueIdOf(label).catch(() => null)))).indexOf(wanted);
  if (index < 0) throw new Error(`the app has no saved device for ${host}`);
  await js(`document.querySelectorAll('[data-testid^="switch-device-row-"]')[${index}].click()`);
  for (let waited = 0; waited < 30000; waited += 500) {
    const state = await js<string | null>(
      `document.querySelector('[data-testid="unified-health-badge"]')?.getAttribute("data-connected-device") ?? null`,
    );
    if (state?.toLowerCase().includes(labels[index].toLowerCase())) return;
    await sleep(500);
  }
  throw new Error(`the app did not connect to ${host}`);
};

/** Titles as the playlist shows them; friendly names show `Seek_Counter` as "Seek Counter". */
const playlistTitles = async () =>
  (
    await js<string[]>(
      `[...document.querySelectorAll('[data-testid="playlist-item"]')].map(e=>(e.innerText||"").split(String.fromCharCode(10))[0].trim())`,
    )
  ).map((title) => title.replace(/_/g, " "));
const shownTitle = (title: string) => title.replace(/_/g, " ");

/** Add the two tunes from the Ultimate's storage through the app's own picker, as a user would. */
const ensureInPlaylist = async (host: string) => {
  // The playlist hydrates from storage after the page shows; an empty list may only not be there yet.
  for (let waited = 0; waited < 10000 && (await playlistTitles()).length === 0; waited += 250) await sleep(250);
  const titles = await playlistTitles();
  const missing = ["Seek_Counter", "Tone-Low"].filter((title) => !titles.some((t) => t.startsWith(shownTitle(title))));
  if (!missing.length) return;
  await click('[data-testid="add-items-to-playlist"]');
  await waitFor('[data-testid="import-option-c64u"]');
  await click('[data-testid="import-option-c64u"]');
  // The picker reopens the folder it last showed, and that listing can land after a click on Root.
  const pathIs = (expected: string) =>
    js<boolean>(
      `document.querySelector('[data-testid="source-path-label"]')?.innerText?.trim()===${JSON.stringify(expected)}`,
    );
  await sleep(1500);
  const alreadyThere = await pathIs(STORAGE[host]);
  for (let attempt = 0; !alreadyThere && !(await pathIs("/")); attempt += 1) {
    if (attempt === 20) throw new Error("the picker did not go to the root");
    await waitFor('[data-testid="navigate-root"]');
    await click('[data-testid="navigate-root"]');
    await sleep(1000);
  }
  let shown = "";
  for (const folder of alreadyThere ? [] : STORAGE[host].split("/").filter(Boolean)) {
    await waitFor(`[aria-label="Open ${folder}"]`);
    await click(`[aria-label="Open ${folder}"]`);
    shown += `/${folder}`;
    for (let waited = 0; !(await pathIs(shown)); waited += 250) {
      if (waited > 15000) throw new Error(`the picker did not open ${shown}`);
      await sleep(250);
    }
  }
  for (const title of missing) {
    await waitFor(`[aria-label="Select ${title}.sid"]`);
    await click(`[aria-label="Select ${title}.sid"]`);
  }
  await click('[data-testid="add-items-confirm"]');
  for (let waited = 0; waited < 20000; waited += 500) {
    const now = await playlistTitles();
    if (["Seek_Counter", "Tone-Low"].every((title) => now.some((t) => t.startsWith(shownTitle(title))))) return;
    await sleep(500);
  }
  throw new Error("the tunes did not reach the playlist");
};

const pickRoute = async (route: ParityRoute) => {
  const id = route === "phone" ? "playback-engine-local" : "playback-engine-c64";
  if (!(await click(`[data-testid="${id}"]`))) {
    await click('[data-testid="playback-engine-toggle"]');
    await sleep(900);
    if (!(await click(`[data-testid="${id}"]`))) throw new Error(`the ${route} output is not offered`);
  }
  await sleep(1200);
};

// ---- the microphone ---------------------------------------------------------------------------------

/** Tone presence per 100 ms window: power at TONE_HZ against the loudest window of the take. */
const toneTrace = (wav: Buffer, startedAt: number): SoundTrace => {
  const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, Math.floor((wav.length - 44) / 2));
  const rate = 48000;
  const window = rate / 10;
  const coefficient = 2 * Math.cos((2 * Math.PI * TONE_HZ) / rate);
  const powers: number[] = [];
  for (let start = 0; start + window <= samples.length; start += window) {
    let previous = 0;
    let beforePrevious = 0;
    for (let index = start; index < start + window; index += 1) {
      const current = samples[index] / 32768 + coefficient * previous - beforePrevious;
      beforePrevious = previous;
      previous = current;
    }
    powers.push(previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious);
  }
  const loudest = Math.max(...powers, 1e-12);
  // Within 15 dB of the tone at its loudest: the room's floor in this band is 30 dB below it.
  return { windowMs: 100, present: powers.map((power) => power >= loudest / 31.6), startedAt };
};

const listen = async (during: () => Promise<void>): Promise<SoundTrace> => {
  const wav = path.join(SCRATCH, `listen-${Date.now()}.wav`);
  const recorder = spawn("arecord", [
    "-q",
    "-D",
    MIC_DEVICE,
    "-f",
    "S16_LE",
    "-r",
    "48000",
    "-c",
    "1",
    "-d",
    "60",
    wav,
  ]);
  const startedAt = Date.now();
  await sleep(300);
  try {
    await during();
  } finally {
    recorder.kill("SIGINT");
    await new Promise((resolve) => recorder.on("close", resolve));
  }
  return toneTrace(readFileSync(wav), startedAt);
};

// ---- the clocks -------------------------------------------------------------------------------------

/** Read the C64's memory over REST; reads only, so nothing on the machine changes. */
const readMemory = (host: string) => async (address: string, length: number) =>
  new Uint8Array(await (await rest(host, `/v1/machine:readmem?address=${address}&length=${length}`)).arrayBuffer());

/** Phone time minus host time, from the CDP round trip that took the least time. */
const phoneClockOffsetMs = async () => {
  let best = { rtt: Infinity, offset: 0 };
  for (let probe = 0; probe < 12; probe += 1) {
    const sentAt = Date.now();
    const phoneNow = await js<number>("Date.now()");
    const rtt = Date.now() - sentAt;
    if (rtt < best.rtt) best = { rtt, offset: phoneNow - (sentAt + rtt / 2) };
  }
  return best.offset;
};

const DEVICE_CLOCK_POLL_MS = 50;

/**
 * Every change of the second on the phone's elapsed label (timed on the phone, moved to the host's
 * clock) and on the SID player's own clock (read over REST every 50 ms, each change placed halfway
 * between the read that last saw the old second and the one that first saw the new one).
 */
const recordClocks = async (host: string, during: () => Promise<void>): Promise<ClockRecording> => {
  const clock = await locateSidPlayerClock(readMemory(host));
  if (!clock) throw new ParityFailure(`the SID player's clock is not on ${host}'s screen`);
  const offsetMs = await phoneClockOffsetMs();
  await js(`(()=>{const log=[];window.__clockLog=log;const e=document.querySelector('[data-testid="playback-elapsed"]');
new MutationObserver(()=>log.push({atMs:Date.now(),text:e.textContent||""})).observe(e,{subtree:true,childList:true,characterData:true});})()`);
  const device: ClockTransition[] = [];
  let polling = true;
  const poll = (async () => {
    let lastReadAt = 0;
    while (polling) {
      const sentAt = Date.now();
      const seconds = readClockFromRow(
        await readMemory(host)(clock.rowAddress.toString(16).toUpperCase().padStart(4, "0"), SCREEN_COLUMNS),
        clock,
      );
      const readAt = (sentAt + Date.now()) / 2;
      if (seconds !== null && device.at(-1)?.seconds !== seconds) {
        device.push({ atMs: lastReadAt ? (lastReadAt + readAt) / 2 : readAt, seconds });
      }
      lastReadAt = readAt;
      await sleep(Math.max(0, DEVICE_CLOCK_POLL_MS - (Date.now() - sentAt)));
    }
  })();
  try {
    await during();
  } finally {
    polling = false;
    await poll;
  }
  const log = await js<Array<{ atMs: number; text: string }>>("window.__clockLog");
  const page: ClockTransition[] = [];
  for (const { atMs, text } of log) {
    const seconds = /[⏵⏸]/.test(text) ? null : parseClock(text);
    if (seconds !== null && page.at(-1)?.seconds !== seconds) page.push({ atMs: atMs - offsetMs, seconds });
  }
  return { page, device };
};

// ---- the driver -------------------------------------------------------------------------------------

const parseClock = (text: string) => {
  const match = /(\d+):(\d\d)/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** A finger held down with motionevent, released with UP at the same place. */
let fingerDownAt: { x: number; y: number } | null = null;

const pressDown = async (testId: string, fraction = 0.5) => {
  const box = await boxOf(testId);
  if (!box) throw new Error(`${testId} is not on the page`);
  const x = Math.round((box.x + box.w * fraction) * box.dpr);
  const y = Math.round((box.y + box.h / 2) * box.dpr);
  await droid.shell(["input", "motionevent", "DOWN", String(x), String(y)]);
  fingerDownAt = { x, y };
};

const liftFinger = async () => {
  if (!fingerDownAt) return;
  const { x, y } = fingerDownAt;
  fingerDownAt = null;
  await droid.shell(["input", "motionevent", "UP", String(x), String(y)]);
};

/** The app's log since `sinceMs` (host time), newest last; the phone's clock is not the host's. */
const appLogSince = async (sinceMs: number, levels: string[] | null) => {
  const offsetMs = await phoneClockOffsetMs();
  const entries = await js<Array<{ level?: string; message?: string; timestamp?: string; details?: unknown }>>(
    `JSON.parse(localStorage.getItem("c64u_app_logs") ?? "[]")`,
  );
  return entries
    .filter((entry) => Date.parse(entry.timestamp ?? "") >= sinceMs + offsetMs)
    .filter((entry) =>
      levels ? levels.includes(entry.level ?? "") : !/^(C64 API request|Device request)/.test(entry.message ?? ""),
    )
    .reverse();
};

const relaunch = async () => {
  await droid.call("droid_app.start_app", { targetId: droid.targetId, package: PACKAGE, waitForResume: true });
  await sleep(4000);
  await attach();
  await openPlay();
};

const benchDriver = (host: string, tune: () => string, baseline: Record<string, string | null>): ChaosDriver => ({
  label: `the phone against ${host}`,
  async startTune(route) {
    await openPlay();
    const title = tune();
    const playRowOnce = () =>
      js<boolean>(`(()=>{const rows=[...document.querySelectorAll('[data-testid="playlist-item"]')];
const row=rows.find(r=>(r.innerText||"").replace(/_/g," ").startsWith(${JSON.stringify(shownTitle(title))}));
const play=row?.querySelector('button[aria-label^="Play "]');if(!play)return false;play.click();return true;})()`);
    const playRow = async () => {
      for (let waited = 0; waited < 10000; waited += 250) {
        if (await playRowOnce()) return true;
        await sleep(250);
      }
      return false;
    };
    // The output chooser is only on the page while a SID is the current tune; changing the output
    // hands the tune over, so it is started once more on the route it is meant for.
    if (!(await playRow())) throw new ParityFailure(`${title} has no Play button in the playlist`);
    await sleep(2500);
    const engine = await js<string | null>(
      `document.querySelector('[data-testid="playback-engine-toggle"]')?.getAttribute("data-engine") ?? null`,
    );
    if (engine !== (route === "phone" ? "local" : "c64")) {
      await pickRoute(route);
      if (!(await playRow())) throw new ParityFailure(`${title} has no Play button in the playlist`);
    }
    // The previous instance's seek is still offered for a moment after the tune starts again.
    await sleep(4000);
    for (let waited = 0; waited < 20000; waited += 500) {
      const ready = await js<boolean>(
        `/hold to fast forward/.test(document.querySelector('[data-testid="playlist-next"]')?.title ?? "")`,
      );
      if (ready) {
        // The machine as the tune left it, not as it was before: an Ultimate 64's SID player switches
        // Turbo Control to "U64 Turbo Registers" when it starts a tune, and a seek gives back that.
        Object.assign(baseline, await machineSettings(host));
        return;
      }
      await sleep(500);
    }
    throw new ParityFailure(`seeking was not offered for ${title} on the ${route} route`);
  },
  // A second finger while one holds: a JS click, as another touch would end the held one's gesture.
  tap: (testId) =>
    fingerDownAt
      ? js(`document.querySelector('[data-testid="${testId}"]')?.click()`).then(() => undefined)
      : touch(testId),
  hold: (testId, ms) => touch(testId, 0.5, ms),
  tapBar: (fraction) => touch("playback-progress-seek", fraction),
  waitingForRender: () => js<boolean>(`!!document.querySelector('[data-testid="playback-pending-status"]')`),
  async shownSeconds() {
    const state = await js<{
      waiting: boolean;
      text: string;
    }>(`({waiting:!!document.querySelector('[aria-label^="Waiting to continue at"]'),
text:document.querySelector('[data-testid="playback-elapsed"]')?.innerText ?? ""})`);
    return state.waiting || state.text.includes("⏵") ? null : parseClock(state.text);
  },
  async durationSeconds() {
    const texts = await js<string[]>(
      `["playback-elapsed","playback-remaining"].map(id=>document.querySelector('[data-testid="'+id+'"]')?.innerText ?? "")`,
    );
    return (parseClock(texts[0]) ?? 0) + (parseClock(texts[1]) ?? 0);
  },
  async transportState() {
    const labels = await js<string[]>(
      `["playlist-play","playlist-pause"].map(id=>document.querySelector('[data-testid="'+id+'"]')?.getAttribute("aria-label") ?? "")`,
    );
    if (labels[0] !== "Stop") return "stopped";
    return labels[1] === "Resume" ? "paused" : "playing";
  },
  async truthSeconds(route) {
    if (route !== "c64" || tune() !== "Seek_Counter") return null;
    const raw = new Uint8Array(await (await rest(host, "/v1/machine:readmem?address=10F0&length=3")).arrayBuffer());
    return (raw[0] | (raw[1] << 8) | (raw[2] << 16)) / callHzOfTune(COUNTER_TUNE);
  },
  async machineLeftChanged() {
    const changed: string[] = [];
    for (const [key, [category, item]] of Object.entries({
      cpu: ["U64 Specific Settings", "CPU Speed"],
      turbo: ["U64 Specific Settings", "Turbo Control"],
      master: ["Audio Mixer", "Vol Master"],
    })) {
      const now = await configValue(host, category, item);
      if (now !== baseline[key]) changed.push(`${item} ${JSON.stringify(now)}, was ${JSON.stringify(baseline[key])}`);
    }
    const input = await fetch(`http://${host}/v1/machine:input`, { signal: AbortSignal.timeout(8000) });
    if (input.ok) {
      const held = ((await input.json()) as { keyboard?: { inputs?: string[] } }).keyboard?.inputs ?? [];
      if (held.length) changed.push(`keys held: ${held.join(",")}`);
    }
    const journal = await js<string | null>(`localStorage.getItem("c64u_remote_seek_device_journal_v1")`);
    if (journal) changed.push(`journal left: ${typeof journal === "string" ? journal : JSON.stringify(journal)}`);
    return changed;
  },
  listen,
  pointerDown: pressDown,
  pointerUp: liftFinger,
  seekingOffered: () =>
    js<boolean>(`/hold to fast forward/.test(document.querySelector('[data-testid="playlist-next"]')?.title ?? "")`),
  errorsSince: async (sinceMs) => (await appLogSince(sinceMs, ["error"])).map((entry) => entry.message ?? ""),
  diagnose: async (sinceMs) =>
    (await appLogSince(sinceMs, null)).map(
      (entry) =>
        `${entry.timestamp?.slice(14, 23)} ${entry.level} ${entry.message} ${JSON.stringify(entry.details ?? "").slice(0, 200)}`,
    ),
  async disrupt(kind, ms) {
    if (kind === "kill") {
      await droid.call("droid_app.stop_app", { targetId: droid.targetId, package: PACKAGE });
      fingerDownAt = null;
      await sleep(ms);
    } else {
      await droid.pressKey(3);
      await sleep(ms);
    }
    await relaunch();
  },
  recordClocks: (during) => recordClocks(host, during),
  report: (line) => {
    log(`${host}: ${line}`);
    notes.push(`${host}: ${line}`);
  },
  wait: sleep,
});

// ---- the run ----------------------------------------------------------------------------------------

type Outcome = { host: string; route: ParityRoute; scenario: string; ok: boolean; detail?: string; ms: number };
const outcomes: Outcome[] = [];
const notes: string[] = [];
const chaos: Array<{ host: string; seed: number; records: ChaosRecord[] }> = [];
const initialVolume = await readVolume();
await droid.call("droid_app.start_app", { targetId: droid.targetId, package: PACKAGE, waitForResume: true });
await sleep(4000);
await attach();
try {
  await setVolume(VOLUME);
  for (const host of HOSTS) {
    try {
      if (host === "u2") {
        await openMachineJournal("c64u", [["C64 and Cartridge Settings", "Cartridge Preference"]]);
        await setConfig("c64u", "C64 and Cartridge Settings", "Cartridge Preference", "External");
      }
      await prepareTunes(host);
      await openPlay();
      await switchTo(host);
      await openPlay();
      await ensureInPlaylist(host);
      const baseline = await machineSettings(host);
      if (CHAOS_MINUTES > 0) {
        const driver = benchDriver(host, () => "Seek_Counter", baseline);
        log(`${host}: chaos for ${CHAOS_MINUTES} min, seed ${CHAOS_SEED}`);
        const records: ChaosRecord[] = await runChaos(
          { ...driver, report: (line) => log(`${host}: ${line}`) },
          { seed: CHAOS_SEED, minutes: CHAOS_MINUTES, routes: ROUTES },
        );
        chaos.push({ host, seed: CHAOS_SEED, records });
        for (const record of records) {
          outcomes.push({
            host,
            route: record.route,
            scenario: `chaos ${record.step}: ${record.action}`,
            ok: record.violations.length === 0,
            detail: record.violations.join("; ") || undefined,
            ms: record.ms,
          });
        }
        continue;
      }
      for (const route of ROUTES) {
        // A cartridge streams no audio, so on the C64 route nothing it plays reaches the phone's speaker.
        const scenarios = PARITY_SCENARIOS.filter(
          (s) => (!ONLY || s.name.includes(ONLY)) && !(s.needsMicrophone && route === "c64" && host === "u2"),
        );
        for (const scenario of scenarios) {
          let tune = scenario.needsMicrophone ? "Tone-Low" : "Seek_Counter";
          const driver = benchDriver(host, () => tune, baseline);
          const started = Date.now();
          try {
            await driver.startTune(route);
            await scenario.run(driver, route);
            outcomes.push({ host, route, scenario: scenario.name, ok: true, ms: Date.now() - started });
            log(`${host} ${route}: ${scenario.name}: ok`);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            outcomes.push({ host, route, scenario: scenario.name, ok: false, detail, ms: Date.now() - started });
            log(`${host} ${route}: ${scenario.name}: FAILED ${detail}`);
          } finally {
            tune = "Seek_Counter";
            await js(
              `document.querySelector('[data-testid="playlist-play"]')?.getAttribute("aria-label")==="Stop" && document.querySelector('[data-testid="playlist-play"]').click()`,
            );
            await sleep(1500);
          }
        }
      }
    } finally {
      if (host === "u2") {
        const differing = await restoreFromMachineJournal("c64u");
        if (differing.length) notes.push(`c64u not restored: ${differing.join("; ")}`);
      }
      await rest(host, "/v1/machine:reset", "PUT").catch((error) => log(`could not reset ${host}: ${error}`));
    }
  }
} finally {
  await setVolume(Math.min(10, Math.max(0, initialVolume.index))).catch((error) =>
    log(`could not put the media volume back to ${initialVolume.index}: ${error}`),
  );
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ hosts: HOSTS, routes: ROUTES, volume: VOLUME, outcomes, notes, chaos }, null, 2));
  page?.close();
}
const failed = outcomes.filter((outcome) => !outcome.ok);
log(`${outcomes.length - failed.length} of ${outcomes.length} passed`);
process.exit(failed.length ? 1 : 0);
