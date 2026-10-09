/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Playback parity on the bench: the scenarios of playwright/parity/playbackParityScenarios.ts, which
 * CI runs on the web build against the mock server, run here on the phone against real Ultimates,
 * with real touches on the transport and a microphone at the phone's grille.
 *
 *   npx tsx tools/hil/playback_parity_hil.ts --hosts c64u,u64,u2 --json artifacts/playback-parity.json
 *
 * For each host it uploads two generated tunes to the Ultimate's storage, adds them to the app's
 * playlist through the app's own picker if they are not there, switches the app to that host and
 * runs every scenario with the tune on the phone and on the C64:
 *
 * - Seek_Counter, a silent tune that counts its play calls, so on the C64 every landing is checked
 *   against where the tune really is;
 * - Tone-Low, a steady 550 Hz tone, for the scenario that listens: no sound while a seek rewinds.
 *
 * The phone's media volume is held at --volume (5 of 25 by default, never above 10) and restored.
 * The Ultimate-II+(L) shares its C64 with the c64u on this bench; it can only start the player while
 * the c64u's Cartridge Preference is External (see the memory note), which the run sets for the u2
 * and puts back afterwards.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  PARITY_SCENARIOS,
  ParityFailure,
  type ParityDriver,
  type ParityRoute,
  type SoundTrace,
} from "../../playwright/parity/playbackParityScenarios";
import { connectPage } from "./cdp_page.mjs";
import { createDroidDevice } from "./droidctl_device.mjs";
import { callHzOfTune, counterPsid, type CounterTune } from "./remoteSeekHil/tunes";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const HOSTS = arg("hosts", "c64u,u64,u2").split(",");
const ROUTES = arg("routes", "phone,c64").split(",") as ParityRoute[];
const OUT = arg("json", "artifacts/playback-parity.json");
const VOLUME = Math.min(10, Number(arg("volume", "5")));
const MIC_DEVICE = arg("mic", "plughw:CARD=SF558,DEV=0");
const ONLY = arg("only", "");
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
/** Stepped with the volume keys: `cmd media_session volume --set` leaves a muted stream where it was. */
const setVolume = async (target: number) => {
  if (target > 10) throw new Error("the phone's media volume never goes above 10 of 25");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { muted, index } = await readVolume();
    if (!muted && index === target) return;
    await droid.pressKey(index < target || muted ? 24 : 25);
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

/** Point the app at `host` through the switch-device picker the health badge opens. */
const switchTo = async (host: string) => {
  const current = await js<string | null>(
    `document.querySelector('[data-testid="unified-health-badge"]')?.getAttribute("data-connected-device") ?? null`,
  );
  if (current?.toLowerCase().includes(host)) return;
  await js(
    `document.querySelector('[data-testid="unified-health-badge"]')?.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true}))`,
  );
  await waitFor('[data-testid="switch-device-sheet"]');
  const switched =
    await js<boolean>(`(()=>{const rows=[...document.querySelectorAll('[data-testid^="switch-device-row-"]')];
const row=rows.find(r=>(r.innerText||"").toLowerCase().includes(${JSON.stringify(host)}));if(!row)return false;row.click();return true;})()`);
  if (!switched) throw new Error(`the app has no saved device for ${host}`);
  for (let waited = 0; waited < 30000; waited += 500) {
    const state = await js<string | null>(
      `document.querySelector('[data-testid="unified-health-badge"]')?.getAttribute("data-connected-device") ?? null`,
    );
    if (state?.toLowerCase().includes(host)) return;
    await sleep(500);
  }
  throw new Error(`the app did not connect to ${host}`);
};

const playlistTitles = () =>
  js<string[]>(
    `[...document.querySelectorAll('[data-testid="playlist-item"]')].map(e=>(e.innerText||"").split(String.fromCharCode(10))[0].trim())`,
  );

/** Add the two tunes from the Ultimate's storage through the app's own picker, as a user would. */
const ensureInPlaylist = async (host: string) => {
  const titles = await playlistTitles();
  const missing = ["Seek_Counter", "Tone-Low"].filter((title) => !titles.some((t) => t.startsWith(title)));
  if (!missing.length) return;
  await click('[aria-label="Add items"], [aria-label="Add more items"]');
  await waitFor('[data-testid="import-option-c64u"]');
  await click('[data-testid="import-option-c64u"]');
  await waitFor('[data-testid="navigate-root"]');
  await click('[data-testid="navigate-root"]');
  for (const folder of STORAGE[host].split("/").filter(Boolean)) {
    await waitFor(`[aria-label="Open ${folder}"]`);
    await click(`[aria-label="Open ${folder}"]`);
  }
  for (const title of missing) {
    await waitFor(`[aria-label="Select ${title}.sid"]`);
    await click(`[aria-label="Select ${title}.sid"]`);
  }
  await click('[data-testid="add-items-confirm"]');
  for (let waited = 0; waited < 20000; waited += 500) {
    const now = await playlistTitles();
    if (["Seek_Counter", "Tone-Low"].every((title) => now.some((t) => t.startsWith(title)))) return;
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

// ---- the driver -------------------------------------------------------------------------------------

const parseClock = (text: string) => {
  const match = /(\d+):(\d\d)/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const benchDriver = (host: string, tune: () => string, baseline: Record<string, string | null>): ParityDriver => ({
  label: `the phone against ${host}`,
  async startTune(route) {
    await openPlay();
    await pickRoute(route);
    const title = tune();
    const started = await js<boolean>(`(()=>{const rows=[...document.querySelectorAll('[data-testid="playlist-item"]')];
const row=rows.find(r=>(r.innerText||"").startsWith(${JSON.stringify(title)}));
const play=row?.querySelector('button[aria-label^="Play "]');if(!play)return false;play.click();return true;})()`);
    if (!started) throw new ParityFailure(`${title} has no Play button in the playlist`);
    for (let waited = 0; waited < 20000; waited += 500) {
      const ready = await js<boolean>(
        `/hold to fast forward/.test(document.querySelector('[data-testid="playlist-next"]')?.title ?? "")`,
      );
      if (ready) return;
      await sleep(500);
    }
    throw new ParityFailure(`seeking was not offered for ${title} on the ${route} route`);
  },
  tap: (testId) => touch(testId),
  hold: (testId, ms) => touch(testId, 0.5, ms),
  tapBar: (fraction) => touch("playback-progress-seek", fraction),
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
    if (journal) changed.push(`journal left: ${journal}`);
    return changed;
  },
  listen,
  wait: sleep,
});

// ---- the run ----------------------------------------------------------------------------------------

type Outcome = { host: string; route: ParityRoute; scenario: string; ok: boolean; detail?: string; ms: number };
const outcomes: Outcome[] = [];
const initialVolume = await readVolume();
await droid.call("droid_app.start_app", { targetId: droid.targetId, package: PACKAGE, waitForResume: true });
await sleep(4000);
await attach();
const cartridgePreference = HOSTS.includes("u2")
  ? await configValue("c64u", "C64 and Cartridge Settings", "Cartridge Preference")
  : null;
try {
  await setVolume(VOLUME);
  for (const host of HOSTS) {
    if (host === "u2") await setConfig("c64u", "C64 and Cartridge Settings", "Cartridge Preference", "External");
    try {
      await prepareTunes(host);
      await openPlay();
      await switchTo(host);
      await openPlay();
      await ensureInPlaylist(host);
      const baseline = {
        cpu: await configValue(host, "U64 Specific Settings", "CPU Speed"),
        turbo: await configValue(host, "U64 Specific Settings", "Turbo Control"),
        master: await configValue(host, "Audio Mixer", "Vol Master"),
      };
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
      if (host === "u2" && cartridgePreference !== null)
        await setConfig("c64u", "C64 and Cartridge Settings", "Cartridge Preference", cartridgePreference);
      await rest(host, "/v1/machine:reset", "PUT").catch((error) => log(`could not reset ${host}: ${error}`));
    }
  }
} finally {
  await setVolume(Math.min(10, Math.max(0, initialVolume.index))).catch((error) =>
    log(`could not put the media volume back to ${initialVolume.index}: ${error}`),
  );
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ hosts: HOSTS, routes: ROUTES, volume: VOLUME, outcomes }, null, 2));
  page?.close();
}
const failed = outcomes.filter((outcome) => !outcome.ok);
log(`${outcomes.length - failed.length} of ${outcomes.length} passed`);
process.exit(failed.length ? 1 : 0);
