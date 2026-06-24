/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * Isolated reproduction + fix verification for the "cursor blink speeds up on
 * every snapshot restore" bug, run against a live U64.
 *
 * It is a faithful, self-contained transcription of the production snapshot
 * ranges (src/lib/snapshot/snapshotCreation.ts) and restore path
 * (src/lib/machine/ramOperations.ts -> loadMemoryRanges), so it runs in a few
 * seconds without dragging the whole app graph (and its background timers) into
 * the process.
 *
 *   --strategy current  : exactly what prod did before the fix -- pause, read
 *                         the FULL $0000-$FFFF image, overlay the snapshot
 *                         ranges (only skipping CIA2 $DD02-$DDFF), write the
 *                         whole image back, resume. Round-tripping the live I/O
 *                         region reads CIA1 Timer A ($DC04/$DC05) as a counter
 *                         and writes it back as the latch, shortening the jiffy
 *                         IRQ period -> the cursor blinks faster every restore.
 *
 *   --strategy fixed    : the corrected algorithm -- write ONLY the snapshot's
 *                         own ranges, skipping the volatile CIA timer/IRQ
 *                         registers ($DC02-$DCFF and $DD02-$DDFF); never read or
 *                         write the background I/O region. Untouched memory
 *                         keeps its live value by simply not being written.
 *
 *   --type program|basic|screen|custom-ram|all
 *                         which default snapshot range-set to exercise. Each is
 *                         captured live, then restored --restores times.
 *
 * For every restore the harness measures the jiffy rate ($A0-$A2). The KERNAL
 * reloads the cursor blink countdown ($CD) with 20 jiffies, so the cursor
 * toggles every 20 jiffies and
 *   cursor toggle interval (s) = 20 / (jiffies per second).
 * A correct restore leaves the rate at ~60/s (NTSC); the bug drives it up. It
 * also writes a RAM canary in-range before the first restore and checks the
 * snapshot brings it back, proving the data actually restores.
 *
 * Env: C64U_HOST, C64U_PASSWORD (auto-loaded from .env).
 * Usage: node scripts/repro-cursor-blink-snapshot-restore.mjs [--strategy current|fixed] [--type all] [--restores N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- env ------------------------------------------------------------------
try {
  for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* rely on real env */
}

const HOST = process.env.C64U_HOST ?? "c64u";
const PASSWORD = process.env.C64U_PASSWORD ?? "";
const BASE = process.env.C64U_BASE_URL ?? `http://${HOST}`;

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const STRATEGY = argVal("--strategy", "fixed");
const TYPE = argVal("--type", "all");
const RESTORES = Number(argVal("--restores", "3"));
const WINDOW_MS = Number(argVal("--window-ms", "2000"));

// --- memory map constants (mirror ramOperations.ts) -----------------------
const FULL_RAM_SIZE = 0x10000;
const CHUNK = 0x1000;
// Only the CIA timer registers ($xx04-$xx07 and their 16-byte mirrors) are
// unsafe to write back; everything else (ports, DDR, TOD, ICR, control) is fine.
const CIA_PAGES_START = 0xdc00;
const CIA_PAGES_END = 0xde00;
// Old pre-fix prod only skipped the CIA2 page below; kept for restoreCurrent().
const CIA2_VOLATILE_START = 0xdd02;
const CIA2_VOLATILE_END = 0xde00;
const BLINK_RELOAD_JIFFIES = 20;

const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const authHeaders = () => (PASSWORD ? { "X-Password": PASSWORD } : {});

// Transient-blip retry: the device REST stack hiccups under load (undici "fetch
// failed"). Retry a few times so a network blip doesn't abort verification.
async function withRetry(label, run, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${label} failed after ${attempts} attempts: ${error.message}`);
      await delay(250 * attempt);
    }
  }
}

// --- REST helpers (mirror C64API.readMemory / writeMemoryBlock / machine:*) --
async function readMemory(addr, length) {
  return withRetry(`readmem ${addr}`, async () => {
    const r = await fetch(`${BASE}/v1/machine:readmem?address=${addr}&length=${length}`, { headers: authHeaders() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  });
}
async function writeMemoryBlock(addr, bytes) {
  return withRetry(`writemem ${addr}`, async () => {
    const r = await fetch(`${BASE}/v1/machine:writemem?address=${addr}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });
}
const machine = (verb) =>
  withRetry(`machine:${verb}`, async () => {
    const r = await fetch(`${BASE}/v1/machine:${verb}`, { method: "PUT", headers: authHeaders() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

// --- jiffy / blink measurement --------------------------------------------
async function readJiffies() {
  const b = await readMemory("A0", 3); // $A0 hi, $A1 mid, $A2 lo
  return (b[0] << 16) | (b[1] << 8) | b[2];
}
async function measureJiffyRate(windowMs) {
  const start = await readJiffies();
  const t0 = Date.now();
  await delay(windowMs);
  const end = await readJiffies();
  return (end - start) / ((Date.now() - t0) / 1000);
}
const fmtRate = (rate) =>
  `${rate.toFixed(1).padStart(7)} jiffies/s (toggle every ${((BLINK_RELOAD_JIFFIES / rate) * 1000).toFixed(0).padStart(4)} ms)`;

const isCiaTimerRegister = (addr) => {
  if (addr < CIA_PAGES_START || addr >= CIA_PAGES_END) return false;
  const reg = addr & 0x0f;
  return reg >= 0x04 && reg <= 0x07;
};

// --- default snapshot range-sets (mirror snapshotCreation.ts) -------------
async function buildRanges(type) {
  switch (type) {
    case "basic":
      return { ranges: [r(0x002b, 0x0038), r(0x0801, 0x9fff)], canaries: [{ addr: 0x0801 }] };
    case "program":
      // Now includes the full I/O region incl. CIA2 ($DD00 = VIC bank). Verify
      // both a RAM byte and the VIC-bank select bits ($DD00 low 2 bits) restore.
      return {
        ranges: [r(0x0000, 0x00ff), r(0x0200, 0xffff)],
        canaries: [{ addr: 0x0400 }, { addr: 0xdd00, mask: 0x03 }],
      };
    case "screen": {
      const cia2pa = (await readMemory("DD00", 1))[0];
      const bankStart = (~cia2pa & 0x03) * 0x4000;
      return {
        ranges: [
          r(bankStart, bankStart + 0x3fff),
          r(0xd000, 0xd02e),
          r(0xd800, 0xdbff),
          r(0xdd00, 0xdd01),
        ],
        canaries: [{ addr: bankStart + 0x0400 }], // screen RAM inside the active VIC bank
      };
    }
    case "custom-ram": // the $0801-$7FFF RAM snapshot from the bug report
      return { ranges: [r(0x0801, 0x7fff)], canaries: [{ addr: 0x0801 }] };
    default:
      throw new Error(`unknown --type ${type}`);
  }
}
const r = (start, endInclusive) => ({ start, length: endInclusive - start + 1 });

async function captureRange(start, length) {
  const out = new Uint8Array(length);
  for (let off = 0; off < length; off += CHUNK) {
    out.set(await readMemory(hex(start + off), Math.min(CHUNK, length - off)), off);
  }
  return out;
}

// --- restore strategies ----------------------------------------------------

/** Faithful mirror of the pre-fix prod loadMemoryRanges (the buggy path). */
async function restoreCurrent(ranges) {
  await machine("pause");
  try {
    const image = new Uint8Array(FULL_RAM_SIZE);
    for (let a = 0; a < FULL_RAM_SIZE; a += CHUNK) {
      image.set(await readMemory(hex(a), Math.min(CHUNK, FULL_RAM_SIZE - a)), a);
    }
    for (const { start, bytes } of ranges) {
      for (let i = 0; i < bytes.length; i += 1) {
        const abs = start + i;
        if (abs >= CIA2_VOLATILE_START && abs < CIA2_VOLATILE_END) continue;
        image[abs] = bytes[i];
      }
    }
    await writeMemoryBlock("0000", image);
  } finally {
    await machine("resume");
  }
}

/** Corrected restore: write only the snapshot ranges; never touch background I/O. */
async function restoreFixed(ranges) {
  await machine("pause");
  try {
    for (const { start, bytes } of ranges) {
      let i = 0;
      while (i < bytes.length) {
        if (isCiaTimerRegister(start + i)) {
          i += 1;
          continue;
        }
        let j = i;
        while (j < bytes.length && !isCiaTimerRegister(start + j)) j += 1;
        for (let k = i; k < j; k += CHUNK) {
          const end = Math.min(j, k + CHUNK);
          await writeMemoryBlock(hex(start + k), bytes.subarray(k, end));
        }
        i = j;
      }
    }
  } finally {
    await machine("resume");
  }
}

// --- per-type run ----------------------------------------------------------
async function runType(type, restore) {
  console.log(`\n=== type=${type} ===`);
  await machine("reset");
  await delay(3500); // KERNAL banner + blinking cursor

  const baseline = await measureJiffyRate(WINDOW_MS);
  console.log(`baseline      : ${fmtRate(baseline)}`);

  const { ranges, canaries } = await buildRanges(type);
  const captured = [];
  for (const range of ranges) captured.push({ start: range.start, bytes: await captureRange(range.start, range.length) });
  const spans = ranges.map((x) => `$${hex(x.start)}-$${hex(x.start + x.length - 1)}`).join(", ");
  const totalBytes = captured.reduce((n, c) => n + c.bytes.length, 0);
  console.log(`captured ${spans}  (${totalBytes} bytes)`);

  // Data-roundtrip canaries: corrupt each in-range byte, then let the restore fix it.
  // mask isolates meaningful bits (e.g. $DD00 low 2 bits = VIC bank select).
  for (const c of canaries) {
    c.mask ??= 0xff;
    c.original = (await readMemory(hex(c.addr), 1))[0];
    await writeMemoryBlock(hex(c.addr), new Uint8Array([c.original ^ c.mask]));
  }

  const rates = [];
  const restoredFlags = canaries.map(() => false);
  for (let n = 1; n <= RESTORES; n += 1) {
    await restore(captured);
    if (n === 1) {
      for (let ci = 0; ci < canaries.length; ci += 1) {
        const c = canaries[ci];
        const now = (await readMemory(hex(c.addr), 1))[0];
        restoredFlags[ci] = (now & c.mask) === (c.original & c.mask);
      }
    }
    const rate = await measureJiffyRate(WINDOW_MS);
    rates.push(rate);
    console.log(`after restore ${n}: ${fmtRate(rate)}  (${(rate / baseline).toFixed(2)}x)`);
  }

  const worst = rates.reduce((m, x) => Math.max(m, Math.abs(x - baseline) / baseline), 0);
  const blinkStable = worst <= 0.25;
  const canaryRestored = restoredFlags.every(Boolean);
  const pass = blinkStable && canaryRestored;
  const canarySummary = canaries
    .map((c, ci) => `$${hex(c.addr)}${c.mask !== 0xff ? `&${c.mask.toString(16)}` : ""}=${restoredFlags[ci] ? "ok" : "BAD"}`)
    .join(" ");
  console.log(
    `${pass ? "PASS" : "FAIL"}  blink ${blinkStable ? "stable" : "UNSTABLE"} (worst drift ${(worst * 100).toFixed(1)}%), ` +
      `canaries ${canarySummary}`,
  );
  return pass;
}

// --- main ------------------------------------------------------------------
async function main() {
  const restore = STRATEGY === "current" ? restoreCurrent : restoreFixed;
  const types = TYPE === "all" ? ["basic", "program", "screen", "custom-ram"] : [TYPE];
  console.log(`# Snapshot restore blink-safety  strategy=${STRATEGY} types=[${types}] restores=${RESTORES} device=${HOST}`);

  const results = [];
  for (const t of types) results.push([t, await runType(t, restore)]);

  await machine("reset"); // leave the machine clean
  await delay(1500);

  console.log("\n# summary");
  for (const [t, ok] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${t}`);
  process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 2;
});
