/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Soak and stress test of remote SID seeking against a real Ultimate, using the app's own modules.
 *
 * It drives `RemoteSidSeekController`, `RemoteSeekDeviceSession` and the recovery path in a random
 * mix of fast forwards, jumps, chained and cancelled operations, simulated app deaths, device
 * switches, a user CPU Speed and Turbo Control Off, and background REST load. The tunes are silent
 * generated PSIDs whose play routine counts its calls, so every landing is checked against the
 * exact tune position. After every operation the device must be as it was before it: the user's
 * CPU Speed and Turbo Control, no key held, an empty journal, the SID player on screen and REST
 * answering.
 *
 *   SOAK_HOST=c64u SOAK_MINUTES=30 npx vitest run --config tools/hil/vitest.hil.config.ts
 *
 * Environment: SOAK_HOST (c64u), SOAK_MINUTES (20), SOAK_SEED (time), SOAK_WRITE_DELAY_MS (500, the
 * app's config write interval in Balanced mode), SOAK_OUT (artifacts/remote-seek-soak-<host>.json).
 * On a machine without key injection (the Ultimate-II+(L)) it runs the fail-safe checks instead.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ errors: [] as Array<[string, unknown]>, warns: [] as Array<[string, unknown]> }));
vi.mock("@/lib/logging", () => ({
  addLog: (level: string, message: string, details?: unknown) => {
    if (level === "warn" || level === "error") logs.warns.push([message, details]);
  },
  addErrorLog: (message: string, details?: unknown) => {
    logs.errors.push([message, details]);
  },
}));

type GuardModule = typeof import("@/lib/playback/remoteSeek/remoteSeekDeviceGuard");
type ControllerModule = typeof import("@/lib/playback/remoteSeek/remoteSidSeekController");
type RemoteSeekApi = import("@/lib/playback/remoteSeek/remoteSidSeekController").RemoteSeekApi;

const HOST = process.env.SOAK_HOST ?? "c64u";
const MINUTES = Number(process.env.SOAK_MINUTES ?? 20);
const WRITE_DELAY_MS = Number(process.env.SOAK_WRITE_DELAY_MS ?? 500);
const SEED = Number(process.env.SOAK_SEED ?? Date.now() % 1_000_000);
const OUT = process.env.SOAK_OUT ?? `artifacts/remote-seek-soak-${HOST}.json`;
const BASE = `http://${HOST}`;
const CATEGORY = "U64 Specific Settings";
const JOURNAL_KEY = "c64u_remote_seek_device_journal_v1";
const COUNTER_ADDRESS = 0x10f0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Mulberry32: a reproducible stream of random numbers from SOAK_SEED. */
const random = (() => {
  let state = SEED >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const between = (low: number, high: number) => low + random() * (high - low);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];

// ------------------------------------------------------------------------------------------------
// A silent PSID whose play routine counts its own calls (the same tune tools/hil/remote_sid_seek_poc.py
// generates): the count divided by the play-call rate is the exact position in the tune.
// ------------------------------------------------------------------------------------------------

type Variant = { name: string; video: "PAL" | "NTSC"; busyLoops: number; ciaTimer: number | null; callHz: number };

const VARIANTS: Variant[] = [
  { name: "PAL, once a frame, light", video: "PAL", busyLoops: 0, ciaTimer: null, callHz: 50 },
  { name: "PAL, once a frame, heavy", video: "PAL", busyLoops: 255, ciaTimer: null, callHz: 50 },
  { name: "NTSC on the machine's frame", video: "NTSC", busyLoops: 200, ciaTimer: null, callHz: 60 },
  { name: "PAL, CIA timer at 4x", video: "PAL", busyLoops: 200, ciaTimer: 0x1331, callHz: 200 },
  { name: "PAL, CIA timer at 2x", video: "PAL", busyLoops: 120, ciaTimer: 0x2663, callHz: 100 },
];

const counterPsid = (variant: Variant): Uint8Array => {
  const lo = COUNTER_ADDRESS & 0xff;
  const hi = COUNTER_ADDRESS >> 8;
  const init = [0xa9, 0x00, 0x8d, lo, hi, 0x8d, lo + 1, hi, 0x8d, lo + 2, hi];
  if (variant.ciaTimer !== null) {
    init.push(0xa9, variant.ciaTimer & 0xff, 0x8d, 0x04, 0xdc, 0xa9, variant.ciaTimer >> 8, 0x8d, 0x05, 0xdc);
  }
  init.push(0x60);
  const play = [0xee, lo, hi, 0xd0, 0x08, 0xee, lo + 1, hi, 0xd0, 0x03, 0xee, lo + 2, hi];
  if (variant.busyLoops > 0) play.push(0xa2, variant.busyLoops, 0xca, 0xd0, 0xfd);
  play.push(0x60);
  const code = [...init, 0, 0, 0, 0, ...play];
  const header = new Uint8Array(0x7c);
  const view = new DataView(header.buffer);
  header.set([0x50, 0x53, 0x49, 0x44]);
  view.setUint16(4, 2);
  view.setUint16(6, 0x7c);
  view.setUint16(10, 0x1000);
  view.setUint16(12, 0x1000 + init.length + 4);
  view.setUint16(14, 1);
  view.setUint16(16, 1);
  view.setUint32(18, variant.ciaTimer === null ? 0 : 1);
  header.set(new TextEncoder().encode(`soak ${variant.name}`.slice(0, 31)), 0x16);
  view.setUint16(0x76, variant.video === "PAL" ? 0x04 : 0x08);
  return Uint8Array.from([...header, 0x00, 0x10, ...code]);
};

// ------------------------------------------------------------------------------------------------
// The device over REST, the way the app reaches it: config writes spaced by the write interval,
// reads that can bypass nothing here because nothing in this process throttles them.
// ------------------------------------------------------------------------------------------------

/** Across every simulated app process, so a report covers the whole soak. */
const totals = { requests: 0, failures: 0, slowest: 0 };

class Device {
  dead = false;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private lastWriteAt = 0;

  async request(method: string, route: string, init: { body?: Uint8Array | string; type?: string } = {}) {
    if (this.dead) throw new Error("The app is no longer running");
    totals.requests += 1;
    const started = Date.now();
    try {
      const response = await fetch(BASE + route, {
        method,
        body: init.body,
        headers: init.type ? { "Content-Type": init.type } : undefined,
        signal: AbortSignal.timeout(8000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok)
        throw new Error(`${method} ${route}: HTTP ${response.status} ${new TextDecoder().decode(bytes)}`);
      return bytes;
    } catch (error) {
      totals.failures += 1;
      throw error;
    } finally {
      totals.slowest = Math.max(totals.slowest, Date.now() - started);
    }
  }

  json = async (method: string, route: string) =>
    JSON.parse(new TextDecoder().decode(await this.request(method, route))) as Record<string, unknown>;

  readmem = (address: number, length: number) =>
    this.request(
      "GET",
      `/v1/machine:readmem?address=${address.toString(16).toUpperCase().padStart(4, "0")}&length=${length}`,
    );

  item = async (name: string): Promise<{ current: string; values: string[] }> => {
    const body = await this.json("GET", `/v1/configs/${encodeURIComponent(CATEGORY)}/${encodeURIComponent(name)}`);
    return (body[CATEGORY] as Record<string, { current: string; values: string[] }>)[name];
  };

  /** A config write behind the same interval the app's write queue enforces. */
  write = (name: string, value: string) => {
    const next = this.writeQueue.then(async () => {
      const wait = WRITE_DELAY_MS - (Date.now() - this.lastWriteAt);
      if (wait > 0) await sleep(wait);
      this.lastWriteAt = Date.now();
      const route = `/v1/configs/${encodeURIComponent(CATEGORY)}/${encodeURIComponent(name)}?value=${encodeURIComponent(value)}`;
      const body = await this.json("PUT", route);
      const errors = (body.errors as string[] | undefined) ?? [];
      if (errors.length) throw new Error(`PUT ${name}=${value}: ${errors.join("; ")}`);
    });
    this.writeQueue = next.catch(() => undefined);
    return next;
  };

  heldKeys = async () => ((await this.json("GET", "/v1/machine:input")).keyboard as { inputs: string[] }).inputs;

  sidplay = async (sid: Uint8Array) => {
    const boundary = "----remote-seek-soak";
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="soak.sid"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    await this.request("POST", "/v1/runners:sidplay", {
      body: Uint8Array.from([...head, ...sid, ...tail]),
      type: `multipart/form-data; boundary=${boundary}`,
    });
  };

  counter = async () => {
    const raw = await this.readmem(COUNTER_ADDRESS, 3);
    return raw[0] | (raw[1] << 8) | (raw[2] << 16);
  };
}

const remoteSeekApi = (device: Device, deviceKey: () => string | null): RemoteSeekApi => ({
  currentDeviceKey: deviceKey,
  getConfigItem: async (category, item) =>
    (await device.json("GET", `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}`)) as never,
  setConfigValue: async (_category, item, value) => {
    await device.write(item, String(value));
    return {} as never;
  },
  sendMachineInputBatch: async (batch) =>
    device.request("POST", "/v1/machine:input", { body: JSON.stringify(batch), type: "application/json" }),
  getMachineInputState: async () => (await device.json("GET", "/v1/machine:input")) as never,
  readMemory: (address, length) => device.readmem(parseInt(address, 16), length),
});

// ------------------------------------------------------------------------------------------------

type OpRecord = {
  op: string;
  variant: string;
  ms: number;
  fromSeconds?: number;
  targetSeconds?: number;
  landedSeconds?: number | null;
  truthSeconds?: number;
  /** What the app would show minus where the tune is: the position model's error. */
  errorSeconds?: number;
  /** Where the tune landed minus the target, for a jump that completed. */
  targetErrorSeconds?: number;
  completed?: boolean;
  violations: string[];
  note?: string;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

/** Vitest holds console output until the test ends; this file shows progress while it runs. */
const PROGRESS = OUT.replace(/\.json$/, ".progress.log");
const progress = (line: string) => {
  console.log(line);
  mkdirSync(path.dirname(PROGRESS), { recursive: true });
  appendFileSync(PROGRESS, `${line}\n`);
};

const writeReport = (report: unknown) => {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
};

describe(`remote SID seek soak on ${HOST}`, () => {
  it("leaves the device as it found it through every operation, and lands every jump", async () => {
    // `let`: a simulated app death leaves the old process's connection dead for good.
    let device = new Device();
    const info = await device.json("GET", "/v1/info");
    const realKey = JSON.stringify([
      String(info.unique_id).trim().toLowerCase(),
      String(info.hostname).trim().toLowerCase(),
    ]);
    let connectedKey: string | null = realKey;
    const inputProbe = await fetch(`${BASE}/v1/machine:input`, { signal: AbortSignal.timeout(5000) });
    if (inputProbe.status !== 200) {
      console.log(`[soak] ${HOST} has no key injection (HTTP ${inputProbe.status}); running the fail-safe checks`);
      await runFailSafeChecks(device, () => connectedKey, info);
      return;
    }

    const baseline = {
      cpu: (await device.item("CPU Speed")).current,
      turbo: (await device.item("Turbo Control")).current,
    };
    const settingsOf = () => ({ ...baseline });
    let expected = settingsOf();
    console.log(
      `[soak] ${HOST} ${info.product} fw ${info.firmware_version}; baseline ${JSON.stringify(baseline)}; seed ${SEED}`,
    );

    let modules: { guard: GuardModule; controller: ControllerModule } = await loadModules();
    let api = remoteSeekApi(device, () => connectedKey);
    let variant = VARIANTS[0];
    let profile: Awaited<ReturnType<ControllerModule["probeRemoteTuneSeek"]>> = null;
    let controller: InstanceType<ControllerModule["RemoteSidSeekController"]> | null = null;
    let position = 0;
    let positionAt = Date.now();
    const records: OpRecord[] = [];
    const deadline = Date.now() + MINUTES * 60_000;

    const truth = async () => (await device.counter()) / variant.callHz;
    const origin = () => position + (Date.now() - positionAt) / 1000;
    const setPosition = (seconds: number) => {
      position = seconds;
      positionAt = Date.now();
    };
    const syncPosition = async () => setPosition(await truth());

    const startTune = async (next: Variant) => {
      variant = next;
      await device.sidplay(counterPsid(variant));
      await sleep(1500);
      const { parseSidHeaderMetadata } = await import("@/lib/sid/sidUtils");
      const header = parseSidHeaderMetadata(counterPsid(variant));
      profile = await modules.controller.probeRemoteTuneSeek(api, header, 1);
      if (!profile) throw new Error(`The SID player screen was not found for ${variant.name}`);
      controller = new modules.controller.RemoteSidSeekController(api, profile);
      await syncPosition();
      // Some firmware sets its own Turbo Control and CPU Speed while the SID player runs (the
      // Ultimate 64 Elite on 3.15 here switches to U64 Turbo Registers and puts them back on reset),
      // so what a seek must give back is what the machine shows once the tune has started.
      expected = { cpu: (await device.item("CPU Speed")).current, turbo: (await device.item("Turbo Control")).current };
    };

    const invariants = async (allowJournal = false): Promise<string[]> => {
      const violations: string[] = [];
      const started = Date.now();
      const [cpu, turbo, keys] = [
        await device.item("CPU Speed"),
        await device.item("Turbo Control"),
        await device.heldKeys(),
      ];
      if (cpu.current !== expected.cpu)
        violations.push(`CPU Speed ${JSON.stringify(cpu.current)} != ${JSON.stringify(expected.cpu)}`);
      if (turbo.current !== expected.turbo) violations.push(`Turbo Control ${turbo.current} != ${expected.turbo}`);
      if (keys.length) violations.push(`keys held: ${keys.join(",")}`);
      if (!allowJournal && localStorage.getItem(JOURNAL_KEY))
        violations.push(`journal left: ${localStorage.getItem(JOURNAL_KEY)}`);
      const [dd00] = await device.readmem(0xdd00, 1);
      const [d018] = await device.readmem(0xd018, 1);
      const screen = (3 - (dd00 & 3)) * 0x4000 + ((d018 >> 4) & 15) * 0x400;
      const title = Array.from(await device.readmem(screen, 40), (c) =>
        String.fromCharCode((c & 0x7f) < 27 ? (c & 0x7f) + 64 : c & 0x7f),
      ).join("");
      if (!title.includes("SID PLAYER")) violations.push(`player screen gone: ${title.trim()}`);
      if (Date.now() - started > 3000) violations.push(`REST slow: invariant reads took ${Date.now() - started} ms`);
      return violations;
    };

    /** The machine's own settings for this stretch: sometimes a user CPU Speed, sometimes Turbo Off. */
    const chooseUserSettings = async () => {
      const roll = random();
      const target =
        roll < 0.6
          ? settingsOf()
          : roll < 0.8
            ? { cpu: baseline.cpu, turbo: "Off" }
            : { cpu: profile?.cpuSpeedOptions.find((o) => o.trim() === "4") ?? baseline.cpu, turbo: "Manual" };
      if (target.turbo !== expected.turbo) await device.write("Turbo Control", target.turbo);
      if (target.cpu !== expected.cpu) await device.write("CPU Speed", target.cpu);
      expected = target;
    };

    const landingRecord = async (
      op: string,
      started: number,
      extra: Partial<OpRecord>,
      landing: { seconds: number; atMs: number; completed: boolean } | null,
    ) => {
      const truthNow = await truth();
      const sinceLanding = landing ? (Date.now() - landing.atMs) / 1000 : 0;
      const landed = landing ? landing.seconds + sinceLanding : null;
      setPosition(truthNow);
      const target = extra.targetSeconds;
      return {
        op,
        variant: variant.name,
        ms: Date.now() - started,
        landedSeconds: landed,
        truthSeconds: truthNow,
        errorSeconds: landed === null ? undefined : landed - truthNow,
        targetErrorSeconds: landing?.completed && target !== undefined ? truthNow - sinceLanding - target : undefined,
        completed: landing?.completed,
        ...extra,
        violations: [] as string[],
      } satisfies OpRecord;
    };

    const ops: Array<{ name: string; weight: number; run: () => Promise<OpRecord> }> = [
      {
        name: "fast forward hold",
        weight: 5,
        run: async () => {
          const started = Date.now();
          const from = origin();
          await controller!.beginFastForward(origin, () => undefined);
          await sleep(between(400, 6000));
          return landingRecord("fast forward hold", started, { fromSeconds: from }, await controller!.endFastForward());
        },
      },
      {
        name: "jump forward",
        weight: 5,
        run: async () => {
          const started = Date.now();
          const from = origin();
          const target = Math.min(1200, from + between(3, 360));
          const landing = await controller!.jumpTo(origin, target);
          return landingRecord("jump forward", started, { fromSeconds: from, targetSeconds: target }, landing);
        },
      },
      {
        name: "jump back",
        weight: 4,
        run: async () => {
          const started = Date.now();
          const from = origin();
          const target = between(0, Math.max(0, from - 1));
          const landing = await controller!.jumpTo(origin, target);
          return landingRecord("jump back", started, { fromSeconds: from, targetSeconds: target }, landing);
        },
      },
      {
        name: "queued jumps",
        weight: 2,
        run: async () => {
          const started = Date.now();
          const targets = Array.from({ length: 2 + Math.floor(random() * 3) }, () => between(0, 400));
          let last: { seconds: number; atMs: number; completed: boolean } | null = null;
          const chain = targets.map((target) =>
            controller!.jumpTo(origin, target).then((landing) => {
              if (landing) setPosition(landing.seconds + (Date.now() - landing.atMs) / 1000);
              last = landing;
              return landing;
            }),
          );
          await Promise.all(chain);
          return landingRecord(
            "queued jumps",
            started,
            { targetSeconds: targets.at(-1), note: `${targets.length} jumps` },
            last,
          );
        },
      },
      {
        name: "cancel during jump",
        weight: 3,
        run: async () => {
          const started = Date.now();
          const jump = controller!.jumpTo(origin, between(0, 500));
          await sleep(between(30, 2500));
          await controller!.cancel("soak: stop");
          return landingRecord("cancel during jump", started, {}, await jump);
        },
      },
      {
        name: "cancel during hold",
        weight: 3,
        run: async () => {
          const started = Date.now();
          const begin = controller!.beginFastForward(origin, () => undefined).catch(() => undefined);
          await sleep(between(10, 3000));
          await controller!.cancel("soak: pause");
          await begin;
          await syncPosition();
          return { op: "cancel during hold", variant: variant.name, ms: Date.now() - started, violations: [] };
        },
      },
      {
        name: "app killed mid operation",
        weight: 3,
        run: async () => {
          const started = Date.now();
          const operation =
            random() < 0.5
              ? controller!.beginFastForward(origin, () => undefined)
              : controller!.jumpTo(origin, between(0, 500));
          void operation.catch(() => undefined);
          await sleep(between(50, 3000));
          // The process is gone: nothing it had queued or in flight may reach the device any more.
          device.dead = true;
          await sleep(1500);
          // A killed process runs no more timers. Its watchdog would otherwise fire minutes later, in
          // this test's single process, and fail its restore against the dead connection then.
          await controller!.cancel("soak: process killed");
          // A new process starts, reaches the device and replays the journal.
          vi.resetModules();
          modules = await loadModules();
          device = new Device();
          api = remoteSeekApi(device, () => connectedKey);
          const leftover = await invariants(true);
          const recovered = await modules.guard.recoverRemoteSeekJournal(api);
          await startTune(variant);
          return {
            op: "app killed mid operation",
            variant: variant.name,
            ms: Date.now() - started,
            violations: recovered ? [] : ["recovery reported failure"],
            note: `before recovery: ${leftover.join("; ") || "nothing left over"}`,
          };
        },
      },
      {
        name: "device switched mid operation",
        weight: 2,
        run: async () => {
          const started = Date.now();
          const operation =
            random() < 0.5
              ? controller!.beginFastForward(origin, () => undefined).catch(() => undefined)
              : controller!.jumpTo(origin, between(0, 500));
          await sleep(between(50, 2500));
          connectedKey = JSON.stringify(["ffffff", "another-ultimate"]);
          await sleep(between(200, 1500));
          await controller!.cancel("soak: device switched");
          await operation;
          connectedKey = realKey;
          const recovered = await modules.guard.recoverRemoteSeekJournal(api);
          await syncPosition();
          return {
            op: "device switched mid operation",
            variant: variant.name,
            ms: Date.now() - started,
            violations: recovered ? [] : ["recovery after switching back failed"],
          };
        },
      },
      {
        name: "another tune started mid operation",
        weight: 2,
        run: async () => {
          const started = Date.now();
          const operation =
            random() < 0.5
              ? controller!.beginFastForward(origin, () => undefined).catch(() => undefined)
              : controller!.jumpTo(origin, between(0, 500));
          await sleep(between(50, 2000));
          // What the Play page does: cancel first, then start the next tune.
          await controller!.cancel("soak: another tune");
          await operation;
          await startTune(pick(VARIANTS));
          return {
            op: "another tune started mid operation",
            variant: variant.name,
            ms: Date.now() - started,
            violations: [],
          };
        },
      },
      {
        name: "jump under background REST load",
        weight: 2,
        run: async () => {
          const started = Date.now();
          let loading = true;
          const load = (async () => {
            while (loading) {
              await device.readmem(0x0400, 64).catch(() => undefined);
              await sleep(40);
            }
          })();
          const from = origin();
          const target = random() < 0.5 ? between(0, from) : from + between(5, 200);
          const landing = await controller!.jumpTo(origin, target);
          loading = false;
          await load;
          return landingRecord(
            "jump under background REST load",
            started,
            { fromSeconds: from, targetSeconds: target },
            landing,
          );
        },
      },
    ];
    const totalWeight = ops.reduce((sum, op) => sum + op.weight, 0);
    const chooseOp = () => {
      let roll = random() * totalWeight;
      for (const op of ops) {
        roll -= op.weight;
        if (roll <= 0) return op;
      }
      return ops[0];
    };

    await startTune(VARIANTS[0]);
    let iteration = 0;
    try {
      while (Date.now() < deadline) {
        iteration += 1;
        if (iteration % 12 === 1 && iteration > 1) await startTune(pick(VARIANTS));
        if (iteration % 7 === 0) await chooseUserSettings();
        const op = chooseOp();
        const errorsBefore = logs.errors.length;
        let record: OpRecord;
        try {
          record = await op.run();
        } catch (error) {
          record = { op: op.name, variant: variant.name, ms: 0, violations: [`threw: ${(error as Error).message}`] };
        }
        // A landing the app would show more than a few seconds away from the tune is a defect.
        // A light play routine fast forwards about 65x even at 1 MHz, so 60 ms of timing is 4 s of tune.
        const tolerance = variant.busyLoops === 0 ? 6 : variant.callHz > 60 ? 4 : 2.5;
        if (record.errorSeconds !== undefined && Math.abs(record.errorSeconds) > tolerance) {
          record.violations.push(`landing off by ${record.errorSeconds.toFixed(2)} s`);
        }
        if (record.targetErrorSeconds !== undefined && Math.abs(record.targetErrorSeconds) > tolerance) {
          record.violations.push(`jump missed its target by ${record.targetErrorSeconds.toFixed(2)} s`);
        }
        record.violations.push(...(await invariants()));
        const injected = /killed|cancel|switched|another tune/.test(op.name);
        const newErrors = logs.errors
          .slice(errorsBefore)
          .map(([message, details]) => `${message} ${JSON.stringify(details).slice(0, 300)}`);
        if (!injected && newErrors.length) record.violations.push(`error logs: ${newErrors.join(" | ")}`);
        records.push(record);
        const status = record.violations.length ? `VIOLATION ${record.violations.join("; ")}` : "ok";
        progress(
          `[soak ${HOST} #${iteration} ${new Date().toISOString().slice(11, 19)}] ${op.name} (${variant.name}) ` +
            `${record.ms} ms${record.errorSeconds !== undefined ? ` model ${record.errorSeconds.toFixed(2)} s` : ""}` +
            `${record.targetErrorSeconds !== undefined ? ` target ${record.targetErrorSeconds.toFixed(2)} s` : ""} ${status}`,
        );
        if (record.violations.length) {
          // Put the device back to the baseline the next operations assume, then carry on.
          localStorage.removeItem(JOURNAL_KEY);
          await device.request("POST", "/v1/machine:input", {
            body: JSON.stringify({ events: [{ kind: "release_all" }] }),
            type: "application/json",
          });
          await device.write("CPU Speed", expected.cpu);
          await device.write("Turbo Control", expected.turbo);
        }
      }
    } finally {
      await controller?.cancel("soak finished");
      const final = await invariants();
      // Leave the machine as the soak found it: a reset ends the player's own session, and anything
      // the soak's user-setting stretches changed is written back.
      await device.request("PUT", "/v1/machine:reset");
      await sleep(2000);
      if ((await device.item("CPU Speed")).current !== baseline.cpu) await device.write("CPU Speed", baseline.cpu);
      if ((await device.item("Turbo Control")).current !== baseline.turbo)
        await device.write("Turbo Control", baseline.turbo);
      const landed = records.filter((record) => record.errorSeconds !== undefined && record.completed !== false);
      const byOp: Record<string, unknown> = {};
      for (const op of ops) {
        const mine = records.filter((record) => record.op === op.name);
        const model = mine.filter((r) => r.errorSeconds !== undefined).map((r) => r.errorSeconds!);
        const target = mine.filter((r) => r.targetErrorSeconds !== undefined).map((r) => r.targetErrorSeconds!);
        byOp[op.name] = {
          count: mine.length,
          violations: mine.filter((record) => record.violations.length).length,
          p50Ms: percentile(
            mine.map((record) => record.ms),
            50,
          ),
          p95Ms: percentile(
            mine.map((record) => record.ms),
            95,
          ),
          modelP95AbsErr: percentile(model.map(Math.abs), 95),
          modelMaxAbsErr: model.length ? Math.max(...model.map(Math.abs)) : null,
          targetP50Err: percentile(target, 50),
          targetP95AbsErr: percentile(target.map(Math.abs), 95),
          targetMaxAbsErr: target.length ? Math.max(...target.map(Math.abs)) : null,
        };
      }
      const report = {
        host: HOST,
        device: { product: info.product, firmware: info.firmware_version },
        seed: SEED,
        minutes: MINUTES,
        writeDelayMs: WRITE_DELAY_MS,
        operations: records.length,
        violations: records.filter((record) => record.violations.length).length,
        finalViolations: final,
        requests: totals.requests,
        requestFailures: totals.failures,
        slowestRequestMs: totals.slowest,
        landings: landed.length,
        byOp,
        records,
        warnings: logs.warns.length,
        errorLogs: logs.errors.map(([message, details]) => ({ message, details })),
        warningLogs: logs.warns.slice(-200).map(([message, details]) => ({ message, details })),
      };
      writeReport(report);
      console.log(`[soak] ${HOST} summary ${JSON.stringify({ ...report, records: undefined }, null, 1)}`);
      expect(final).toEqual([]);
      expect(report.violations).toBe(0);
    }
  });
});

const loadModules = async () => ({
  guard: await import("@/lib/playback/remoteSeek/remoteSeekDeviceGuard"),
  controller: await import("@/lib/playback/remoteSeek/remoteSidSeekController"),
});

/**
 * A machine without key injection: the Play page never offers the gestures there, and if anything
 * tried a seek anyway it must fail before changing the machine.
 */
const runFailSafeChecks = async (device: Device, deviceKey: () => string | null, info: Record<string, unknown>) => {
  const { probeMachineInputCapability } = await import("@/lib/deviceCapabilities");
  const modules = await loadModules();
  const api = remoteSeekApi(device, deviceKey);
  const capability = await probeMachineInputCapability({
    api: { getMachineInputState: () => api.getMachineInputState() } as never,
    deviceId: "soak",
    firmwareVersion: String(info.firmware_version ?? ""),
    coreVersion: (info.core_version as string | undefined) ?? null,
  });
  expect(capability.status).not.toBe("available");
  await device.sidplay(counterPsid(VARIANTS[0]));
  await sleep(1500);
  const before = await device.readmem(0x0400, 1000);
  const deadline = Date.now() + Math.min(MINUTES, 5) * 60_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    await expect(modules.guard.RemoteSeekDeviceSession.open(api)).rejects.toThrow();
    const profile = {
      screenAddress: 0x0400,
      timing: { frameHz: 50, ciaClockHz: 985248 },
      headerPlayCallHz: 50,
      cpuSpeedOptions: [" 1", " 64"],
    };
    const controller = new modules.controller.RemoteSidSeekController(api, profile);
    await expect(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    ).rejects.toThrow();
    expect(await controller.jumpTo(() => 0, 30)).toBeNull();
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    await sleep(500);
  }
  const after = await device.readmem(0x0400, 1000);
  console.log(
    `[soak] ${String(info.product)}: ${attempts} refused seek attempts, ${totals.requests} requests, ${totals.failures} refused`,
  );
  // Nothing a refused seek did reached the C64: its screen still changes only through the tune itself.
  expect(after.length).toBe(before.length);
  writeReport({
    host: HOST,
    device: info,
    failSafeAttempts: attempts,
    requests: totals.requests,
    refused: totals.failures,
  });
};
