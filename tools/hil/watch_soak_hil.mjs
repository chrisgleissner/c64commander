#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Keep Watch on for a fixed time and record what the host sees on the video group next to what the
 * phone's app says about its own stream.
 *
 * The host joins 239.0.1.64:11000 on --iface and counts, once per second, packets and 16-bit sequence
 * discontinuities per sender. The phone is sampled every 5 s over DevTools: the Watch button state,
 * `StreamUdp.readStreamDiagnostics({ name: "video" })` (sender-filter counters) and the app log
 * entries that mention the video mirror. The host sees the Ethernet side only, so a loss between the
 * access point and the phone shows up as the app reporting a loss while the host rate stays flat.
 *
 *   node tools/hil/watch_soak_hil.mjs --serial <adb serial> --package uk.gleissner.c64uremote \
 *     --iface <this host's LAN address> --minutes 30 --json artifacts/watch-soak.json
 *
 * It presses Watch when the button reads "Watch" on the page it finds, and leaves Watch on afterwards.
 *
 * `--no-wire` skips the host's group membership. On the keypad phone, a host that joined the group made
 * the phone lose the stream within about 8 s in three of three runs, and without it six of six runs held.
 * Use it when the phone's own counters are the measurement.
 */

import dgram from "node:dgram";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { connect } from "../../scripts/remote-input-hil/cdp.mjs";
import { createDroidDevice } from "./droidctl_device.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const SERIAL = arg("serial", undefined);
const PACKAGE = arg("package", "uk.gleissner.c64uremote");
const IFACE = arg("iface", "");
const MINUTES = Number(arg("minutes", "30"));
const PORT = Number(arg("cdp-port", "9371"));
const OUT = arg("json", "artifacts/watch-soak.json");
const WIRE = !argv.includes("--no-wire");
if (WIRE && !IFACE) throw new Error("--iface <this host's LAN address> is required unless --no-wire");
const GROUP = "239.0.1.64";
const GROUP_PORT = 11000;
const SAMPLE_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const wire = { seconds: [], senders: new Map(), current: new Map() };
const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
socket.on("message", (message, remote) => {
  if (message.length < 2) return;
  const seq = message.readUInt16LE(0);
  const entry = wire.current.get(remote.address) ?? { packets: 0, gaps: 0 };
  const last = wire.senders.get(remote.address);
  if (last !== undefined && seq !== ((last + 1) & 0xffff)) entry.gaps += 1;
  wire.senders.set(remote.address, seq);
  entry.packets += 1;
  wire.current.set(remote.address, entry);
});
if (WIRE) {
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(GROUP_PORT, () => {
      socket.addMembership(GROUP, IFACE);
      resolve();
    });
  });
}
const wireTimer = setInterval(() => {
  wire.seconds.push({ t: Date.now(), senders: Object.fromEntries(wire.current) });
  wire.current = new Map();
}, 1000);

const phone = await createDroidDevice({ serial: SERIAL });
await phone.forwardWebview(PACKAGE, PORT);
const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
const appPage = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
if (!appPage) throw new Error(`no WebView page for ${PACKAGE} on port ${PORT}; is the app running?`);
const cdp = await connect(appPage.webSocketDebuggerUrl);

const READ = `(async () => {
  const button = document.querySelector('[data-testid="av-video-toggle"]');
  let diag = null;
  try { diag = await window.Capacitor.Plugins.StreamUdp.readStreamDiagnostics({ name: "video" }); } catch (e) { diag = { error: String(e) }; }
  const logs = JSON.parse(localStorage.getItem("c64u_app_logs") || "[]")
    .filter((l) => /video mirror|Live View/i.test(l.message || ""))
    .map((l) => ({ t: l.timestamp, level: l.level, message: l.message }));
  return JSON.stringify({ state: button?.getAttribute("data-state") ?? null, label: button?.textContent?.trim() ?? null,
    hidden: document.hidden, diag, logCount: logs.length, lastLogs: logs.slice(-5) });
})()`;

const start = await cdp.evaluate(READ).then(JSON.parse);
if (start.state === null) throw new Error("no Watch button on the current page; open Home first");
if (start.state !== "live") await cdp.evaluate(`document.querySelector('[data-testid="av-video-toggle"]').click()`);

const samples = [];
const endAt = Date.now() + MINUTES * 60_000;
while (Date.now() < endAt) {
  await sleep(SAMPLE_MS);
  try {
    samples.push({ t: Date.now(), ...JSON.parse(await cdp.evaluate(READ)) });
  } catch (error) {
    samples.push({ t: Date.now(), error: String(error) });
  }
}
clearInterval(wireTimer);
if (WIRE) socket.close();

const rates = wire.seconds.map((s) => Object.values(s.senders).reduce((sum, e) => sum + e.packets, 0));
const sorted = [...rates].sort((a, b) => a - b);
const perSender = {};
for (const second of wire.seconds) {
  for (const [address, entry] of Object.entries(second.senders)) {
    perSender[address] ??= { packets: 0, gaps: 0, seconds: 0 };
    perSender[address].packets += entry.packets;
    perSender[address].gaps += entry.gaps;
    perSender[address].seconds += 1;
  }
}
const states = {};
for (const sample of samples) states[sample.state ?? "error"] = (states[sample.state ?? "error"] ?? 0) + 1;
const summary = {
  minutes: MINUTES,
  wireSeconds: rates.length,
  wireMedianPacketsPerSecond: sorted[Math.floor(sorted.length / 2)] ?? 0,
  wireSecondsWithZeroPackets: rates.filter((n) => n === 0).length,
  perSender,
  appStates: states,
  appLogEntriesAtEnd: samples.at(-1)?.logCount ?? null,
  lastDiagnostics: samples.at(-1)?.diag ?? null,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, samples, wire: wire.seconds }, null, 1));
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
