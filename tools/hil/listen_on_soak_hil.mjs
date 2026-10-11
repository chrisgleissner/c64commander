#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Soak the Play page's output chooser and transport with rapid, random interaction, and check after every
 * burst that the sound comes out where the listener last asked, measured at the source rather than read off
 * the screen.
 *
 * Ground truth, per target:
 *
 *   Here   the app holds a started audio player, and the C64 runs no tune
 *   C64    the app holds no started audio player, and the C64 runs a tune
 *   Both   the app holds a started audio player (the C64's streamed audio), and the C64 runs a tune
 *
 * Only AudioTrack players count; see `appPlayers`.
 *
 * The C64's audio reaching the phone is checked on the wire as well: the Ultimate streams it to the multicast
 * group 239.0.1.65:11001, which this host joins on --iface. Both needs packets from the C64; Here and C64 need
 * none, or the C64 is still streaming to a phone that is not playing it. Packets from --ignore-senders (other
 * Ultimates sharing the group) are not counted.
 *
 * "The C64 runs a tune" is read from the IRQ vector at $0314: a playing PSID or machine-code RSID always
 * replaces $EA31, and a reset puts it back (see tuneStillPlayingOnC64.ts for the measurements). The app's
 * players are counted from `dumpsys audio`, filtered to the app's pid, so another app's player is never
 * counted as ours.
 *
 *   node tools/hil/listen_on_soak_hil.mjs --serial 9B081FFAZ001WX --host 192.168.1.146 \
 *     --switches 200 --transport 200 --throttle 2.5 --small-screen --json artifacts/listen-on-soak.json
 *
 * --small-screen sets the phone to 480x640 at 240 dpi (320x427 CSS px, the smallest supported screen) and
 * restores it afterwards. --throttle slows the WebView's CPU through DevTools by the given factor.
 * Media volume is held at --volume (default 4) and never above 5.
 */

import dgram from "node:dgram";
import { writeFileSync } from "node:fs";
import { createHilCdp, sleep } from "./hil_cdp.mjs";

const PACKAGE = "uk.gleissner.c64commander";
const MAX_VOLUME = 5;
const SETTLE_TIMEOUT_MS = 12_000;
const POLL_MS = 400;

const parseArgs = (argv) => {
  const args = {
    serial: "9B081FFAZ001WX",
    host: "c64u",
    port: "9333",
    switches: 120,
    transport: 120,
    chaos: 120,
    throttle: 1,
    smallScreen: false,
    volume: 4,
    json: null,
    iface: null,
    ignoreSenders: [],
    seed: Date.now() % 100_000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (key === "small-screen") args.smallScreen = true;
    else if (key in { serial: 1, host: 1, port: 1, json: 1, iface: 1 }) args[key] = argv[++i];
    else if (key === "ignore-senders") args.ignoreSenders = argv[++i].split(",");
    else if (key in { switches: 1, transport: 1, chaos: 1, throttle: 1, volume: 1, seed: 1 })
      args[key] = Number(argv[++i]);
    else throw new Error(`unknown argument --${key}`);
  }
  if (args.volume > MAX_VOLUME) throw new Error(`--volume ${args.volume} is above the ${MAX_VOLUME} ceiling`);
  return args;
};

/** Deterministic, so a failing run can be replayed with its seed. */
const makeRandom = (seed) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const main = async () => {
  const args = parseArgs(process.argv);
  const random = makeRandom(args.seed);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const cdp = createHilCdp({ serial: args.serial, packageName: PACKAGE, port: Number(args.port) });
  const report = { args, startedAt: new Date().toISOString(), switches: [], transport: [], failures: [], errors: [] };
  const fail = (phase, detail) => {
    report.failures.push({ phase, ...detail });
    console.log(`FAIL ${phase}: ${JSON.stringify(detail)}`);
  };

  /** stdout as a string; a pipeline ending in grep is allowed to match nothing. */
  const shell = async (command) => String((await cdp.shell(`${command}; true`)) ?? "");
  const appPid = async () => (await shell(`pidof ${PACKAGE}`)).trim().split(/\s+/)[0] ?? "";
  const appPlayers = async () => {
    const pid = await appPid();
    if (!pid) return 0;
    // AudioTrack only: the app also holds a Web Audio stream (AAudio) that keeps the page awake while
    // playback runs with the screen off, and it says nothing about where the tune sounds.
    const dump = await shell("dumpsys audio | grep 'state:started' | grep 'type:android.media.AudioTrack'");
    return dump.split("\n").filter((line) => new RegExp(`u/pid:\\d+/${pid}\\b`).test(line)).length;
  };
  const readC64 = async (address, length) => {
    const response = await fetch(`http://${args.host}/v1/machine:readmem?address=${address}&length=${length}`, {
      signal: AbortSignal.timeout(3000),
    });
    return new Uint8Array(await response.arrayBuffer());
  };
  /** Whether the C64 runs a tune: a playing PSID or machine-code RSID replaces the IRQ vector at $0314. */
  const c64State = async () => {
    const vector = await readC64("0314", 2);
    const tune = !(vector[0] === 0x31 && vector[1] === 0xea);
    // Only the vector: every extra read slows the C64's answers to the app itself, which the soak is measuring.
    return { tune };
  };
  const ui = (expression) => cdp.evaluate(expression, 30_000);
  const appLogCursor = async () => ui(`JSON.parse(localStorage.getItem("c64u_app_logs") || "[]").length`);
  const appProblemsSince = async (since) =>
    ui(`(() => {
      const logs = JSON.parse(localStorage.getItem("c64u_app_logs") || "[]");
      return logs.filter((e) => e.timestamp >= ${JSON.stringify(since)} && (e.level === "warn" || e.level === "error"))
        .map((e) => e.level + ": " + e.message + " " + JSON.stringify(e.details || {}).slice(0, 160));
    })()`);

  /** A real touch at the element's centre, dispatched through the input pipeline, as a finger would be. */
  const tap = async (selector, { fraction = 0.5 } = {}) => {
    // Centred, not "nearest": "nearest" leaves a control at the top edge under the sticky app bar, and the
    // touch then lands on the bar. The hit test makes a covered control a reported miss instead of a lost tap.
    const box = await ui(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width * ${fraction};
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, covered: !(hit && (hit === el || el.contains(hit))) };
    })()`);
    if (!box) return "unavailable";
    if (box.covered) return "obscured";
    const point = [{ x: box.x, y: box.y }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return "ok";
  };
  const inPage = (id) => `[data-slot-active="true"] [data-testid="${id}"]`;
  const chooseTarget = async (target) => {
    const id = { here: "playback-engine-local", c64: "playback-engine-c64", both: "playback-listen-both" }[target];
    const open = await ui(`Boolean(document.querySelector('[data-testid="${id}"]'))`);
    if (!open) {
      if ((await tap(inPage("playback-engine-toggle"))) !== "ok") return "no-chooser";
      for (let i = 0; i < 25; i += 1) {
        if (await ui(`Boolean(document.querySelector('[data-testid="${id}"]'))`)) break;
        await sleep(20);
      }
    }
    return tap(`[data-testid="${id}"]`);
  };
  const chooserState = () =>
    ui(`(() => {
      const chip = document.querySelector('[data-slot-active="true"] [data-testid="playback-engine-toggle"]');
      return chip ? { engine: chip.dataset.engine, sounding: chip.dataset.sounding } : null;
    })()`);
  const playback = () =>
    ui(`(() => {
      const q = (id) => document.querySelector('[data-slot-active="true"] [data-testid="' + id + '"]');
      return { title: q("playback-current-title")?.innerText ?? null, elapsed: q("playback-elapsed")?.innerText ?? null,
        paused: q("playlist-pause")?.getAttribute("aria-label") === "Resume", stopped: Boolean(q("playlist-pause")?.disabled) };
    })()`);

  const audioPackets = [];
  const audioLevels = [];
  /** RMS of the C64's streamed audio over the last second, in dBFS, or null when nothing arrived. */
  const streamedDbfs = () => {
    const recent = audioLevels.filter((entry) => entry.at >= Date.now() - 1000);
    if (!recent.length) return null;
    const meanSquare = recent.reduce((total, entry) => total + entry.meanSquare, 0) / recent.length;
    return Math.round(10 * Math.log10(meanSquare / 32768 ** 2 + 1e-12));
  };
  const listenForStreamedAudio = () =>
    new Promise((resolve) => {
      if (!args.iface) return resolve(null);
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socket.on("message", (message, remote) => {
        if (args.ignoreSenders.includes(remote.address)) return;
        // A 2-byte sequence number, then signed 16-bit little-endian stereo samples.
        let sum = 0;
        let count = 0;
        for (let offset = 2; offset + 1 < message.length; offset += 2, count += 1) {
          const sample = message.readInt16LE(offset);
          sum += sample * sample;
        }
        audioPackets.push(Date.now());
        audioLevels.push({ at: Date.now(), meanSquare: count ? sum / count : 0 });
        if (audioLevels.length > 20_000) audioLevels.splice(0, 10_000);
        if (audioPackets.length > 20_000) audioPackets.splice(0, 10_000);
      });
      socket.bind(11001, () => {
        socket.addMembership("239.0.1.65", args.iface);
        resolve(socket);
      });
    });
  /** C64 audio packets on the wire in the last second, or null when the host does not listen. */
  const streamedLastSecond = () => (args.iface ? audioPackets.filter((at) => at >= Date.now() - 1000).length : null);

  const seconds = (clock) => {
    const match = /(\d+):(\d+)/.exec(clock ?? "");
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  /** Where the tune must sound for `target`, and that it is actually playing rather than loaded or frozen. */
  const matches = (target, { players, c64, ui: shown }) => {
    if (!shown || shown.paused) return false;
    const streamed = c64.streamed;
    if (target === "here") return players >= 1 && !c64.tune && (streamed === null || streamed === 0);
    if (target === "c64") return players === 0 && c64.tune && (streamed === null || streamed === 0);
    // An RSID can leave $0314 alone, so in Both the C64 audibly sending its own audio counts as playing too.
    const audible = c64.streamedDbfs !== null && c64.streamedDbfs > -60;
    return players >= 1 && (c64.tune || audible) && (streamed === null || streamed > 0);
  };
  const observe = async () => {
    const [players, c64, chooser, shown] = await Promise.all([appPlayers(), c64State(), chooserState(), playback()]);
    return {
      players,
      c64: { ...c64, streamed: streamedLastSecond(), streamedDbfs: streamedDbfs() },
      chooser,
      ui: shown,
    };
  };
  const recentAppLog = () =>
    ui(`(() => {
      const cut = new Date(Date.now() - 25000).toISOString();
      return JSON.parse(localStorage.getItem("c64u_app_logs") || "[]").filter((e) => e.timestamp >= cut)
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
        .map((e) => e.timestamp.slice(14, 23) + " " + e.level[0] + " " + e.message + " " + JSON.stringify(e.details || {}).slice(0, 140));
    })()`);

  const settle = async (target, sinceMs) => {
    let last = null;
    let resumes = 0;
    while (Date.now() - sinceMs < SETTLE_TIMEOUT_MS) {
      last = await observe();
      // A tap can land on Play/Stop when the layout moves under it. Stopped is a state the listener chose, so
      // start again rather than count every later check against it.
      if (last.ui?.stopped) {
        report.stopsHit = (report.stopsHit ?? 0) + 1;
        await tap(inPage("playlist-play"));
        for (let i = 0; i < 40 && (await playback()).stopped; i += 1) await sleep(250);
        continue;
      }
      // A pause tapped during a launch takes effect when the launch lands, which can be after the burst ended.
      if (last.ui?.paused && resumes < 3) {
        resumes += 1;
        await tap(inPage("playlist-pause"));
        // Waits for the resume to show before judging again, so a slow answer is not mistaken for a lost tap.
        for (let i = 0; i < 25 && (await playback()).paused; i += 1) await sleep(200);
        continue;
      }
      if (matches(target, last)) {
        // Held for a further 1.5 s: a launch still in flight cannot turn a pass into a double output, and the
        // clock must move, or "playing" is only a label.
        await sleep(1500);
        const held = await observe();
        const advanced = seconds(held.ui?.elapsed) > seconds(last.ui?.elapsed);
        if (matches(target, held) && advanced) return { ok: true, settleMs: Date.now() - sinceMs - 1500, ...held };
        last = { ...held, clockStalled: !advanced };
      }
      await sleep(POLL_MS);
    }
    const localTrace = await ui(
      `JSON.stringify((globalThis.__localSidTrace?.() ?? []).slice(-40).map((e) => [Math.round(e.atMs ?? e.at ?? 0), e.event, JSON.stringify(e.detail ?? {}).slice(0, 120)]))`,
    );
    return {
      ok: false,
      settleMs: null,
      ...last,
      log: await recentAppLog(),
      pageErrors: await pageErrors(),
      localTrace,
    };
  };

  const pageErrors = () => ui(`JSON.stringify(window.__soakErrs || [])`);
  const installErrorTrap = () =>
    ui(`(() => {
      if (window.__soakErrs) return 0;
      window.__soakErrs = [];
      addEventListener("error", (e) => window.__soakErrs.push(String(e.error?.stack || e.message).slice(0, 2000)));
      addEventListener("unhandledrejection", (e) => window.__soakErrs.push("unhandled: " + String(e.reason?.stack || e.reason).slice(0, 2000)));
      return 1;
    })()`);
  /** Paused or muted by a burst is put right before checking, so every check asks where the tune plays. */
  const unpauseAndUnmute = async () => {
    if ((await playback()).paused) await tap(inPage("playlist-pause"));
    if (await ui(`document.querySelector('${inPage("volume-mute")}')?.getAttribute("aria-label") === "Unmute"`)) {
      await tap(inPage("volume-mute"));
    }
  };
  const ensurePlaying = async () => {
    const shown = await playback();
    if (shown.title && !shown.paused && seconds(shown.elapsed) !== null) return;
    await tap(inPage("sid-radio-launcher"));
    await sleep(1500);
    await tap('[data-testid="sid-radio-style-1"]');
    await sleep(8000);
  };
  const tapAction = async (action) => {
    if (action === "here" || action === "c64" || action === "both") {
      lastChosen = action;
      return chooseTarget(action);
    }
    if (action === "volume") return tap(inPage("volume-slider"), { fraction: 0.15 + random() * 0.5 });
    if (action === "seek") return tap(inPage("playback-progress-seek"), { fraction: 0.05 + random() * 0.6 });
    const ids = { next: "playlist-next", prev: "playlist-prev", pause: "playlist-pause", mute: "volume-mute" };
    return tap(inPage(ids[action]));
  };
  let lastChosen = null;
  const lastTarget = (fallback) => async () => {
    if (lastChosen) return lastChosen;
    const chooser = await chooserState();
    return chooser?.engine === "local" ? "here" : chooser?.engine === "both" ? "both" : chooser ? "c64" : fallback;
  };

  const restoreScreen = async () => {
    if (!args.smallScreen) return;
    await shell("wm size reset; wm density reset");
  };

  let multicast = null;
  const onSignal = async () => {
    await restoreScreen().catch(() => undefined);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    multicast = await listenForStreamedAudio();
    // `cmd media_session volume --set` does not take effect on the Pixel 4 here; AudioManager does.
    await shell(`cmd audio set-volume 3 ${args.volume}`);
    const volume = Number(
      /streamVolume:(\d+)/.exec(await shell("dumpsys audio | sed -n '/- STREAM_MUSIC:/,/Devices:/p'"))?.[1],
    );
    if (!(volume <= MAX_VOLUME)) throw new Error(`media volume reads ${volume}, above the ${MAX_VOLUME} ceiling`);
    if (args.smallScreen) {
      await shell("wm size 480x640; wm density 240");
      await shell(`am force-stop ${PACKAGE}; monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`);
      await sleep(6000);
    }
    await cdp.attach();
    report.viewport = await ui(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`);
    if (args.throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: args.throttle });
    await installErrorTrap();
    await tap('[data-testid="tab-play"]');
    await sleep(1500);
    await ensurePlaying();
    const startedIso = new Date().toISOString();
    report.logCursorAtStart = await appLogCursor();
    report.playbackAtStart = await playback();
    console.log(`viewport ${JSON.stringify(report.viewport)} throttle ${args.throttle} seed ${args.seed}`);

    // Phase 1: the output chooser, in bursts of one to five switches with gaps from 30 ms to 1.5 s.
    let switchesDone = 0;
    while (switchesDone < args.switches) {
      const burst = 1 + Math.floor(random() * 5);
      let target = null;
      for (let i = 0; i < burst && switchesDone < args.switches; i += 1, switchesDone += 1) {
        target = pick(["here", "c64", "both"]);
        lastChosen = target;
        const result = await chooseTarget(target);
        if (result !== "ok") fail("switch", { target, result });
        await sleep(30 + Math.floor(random() * (random() < 0.5 ? 200 : 1500)));
      }
      const lastTapAt = Date.now();
      const outcome = await settle(target, lastTapAt);
      report.switches.push({ phase: "switch", burst, target, ...outcome, at: new Date().toISOString() });
      console.log(
        `switch #${switchesDone} burst=${burst} -> ${target}: ${outcome.ok ? `ok ${outcome.settleMs} ms` : "MISMATCH"} players=${outcome.players} c64=${JSON.stringify(outcome.c64)} ui=${JSON.stringify(outcome.ui)}`,
      );
      if (!outcome.ok) fail("switch-settle", { target, burst, ...outcome });
    }

    // Phase 2: the transport on whatever output phase 1 left selected. Phase 3: chaos, every control mixed.
    const transportActions = [
      "next",
      "prev",
      "pause",
      "next",
      "pause",
      "volume",
      "mute",
      "mute",
      "seek",
      "prev",
      "next",
    ];
    const chaosActions = [...transportActions, "here", "c64", "both", "here", "both"];
    for (const [phase, actions, count] of [
      ["transport", transportActions, args.transport],
      ["chaos", chaosActions, args.chaos],
    ]) {
      let done = 0;
      while (done < count) {
        const burst = 1 + Math.floor(random() * 6);
        const taken = [];
        for (let i = 0; i < burst && done < count; i += 1, done += 1) {
          const action = pick(actions);
          const startedAt = Date.now();
          const clicked = await tapAction(action);
          taken.push(action);
          report.transport.push({ phase, action, clicked, latencyMs: Date.now() - startedAt });
          await sleep(30 + Math.floor(random() * (random() < 0.5 ? 250 : 1200)));
        }
        await sleep(300);
        await unpauseAndUnmute();
        const target = await lastTarget("c64")();
        const outcome = await settle(target, Date.now());
        console.log(
          `${phase} #${done} [${taken.join(" ")}] on ${target}: ${outcome.ok ? `ok ${outcome.settleMs} ms` : "MISMATCH"} players=${outcome.players} c64=${JSON.stringify(outcome.c64)} ui=${JSON.stringify(outcome.ui)}`,
        );
        report.switches.push({ phase, burst, target, taken, ...outcome, at: new Date().toISOString() });
        if (!outcome.ok) fail(`${phase}-settle`, { target, taken, ...outcome });
      }
    }

    report.errors = await appProblemsSince(startedIso);
    report.consoleErrors = cdp.takeConsoleErrors();
    report.pageErrors = await pageErrors();
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
    await restoreScreen().catch((error) => console.log(`could not restore the screen: ${error.message}`));
    cdp.close();
    multicast?.close();
  }

  const settles = report.switches.filter((s) => s.ok).map((s) => s.settleMs);
  report.summary = {
    switchBursts: report.switches.length,
    switchMismatches: report.switches.filter((s) => !s.ok).length,
    settleMsP50: percentile(settles, 50),
    settleMsP95: percentile(settles, 95),
    settleMsMax: settles.length ? Math.max(...settles) : null,
    transportActions: report.transport.length,
    transportUnavailable: report.transport.filter((t) => t.clicked !== "ok").length,
    transportClickMsP95: percentile(
      report.transport.map((t) => t.latencyMs),
      95,
    ),
    failures: report.failures.length,
    appWarningsAndErrors: report.errors.length,
    consoleErrors: report.consoleErrors?.length ?? 0,
  };
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.errors.length) console.log(report.errors.slice(0, 20).join("\n"));
  if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length || report.errors.length ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
