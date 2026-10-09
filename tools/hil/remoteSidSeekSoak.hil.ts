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
 * Environment: SOAK_HOST (c64u; `mock` and `mock-u2` run it against the mock server, as CI does),
 * SOAK_MINUTES (20), SOAK_SEED (time), SOAK_WRITE_DELAY_MS (500, the app's config write interval in
 * Balanced mode), SOAK_OUT (artifacts/remote-seek-soak-<host>.json). On a machine without key input
 * (the Ultimate-II+(L)) the seeks go through the SID player's own keyboard routine instead.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  deviceKeyOf,
  openDeviceTarget,
  SeekTestDevice,
  seekTestApi,
  type DeviceTarget,
  type RequestTotals,
} from "./remoteSeekHil/device";
import { callHzOfTune, counterPsid, SOAK_TUNES, type CounterTune } from "./remoteSeekHil/tunes";

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
type ProbeModule = typeof import("@/lib/playback/remoteSeek/remoteTuneSeekProbe");
type SeekProfile = import("@/lib/playback/remoteSeek/remoteTuneSeekProbe").RemoteTuneSeekProfile;

const HOST = process.env.SOAK_HOST ?? "c64u";
const MINUTES = Number(process.env.SOAK_MINUTES ?? 20);
const WRITE_DELAY_MS = Number(process.env.SOAK_WRITE_DELAY_MS ?? 500);
const SEED = Number(process.env.SOAK_SEED ?? Date.now() % 1_000_000);
const OUT = process.env.SOAK_OUT ?? `artifacts/remote-seek-soak-${HOST}.json`;
const U64 = "U64 Specific Settings";
const AUDIO_MIXER = "Audio Mixer";
const JOURNAL_KEY = "c64u_remote_seek_device_journal_v1";

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

/** An operation the soak expects to fail, such as one it cancels or kills; noted, not hidden. */
const noteFailure = (what: string) => (error: unknown) => {
  progress(`[soak ${HOST}] ${what} ended with: ${error instanceof Error ? error.message : String(error)}`);
};

/** Across every simulated app process, so a report covers the whole soak. */
const totals: RequestTotals = { requests: 0, failures: 0, slowest: 0 };

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
    const target: DeviceTarget = await openDeviceTarget(HOST);
    const newDevice = () => new SeekTestDevice(target, totals, progress, WRITE_DELAY_MS);
    // `let`: a simulated app death leaves the old process's connection dead for good.
    let device = newDevice();
    const info = await device.json("GET", "/v1/info");
    const realKey = deviceKeyOf(info);
    let connectedKey: string | null = realKey;
    // A machine without key input, the Ultimate-II+(L), fast forwards through the player's own code.
    const keyInput = (await fetch(`${target.base}/v1/machine:input`, { signal: AbortSignal.timeout(5000) })).ok;

    const read = async (category: string, name: string) => (await device.optionalItem(category, name))?.current ?? null;
    const readSettings = async () => ({
      cpu: await read(U64, "CPU Speed"),
      turbo: await read(U64, "Turbo Control"),
      master: await read(AUDIO_MIXER, "Vol Master"),
    });
    const baseline = await readSettings();
    const systemMode = (await read(U64, "System Mode"))?.trim() ?? "PAL";
    if (systemMode !== "PAL")
      throw new Error(`The soak's play-call rates are for a PAL machine; ${HOST} runs ${systemMode}`);
    let expected = { ...baseline };
    progress(
      `[soak] ${HOST} ${info.product} fw ${info.firmware_version}; key input ${keyInput}; ` +
        `baseline ${JSON.stringify(baseline)}; seed ${SEED}`,
    );

    let modules = await loadModules();
    let api = seekTestApi(device, () => connectedKey);
    let variant: CounterTune = SOAK_TUNES[0];
    let profile: SeekProfile | null = null;
    let controller: InstanceType<ControllerModule["RemoteSidSeekController"]> | null = null;
    let position = 0;
    let positionAt = Date.now();
    const records: OpRecord[] = [];
    const deadline = Date.now() + MINUTES * 60_000;

    const truth = async () => (await device.counter()) / callHzOfTune(variant);
    const origin = () => position + (Date.now() - positionAt) / 1000;
    const setPosition = (seconds: number) => {
      position = seconds;
      positionAt = Date.now();
    };
    const syncPosition = async () => setPosition(await truth());

    const startTune = async (next: CounterTune) => {
      variant = next;
      await device.sidplay(counterPsid(variant));
      await sleep(1500);
      const { parseSidHeaderMetadata } = await import("@/lib/sid/sidUtils");
      const header = parseSidHeaderMetadata(counterPsid(variant));
      profile = await modules.probe.probeRemoteTuneSeek(api, header, 1, () => true, { keyInput });
      if (!profile) throw new Error(`No SID player clock or fast forward found for ${variant.name}`);
      // Without key input a rewind starts the tune afresh, as the Play page does.
      const replay = keyInput ? null : () => device.sidplay(counterPsid(variant));
      controller = new modules.controller.RemoteSidSeekController(api, profile, replay, () => seekMute);
      await syncPosition();
      // Some firmware sets its own Turbo Control and CPU Speed while the SID player runs (the
      // Ultimate 64 Elite on 3.15 here switches to U64 Turbo Registers and puts them back on reset),
      // so what a seek must give back is what the machine shows once the tune has started.
      expected = await readSettings();
    };

    const invariants = async (allowJournal = false): Promise<string[]> => {
      const violations: string[] = [];
      const started = Date.now();
      const now = await readSettings();
      for (const key of ["cpu", "turbo", "master"] as const) {
        if (now[key] !== expected[key])
          violations.push(`${key} ${JSON.stringify(now[key])} != ${JSON.stringify(expected[key])}`);
      }
      const keys = await device.heldKeys();
      if (keys.length) violations.push(`keys held: ${keys.join(",")}`);
      if (profile?.fastForward.kind === "patch") {
        const site = await device.readmem(profile.fastForward.ldyOperandAddress - 1, 2);
        if (site[0] !== 0xa0 || site[1] !== 0x00) violations.push(`fast forward patch left: ${site.join(",")}`);
      }
      if (!allowJournal && localStorage.getItem(JOURNAL_KEY))
        violations.push(`journal left: ${localStorage.getItem(JOURNAL_KEY)}`);
      if (profile) {
        const { readSidPlayerClock } = await import("@/lib/playback/remoteSeek/sidPlayerClock");
        if ((await readSidPlayerClock(api.readMemory, profile.clock, false)) === null)
          violations.push("the SID player's clock is gone");
      }
      if (Date.now() - started > 3000) violations.push(`REST slow: invariant reads took ${Date.now() - started} ms`);
      return violations;
    };

    /** The user's settings for this stretch: a CPU Speed, Turbo Off, and when seeking is muted. */
    let seekMute: "always" | "rewind" | "never" = "rewind";
    const chooseUserSettings = async () => {
      seekMute = pick(["always", "rewind", "never"] as const);
      if (baseline.cpu === null || baseline.turbo === null) return;
      const roll = random();
      const next =
        roll < 0.6
          ? { ...expected, cpu: baseline.cpu, turbo: baseline.turbo }
          : roll < 0.8
            ? { ...expected, cpu: baseline.cpu, turbo: "Off" }
            : {
                ...expected,
                cpu: profile?.cpuSpeedOptions.find((o) => o.trim() === "4") ?? baseline.cpu,
                turbo: "Manual",
              };
      if (next.turbo !== expected.turbo) await device.write(U64, "Turbo Control", next.turbo as string);
      if (next.cpu !== expected.cpu) await device.write(U64, "CPU Speed", next.cpu as string);
      expected = next;
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
          const begin = controller!.beginFastForward(origin, () => undefined).catch(noteFailure("cancelled hold"));
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
          void operation.catch(noteFailure("killed operation"));
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
          device = newDevice();
          api = seekTestApi(device, () => connectedKey);
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
              ? controller!.beginFastForward(origin, () => undefined).catch(noteFailure("interrupted hold"))
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
              ? controller!.beginFastForward(origin, () => undefined).catch(noteFailure("interrupted hold"))
              : controller!.jumpTo(origin, between(0, 500));
          await sleep(between(50, 2000));
          // What the Play page does: cancel first, then start the next tune.
          await controller!.cancel("soak: another tune");
          await operation;
          await startTune(pick(SOAK_TUNES));
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
              await device.readmem(0x0400, 64).catch(noteFailure("background read"));
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

    await startTune(SOAK_TUNES[0]);
    let iteration = 0;
    /**
     * Put the device back to the baseline the next operations assume. A device that stopped answering
     * gets a few more chances, each failure logged, before the soak gives up on it.
     */
    const resetAfterViolation = async (restartTune: boolean) => {
      localStorage.removeItem(JOURNAL_KEY);
      for (let attempt = 1; ; attempt += 1) {
        try {
          if (keyInput) {
            await device.request("POST", "/v1/machine:input", {
              body: JSON.stringify({ events: [{ kind: "release_all" }] }),
              type: "application/json",
            });
          } else if (profile?.fastForward.kind === "patch") {
            await device.writemem(profile.fastForward.ldyOperandAddress, Uint8Array.of(0));
          }
          if (expected.cpu !== null) await device.write(U64, "CPU Speed", expected.cpu);
          if (expected.turbo !== null) await device.write(U64, "Turbo Control", expected.turbo);
          if (expected.master !== null) await device.write(AUDIO_MIXER, "Vol Master", expected.master);
          if (restartTune) await startTune(variant);
          return;
        } catch (error) {
          progress(`[soak ${HOST}] reset after a violation, attempt ${attempt}, failed: ${error}`);
          if (attempt === 5) throw error;
          await sleep(5000);
        }
      }
    };

    try {
      while (Date.now() < deadline) {
        iteration += 1;
        if (iteration % 12 === 1 && iteration > 1) await startTune(pick(SOAK_TUNES));
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
        const tolerance = variant.busyLoops === 0 ? 6 : variant.ciaTimer !== null ? 4 : 2.5;
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
        if (record.violations.length) await resetAfterViolation(record.violations.some((v) => v.startsWith("threw")));
      }
    } finally {
      await controller?.cancel("soak finished");
      const final = await invariants();
      // Leave the machine as the soak found it: a reset ends the player's own session, and anything
      // the soak's user-setting stretches changed is written back.
      await device.reset();
      await sleep(2000);
      const end = await readSettings();
      if (baseline.cpu !== null && end.cpu !== baseline.cpu) await device.write(U64, "CPU Speed", baseline.cpu);
      if (baseline.turbo !== null && end.turbo !== baseline.turbo)
        await device.write(U64, "Turbo Control", baseline.turbo);
      if (baseline.master !== null && end.master !== baseline.master)
        await device.write(AUDIO_MIXER, "Vol Master", baseline.master);
      await target.close();
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
        device: { product: info.product, firmware: info.firmware_version, keyInput },
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
  guard: (await import("@/lib/playback/remoteSeek/remoteSeekDeviceGuard")) as GuardModule,
  controller: (await import("@/lib/playback/remoteSeek/remoteSidSeekController")) as ControllerModule,
  probe: (await import("@/lib/playback/remoteSeek/remoteTuneSeekProbe")) as ProbeModule,
});
