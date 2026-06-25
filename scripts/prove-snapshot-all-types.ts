/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * End-to-end proof that the REAL production snapshot create + restore paths
 * (createSnapshot -> dumpRamRanges, loadMemoryRanges) work for every snapshot
 * type against a live U64 — including a CUSTOM snapshot with non-contiguous
 * user ranges.
 *
 * For each type it: creates the snapshot, corrupts a RAM canary inside every
 * captured range, restores, and verifies every canary came back. It also checks
 * the cursor-blink jiffy rate stays ~baseline after the restores.
 *
 * Env: C64U_HOST / C64U_PASSWORD (from .env). Run:
 *   npx vite-node scripts/prove-snapshot-all-types.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { C64API } from "../src/lib/c64api";
import type { MemoryRange, SnapshotType } from "../src/lib/snapshot/snapshotTypes";

// --- browser shims (mirror scripts/prove-screen-snapshot-restore.ts) -------
class MemoryStorage {
  private readonly store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const ensureBrowserShims = () => {
  const meta = import.meta as ImportMeta & { env?: Record<string, string> };
  if (!meta.env) meta.env = {};
  meta.env.VITE_WEB_PLATFORM ??= "0";
  const eventTarget = new EventTarget();
  if (typeof window === "undefined") Object.assign(globalThis, { window: globalThis });
  Object.assign(window, {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { origin: "http://localhost" },
    Capacitor: { isNativePlatform: () => false },
  });
  if (typeof localStorage === "undefined") Object.assign(globalThis, { localStorage: new MemoryStorage() });
  if (typeof sessionStorage === "undefined") Object.assign(globalThis, { sessionStorage: new MemoryStorage() });
  if (typeof navigator === "undefined") Object.assign(globalThis, { navigator: { userAgent: "node" } });
  Object.assign(globalThis, {
    __APP_VERSION__: "proof",
    __GIT_SHA__: "proof",
    __BUILD_TIME__: new Date().toISOString(),
    atob: (v: string) => Buffer.from(v, "base64").toString("binary"),
    btoa: (v: string) => Buffer.from(v, "binary").toString("base64"),
  });
};

// --- env / helpers ---------------------------------------------------------
const loadDotEnv = () => {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
};
const host = () => process.env.C64U_HOST ?? "u64";
const baseUrl = () => process.env.C64U_BASE_URL ?? `http://${host()}`;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
const isCiaTimer = (a: number) => a >= 0xdc00 && a < 0xde00 && (a & 0x0f) >= 0x04 && (a & 0x0f) <= 0x07;

const readByte = async (api: C64API, addr: number) => (await api.readMemory(hex(addr), 1))[0];
const readJiffies = async (api: C64API) => {
  const b = await api.readMemory("A0", 3);
  return (b[0] << 16) | (b[1] << 8) | b[2];
};
const measureJiffyRate = async (api: C64API, windowMs = 1500) => {
  const a = await readJiffies(api);
  const t0 = Date.now();
  await delay(windowMs);
  return ((await readJiffies(api)) - a) / ((Date.now() - t0) / 1000);
};

/**
 * Pick one canary inside a range that we can mutate and read back: plain RAM
 * (mask 0xFF) or colour RAM $D800-$DBFF (4-bit nibbles, mask 0x0F). Returns null
 * for pure VIC/SID/CIA register ranges, which read back differently than written.
 */
const pickRamCanary = (start: number, length: number): { addr: number; mask: number } | null => {
  for (let a = start; a < start + length; a += 1) {
    if ((a < 0xd000 || a >= 0xe000) && a !== 0x0000 && a !== 0x0001) return { addr: a, mask: 0xff };
    if (a >= 0xd800 && a < 0xdc00) return { addr: a, mask: 0x0f };
  }
  return null;
};

const pickCanariesForRange = (start: number, length: number): Array<{ addr: number; mask: number }> => {
  const checks: Array<{ addr: number; mask: number }> = [];
  const ramCanary = pickRamCanary(start, length);
  if (ramCanary) checks.push(ramCanary);
  if (0xdd00 >= start && 0xdd00 < start + length) checks.push({ addr: 0xdd00, mask: 0x03 });
  return checks;
};

type TypeCase = { type: SnapshotType; customRanges?: MemoryRange[]; note: string };

const CASES: TypeCase[] = [
  { type: "basic", note: "$002B-$0038, $0801-$9FFF" },
  { type: "program", note: "$0000-$00FF, $0200-$FFFF (incl CIA2 VIC bank)" },
  { type: "screen", note: "VIC bank + VIC regs + colour + CIA2 port" },
  {
    type: "custom",
    note: "NON-CONTIGUOUS user ranges $0801-$0810, $2000-$200F, $5000-$500F",
    customRanges: [
      { start: 0x0801, length: 0x10 },
      { start: 0x2000, length: 0x10 },
      { start: 0x5000, length: 0x10 },
    ],
  },
];

type ProductionModules = {
  createSnapshot: typeof import("../src/lib/snapshot/snapshotCreation").createSnapshot;
  decodeSnapshot: typeof import("../src/lib/snapshot/snapshotFormat").decodeSnapshot;
  clearSnapshotStore: typeof import("../src/lib/snapshot/snapshotStore").clearSnapshotStore;
  loadSnapshotStore: typeof import("../src/lib/snapshot/snapshotStore").loadSnapshotStore;
  snapshotEntryToBytes: typeof import("../src/lib/snapshot/snapshotStore").snapshotEntryToBytes;
  loadMemoryRanges: typeof import("../src/lib/machine/ramOperations").loadMemoryRanges;
};

const loadProductionModules = async (): Promise<
  ProductionModules & {
    C64API: typeof import("../src/lib/c64api").C64API;
    updateDeviceConnectionState: typeof import("../src/lib/deviceInteraction/deviceStateStore").updateDeviceConnectionState;
  }
> => {
  const [{ C64API }, { updateDeviceConnectionState }, snapshotCreation, snapshotFormat, snapshotStore, ramOperations] =
    await Promise.all([
      import("../src/lib/c64api"),
      import("../src/lib/deviceInteraction/deviceStateStore"),
      import("../src/lib/snapshot/snapshotCreation"),
      import("../src/lib/snapshot/snapshotFormat"),
      import("../src/lib/snapshot/snapshotStore"),
      import("../src/lib/machine/ramOperations"),
    ]);

  return {
    C64API,
    updateDeviceConnectionState,
    createSnapshot: snapshotCreation.createSnapshot,
    decodeSnapshot: snapshotFormat.decodeSnapshot,
    clearSnapshotStore: snapshotStore.clearSnapshotStore,
    loadSnapshotStore: snapshotStore.loadSnapshotStore,
    snapshotEntryToBytes: snapshotStore.snapshotEntryToBytes,
    loadMemoryRanges: ramOperations.loadMemoryRanges,
  };
};

const runCase = async (api: C64API, deps: ProductionModules, c: TypeCase): Promise<boolean> => {
  deps.clearSnapshotStore();
  await deps.createSnapshot(api, { type: c.type, customRanges: c.customRanges, label: `proof-${c.type}` });
  const [entry] = deps.loadSnapshotStore();
  if (!entry) {
    console.log(`  ${c.type}: FAIL — no snapshot entry created`);
    return false;
  }
  const decoded = deps.decodeSnapshot(deps.snapshotEntryToBytes(entry));
  const ranges = decoded.ranges.map((r, i) => ({ start: r.start, bytes: decoded.blocks[i] }));

  // Each range is verified one of three ways:
  //  - RAM/colour-RAM range: corrupt a full-byte canary, restore, expect it back.
  //  - a range covering CIA2 $DD00: corrupt the VIC-bank select bits, restore,
  //    expect those 2 bits back (the meaningful, read-stable part).
  //  - other pure register ranges: trusted (byte-exactness covered by unit tests).
  const checksByKey = new Map<string, { addr: number; mask: number; original: number }>();
  let trustedRegRanges = 0;
  for (const r of decoded.ranges) {
    const canaries = pickCanariesForRange(r.start, r.length);
    if (canaries.length > 0) {
      for (const canary of canaries) {
        checksByKey.set(`${canary.addr}:${canary.mask}`, {
          addr: canary.addr,
          mask: canary.mask,
          original: await readByte(api, canary.addr),
        });
      }
    } else {
      trustedRegRanges += 1;
    }
  }
  const checks = Array.from(checksByKey.values());

  // Corrupt every checked location (sequential — C64API is not concurrency-safe).
  for (const k of checks) await api.writeMemory(hex(k.addr), new Uint8Array([(k.original ^ 0xff) & 0xff]));
  const corrupted: boolean[] = [];
  for (const k of checks) corrupted.push(((await readByte(api, k.addr)) & k.mask) === ((k.original ^ 0xff) & k.mask));

  await deps.loadMemoryRanges(api, ranges);

  const restored: boolean[] = [];
  for (const k of checks) restored.push(((await readByte(api, k.addr)) & k.mask) === (k.original & k.mask));
  const allCorrupted = corrupted.every(Boolean);
  const allRestored = restored.every(Boolean);
  const detail = checks
    .map((k, i) => `$${hex(k.addr)}${k.mask !== 0xff ? `&${k.mask.toString(16)}` : ""}${restored[i] ? "✓" : "✗"}`)
    .join(" ");
  const ok = allCorrupted && allRestored;
  const trustNote = trustedRegRanges ? ` +${trustedRegRanges} reg-range(s) [unit-tested]` : "";
  console.log(
    `  ${c.type.padEnd(7)} ${ok ? "PASS" : "FAIL"}  ranges=${decoded.ranges.length} verified=[${detail}]${trustNote}  (${c.note})`,
  );
  if (!allCorrupted) console.log(`    note: not all canaries corrupted before restore`);
  return ok;
};

const main = async () => {
  ensureBrowserShims();
  loadDotEnv();
  const { C64API, updateDeviceConnectionState, ...deps } = await loadProductionModules();
  updateDeviceConnectionState("REAL_CONNECTED");
  const api = new C64API(baseUrl(), process.env.C64U_PASSWORD, host());

  console.log(`# Snapshot create+restore proof (real prod path)  device=${host()}\n`);
  await api.machineReset();
  await delay(3500);

  const baseline = await measureJiffyRate(api);
  console.log(`baseline blink: ${baseline.toFixed(1)} jiffies/s\n`);

  const results: Array<[string, boolean]> = [];
  for (const c of CASES) results.push([c.type, await runCase(api, deps, c)]);

  const afterBlink = await measureJiffyRate(api);
  const blinkOk = Math.abs(afterBlink - baseline) / baseline <= 0.25;
  console.log(`\nblink after all restores: ${afterBlink.toFixed(1)} jiffies/s (${blinkOk ? "stable" : "DRIFTED"})`);

  await api.machineReset();
  await delay(1500);

  const allOk = results.every(([, ok]) => ok) && blinkOk;
  console.log(
    `\n# ${allOk ? "ALL PASS" : "FAILURES"}: ${results.map(([t, ok]) => `${t}=${ok ? "ok" : "FAIL"}`).join(" ")}`,
  );
  process.exitCode = allOk ? 0 : 1;
};

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 2;
}
