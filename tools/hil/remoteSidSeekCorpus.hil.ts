/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Remote SID seeking across every kind of tune the SID player takes, using the app's own modules.
 *
 * Generated tunes cover each header shape with an exact reference: their play routine counts its
 * calls, wherever the code loads. They are single and many sub tunes, a late sub tune, two and three
 * SIDs, NTSC, CIA timers at 2x and 8x, code at $C000, under the KERNAL at $E000 and over the screen
 * at $0400, and a jump past 99:59 into an hour-long tune. RSID, BASIC and PSIDs without a play
 * routine must be refused before anything reaches the machine.
 *
 * On a real machine, CORPUS_HVSC (default ../C64Music) adds real HVSC tunes picked for the same
 * extremes: 82 sub tunes, the largest and smallest files, a zero-length sub tune, 30-minute tunes
 * and more. They have no reference, so a landing is checked against the player's own clock where
 * that equals the music's position, and every operation must leave the machine as it was.
 *
 *   SOAK_HOST=c64u npx vitest run --config tools/hil/vitest.hil.config.ts tools/hil/remoteSidSeekCorpus.hil.ts
 *
 * SOAK_HOST is a host name, or `mock` / `mock-u2` for the mock server, as CI runs it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { deviceKeyOf, openDeviceTarget, SeekTestDevice, seekTestApi, type RequestTotals } from "./remoteSeekHil/device";
import { callHzOfTune, counterPsid, type CounterTune } from "./remoteSeekHil/tunes";

const logs = vi.hoisted(() => ({ errors: [] as Array<[string, unknown]> }));
vi.mock("@/lib/logging", () => ({
  addLog: () => undefined,
  addErrorLog: (message: string, details?: unknown) => {
    logs.errors.push([message, details]);
  },
}));

const HOST = process.env.SOAK_HOST ?? "c64u";
const OUT = process.env.SOAK_OUT ?? `artifacts/remote-seek-corpus-${HOST}.json`;
const HVSC = process.env.CORPUS_HVSC ?? path.resolve(process.cwd(), "../C64Music");
const U64 = "U64 Specific Settings";
const AUDIO_MIXER = "Audio Mixer";
const JOURNAL_KEY = "c64u_remote_seek_device_journal_v1";
/** Real tunes play in the room; they play this quietly, and the seek still has a volume to mute. */
const QUIET_VOLUME = "-42 dB";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Entry = {
  name: string;
  /** Bytes of the tune, and the sub tune to play (1-based). */
  load: () => Uint8Array;
  songNr: number;
  /** A generated tune: its play calls are counted, so every landing has an exact reference. */
  counted?: CounterTune;
  /** Expected to be refused by the header gate. */
  refused?: boolean;
  /** Jump this far into the tune, past where the clock rolls over at 99:59. */
  farJumpSeconds?: number;
};

const generated = (tune: CounterTune, extra: Partial<Entry> = {}): Entry => ({
  name: tune.name,
  load: () => counterPsid(tune),
  songNr: tune.startSong ?? 1,
  counted: tune,
  ...extra,
});

const GENERATED: Entry[] = [
  generated({ name: "single sub tune", video: "PAL", busyLoops: 60, ciaTimer: null }),
  generated({ name: "sub tune 13 of 20", video: "PAL", busyLoops: 60, ciaTimer: null, songs: 20, startSong: 13 }),
  generated({ name: "two SIDs", video: "PAL", busyLoops: 60, ciaTimer: null, extraSids: [0xd420] }),
  generated({ name: "three SIDs", video: "PAL", busyLoops: 60, ciaTimer: null, extraSids: [0xd420, 0xd440] }),
  generated({ name: "NTSC", video: "NTSC", busyLoops: 60, ciaTimer: null }),
  generated({ name: "CIA timer at 2x", video: "PAL", busyLoops: 60, ciaTimer: 0x2663 }),
  generated({ name: "CIA timer at 8x", video: "PAL", busyLoops: 20, ciaTimer: 0x0998 }),
  generated({ name: "code at $C000", video: "PAL", busyLoops: 60, ciaTimer: null, loadAddress: 0xc000 }),
  generated({
    name: "code under the KERNAL at $E000",
    video: "PAL",
    busyLoops: 60,
    ciaTimer: null,
    loadAddress: 0xe000,
  }),
  generated({
    name: "code over the screen at $0400",
    video: "PAL",
    busyLoops: 60,
    ciaTimer: null,
    loadAddress: 0x0400,
  }),
  generated({ name: "light, an hour long", video: "PAL", busyLoops: 0, ciaTimer: null }, { farJumpSeconds: 6300 }),
  generated({ name: "RSID", video: "PAL", busyLoops: 0, ciaTimer: null, magic: "RSID" }, { refused: true }),
  generated(
    { name: "BASIC RSID", video: "PAL", busyLoops: 0, ciaTimer: null, magic: "RSID", basic: true },
    { refused: true },
  ),
  generated(
    { name: "no play routine", video: "PAL", busyLoops: 0, ciaTimer: null, noPlayRoutine: true },
    { refused: true },
  ),
];

/** Real HVSC tunes picked for the extremes, played on a real machine when the collection is there. */
const HVSC_PICKS: Array<{ file: string; songNr: number; refused?: boolean; farJumpSeconds?: number }> = [
  { file: "MUSICIANS/G/Grigg_Chris/Games_Winter_Edition.sid", songNr: 47 },
  { file: "MUSICIANS/C/Cadaver/Metal_Warrior_4.sid", songNr: 71 },
  { file: "MUSICIANS/C/Chiummo_Gaetano/Hope_3SID.sid", songNr: 1 },
  { file: "GAMES/S-Z/Super_Mario_Bros_64_2SID.sid", songNr: 5 },
  { file: "GAMES/A-F/Force_Seven.sid", songNr: 1 },
  { file: "GAMES/A-F/Byte_Invaders.sid", songNr: 1 },
  { file: "GAMES/A-F/Bullseye.sid", songNr: 2 },
  { file: "GAMES/A-F/Breakdown.sid", songNr: 3 },
  { file: "GAMES/A-F/Breaker.sid", songNr: 2 },
  { file: "DEMOS/M-R/Maritime_Loader.sid", songNr: 1 },
  { file: "MUSICIANS/N/Ninja/Ta-Boo.sid", songNr: 1 },
  { file: "GAMES/0-9/4x4_Off-Road_Racing.sid", songNr: 3 },
  { file: "MUSICIANS/F/Fate/World_Record_1.sid", songNr: 1, farJumpSeconds: 1800 },
  { file: "MUSICIANS/D/Detert_Thomas/Gordian_Tomb.sid", songNr: 2, farJumpSeconds: 1500 },
  { file: "MUSICIANS/H/Hubbard_Rob/Commando.sid", songNr: 1 },
  { file: "GAMES/A-F/Christmas_Eve_1983_BASIC.sid", songNr: 1, refused: true },
  { file: "GAMES/A-F/Big_Mac.sid", songNr: 1, refused: true },
];

type Result = {
  name: string;
  outcome: "refused" | "seeked" | "unavailable";
  checks: Array<{ op: string; errorSeconds?: number; ms: number }>;
  violations: string[];
};

describe(`remote SID seek across tunes on ${HOST}`, () => {
  it("seeks every kind of tune the player takes, refuses the rest, and leaves the machine as it was", async () => {
    const totals: RequestTotals = { requests: 0, failures: 0, slowest: 0 };
    const target = await openDeviceTarget(HOST);
    const device = new SeekTestDevice(target, totals, (line) => console.log(line), 300);
    const info = await device.json("GET", "/v1/info");
    const api = seekTestApi(device, () => deviceKeyOf(info));
    const keyInput = (await fetch(`${target.base}/v1/machine:input`, { signal: AbortSignal.timeout(5000) })).ok;
    const { parseSidHeaderMetadata } = await import("@/lib/sid/sidUtils");
    const { remoteSeekHeaderBlocker, probeRemoteTuneSeek } =
      await import("@/lib/playback/remoteSeek/remoteTuneSeekProbe");
    const { RemoteSidSeekController } = await import("@/lib/playback/remoteSeek/remoteSidSeekController");
    const { readSidPlayerClock } = await import("@/lib/playback/remoteSeek/sidPlayerClock");

    const entries: Entry[] = [...GENERATED];
    if (!target.simulated && existsSync(HVSC)) {
      for (const pick of HVSC_PICKS) {
        const file = path.join(HVSC, pick.file);
        if (existsSync(file)) entries.push({ name: pick.file, load: () => readFileSync(file), ...pick });
      }
    }

    const originalVolume = (await device.optionalItem(AUDIO_MIXER, "Vol Master"))?.current ?? null;
    if (originalVolume !== null && !target.simulated) await device.write(AUDIO_MIXER, "Vol Master", QUIET_VOLUME);
    const settings = async () => ({
      cpu: (await device.optionalItem(U64, "CPU Speed"))?.current ?? null,
      turbo: (await device.optionalItem(U64, "Turbo Control"))?.current ?? null,
      master: (await device.optionalItem(AUDIO_MIXER, "Vol Master"))?.current ?? null,
    });

    const results: Result[] = [];
    try {
      for (const entry of entries) {
        const result: Result = { name: entry.name, outcome: "unavailable", checks: [], violations: [] };
        results.push(result);
        const bytes = entry.load();
        const header = parseSidHeaderMetadata(bytes);
        const blocker = remoteSeekHeaderBlocker(header);
        if (blocker) {
          result.outcome = "refused";
          if (!entry.refused) result.violations.push(`refused unexpectedly: ${blocker}`);
          continue;
        }
        if (entry.refused) result.violations.push("not refused by the header gate");
        await device.sidplay(bytes, entry.songNr);
        await sleep(1500);
        const profile = await probeRemoteTuneSeek(api, header!, entry.songNr, () => true, { keyInput });
        if (!profile) {
          result.violations.push("the probe found no SID player clock or fast forward");
          continue;
        }
        result.outcome = "seeked";
        const replay = keyInput ? null : () => device.sidplay(bytes, entry.songNr);
        const controller = new RemoteSidSeekController(api, profile, replay, () => "always");
        await controller.prepare();
        const expected = await settings();
        const clockNow = () => readSidPlayerClock(api.readMemory, profile.clock, false);
        const truth = async () => (entry.counted ? (await device.counter()) / callHzOfTune(entry.counted) : null);
        // Without a reference the clock is the position only for a tune called once a frame.
        const clockIsPosition = profile.headerPlayCallHz === profile.timing.frameHz;

        let position = (await truth()) ?? (await clockNow()) ?? 0;
        let positionAt = Date.now();
        const origin = () => position + (Date.now() - positionAt) / 1000;
        const check = async (
          op: string,
          run: () => Promise<{ seconds: number; atMs: number } | null>,
          target?: number,
        ) => {
          const started = Date.now();
          const landing = await run();
          const errorsBefore = logs.errors.length;
          const since = landing ? (Date.now() - landing.atMs) / 1000 : 0;
          const reference = (await truth()) ?? (clockIsPosition ? await clockNow() : null);
          const record: Result["checks"][number] = { op, ms: Date.now() - started };
          if (landing && reference !== null) {
            record.errorSeconds = landing.seconds + since - reference;
            const tolerance = entry.counted?.ciaTimer ? 4 : 3;
            if (Math.abs(record.errorSeconds) > tolerance)
              result.violations.push(`${op}: landed ${record.errorSeconds.toFixed(2)} s from the tune`);
          }
          if (landing && target !== undefined && reference !== null && Math.abs(reference - since - target) > 5)
            result.violations.push(`${op}: ${(reference - since - target).toFixed(2)} s from its target`);
          if (!landing) result.violations.push(`${op}: no landing`);
          position = landing ? landing.seconds + since : (reference ?? origin());
          positionAt = Date.now();
          result.checks.push(record);
          const now = await settings();
          if (JSON.stringify(now) !== JSON.stringify(expected))
            result.violations.push(`${op}: settings ${JSON.stringify(now)}, expected ${JSON.stringify(expected)}`);
          if ((await device.heldKeys()).length) result.violations.push(`${op}: keys held`);
          if (profile.fastForward.kind === "patch") {
            const site = await device.readmem(profile.fastForward.ldyOperandAddress - 1, 2);
            if (site[1] !== 0) result.violations.push(`${op}: fast forward patch left on`);
          }
          if (localStorage.getItem(JOURNAL_KEY)) result.violations.push(`${op}: journal left`);
          if (logs.errors.length > errorsBefore) result.violations.push(`${op}: ${logs.errors.at(-1)?.[0]}`);
        };

        await check("fast forward hold", async () => {
          await controller.beginFastForward(origin, () => undefined);
          await sleep(2000);
          return controller.endFastForward();
        });
        const forward = origin() + 60;
        await check("jump forward", () => controller.jumpTo(origin, forward), forward);
        await check("jump back", () => controller.jumpTo(origin, 10), 10);
        await check("jump to the start", () => controller.jumpTo(origin, 0.5), 0.5);
        // At a cartridge's own speed a jump an hour in takes ten minutes; the long jump is the same code.
        if (entry.farJumpSeconds && keyInput) {
          const far = entry.farJumpSeconds;
          await check("jump far into a long tune", () => controller.jumpTo(origin, far), far);
        }
        console.log(`[corpus ${HOST}] ${entry.name}: ${result.violations.join("; ") || "ok"}`);
      }
    } finally {
      await device.reset();
      if (originalVolume !== null) await device.write(AUDIO_MIXER, "Vol Master", originalVolume);
      mkdirSync(path.dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify({ host: HOST, keyInput, totals, results }, null, 2));
      await target.close();
    }
    const failed = results.filter((result) => result.violations.length);
    expect(failed.map((result) => `${result.name}: ${result.violations.join("; ")}`)).toEqual([]);
    expect(results.filter((result) => result.outcome === "refused").length).toBeGreaterThanOrEqual(3);
  });
});
