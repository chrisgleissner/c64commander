#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Sample battery, temperature and the app's CPU time while a phone runs on its own battery.
 *
 * Every --interval seconds it reads, through droidctl, the battery capacity, charge counter, status and
 * temperature from /sys/class/power_supply/battery, the app process's CPU time from /proc/<pid>/stat and
 * its resident memory. A sample that cannot be read (the link dropped) is recorded as such and retried at
 * the next interval, so unplugging the cable and carrying on over a wireless adb link is part of the run.
 *
 *   node tools/hil/battery_soak_hil.mjs --serial <adb serial> --minutes 30 --label local-engine \
 *     --json artifacts/battery-local-30min.json
 *
 * The run only means something while the phone is discharging: every sample records `status`, and the
 * summary refuses to report a drain figure unless at least 90 % of them read "Discharging".
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createDroidDevice } from "./droidctl_device.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const SERIAL = arg("serial", undefined);
const PACKAGE = arg("package", "uk.gleissner.c64commander");
const MINUTES = Number(arg("minutes", "30"));
const INTERVAL_S = Number(arg("interval", "30"));
const LABEL = arg("label", "run");
const OUT = arg("json", `artifacts/battery-${LABEL}.json`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const READ = `B=/sys/class/power_supply/battery; echo "capacity=$(cat $B/capacity) charge_uah=$(cat $B/charge_counter) status=$(cat $B/status) temp_dc=$(cat $B/temp)";
PID=$(pidof ${PACKAGE} | cut -d' ' -f1); if [ -n "$PID" ]; then echo "pid=$PID stat=$(cut -d')' -f2 /proc/$PID/stat | cut -d' ' -f12,13) rss_kb=$(grep VmRSS /proc/$PID/status | tr -s ' ' | cut -d' ' -f2)"; else echo "pid="; fi`;

const parse = (text) => {
  const fields = {};
  for (const match of text.matchAll(/(\w+)=([^\n]*?)(?=\s\w+=|\n|$)/g)) fields[match[1]] = match[2].trim();
  const ticks = fields.stat ? fields.stat.split(" ").map(Number) : [];
  return {
    capacity: Number(fields.capacity),
    chargeUah: Number(fields.charge_uah),
    status: fields.status,
    batteryC: Number(fields.temp_dc) / 10,
    pid: fields.pid ? Number(fields.pid) : null,
    cpuSeconds: ticks.length === 2 ? (ticks[0] + ticks[1]) / 100 : null,
    rssMb: fields.rss_kb ? Math.round(Number(fields.rss_kb) / 1024) : null,
  };
};

const device = await createDroidDevice({ serial: SERIAL });
const samples = [];
const endAt = Date.now() + MINUTES * 60_000;
while (Date.now() < endAt) {
  try {
    samples.push({ t: Date.now(), ...parse(await device.shell(["sh", "-c", READ])) });
  } catch (error) {
    samples.push({ t: Date.now(), error: String(error.message ?? error) });
  }
  await sleep(INTERVAL_S * 1000);
}

const read = samples.filter((s) => !s.error);
const discharging = read.filter((s) => s.status === "Discharging").length;
const first = read.find((s) => s.status === "Discharging");
const last = [...read].reverse().find((s) => s.status === "Discharging");
const hours = first && last ? (last.t - first.t) / 3_600_000 : 0;
const summary = {
  label: LABEL,
  minutes: MINUTES,
  samples: samples.length,
  unreadSamples: samples.length - read.length,
  dischargingFraction: read.length ? Number((discharging / read.length).toFixed(2)) : 0,
  drainPercentPerHour:
    hours > 0 && read.length && discharging / read.length >= 0.9
      ? Number(((first.capacity - last.capacity) / hours).toFixed(2))
      : null,
  drainMahPerHour:
    hours > 0 && discharging / read.length >= 0.9
      ? Number(((first.chargeUah - last.chargeUah) / 1000 / hours).toFixed(1))
      : null,
  batteryC: {
    first: first?.batteryC ?? null,
    last: last?.batteryC ?? null,
    max: Math.max(...read.map((s) => s.batteryC)),
  },
  appCpuSeconds:
    last?.cpuSeconds != null && first?.cpuSeconds != null
      ? Number((last.cpuSeconds - first.cpuSeconds).toFixed(0))
      : null,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, samples }, null, 1));
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
