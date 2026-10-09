/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import { addErrorLog, addLog } from "@/lib/logging";
import type { SidHeaderMetadata } from "@/lib/sid/sidUtils";
import {
  CPU_SPEED_ITEM,
  readU64ConfigItem,
  RemoteSeekDeviceSession,
  RemoteSeekSessionClosedError,
  SYSTEM_MODE_ITEM,
  type RemoteSeekDeviceApi,
} from "./remoteSeekDeviceGuard";
import {
  clockSecondsPerTuneSecond,
  cpuSpeedMhz,
  fastForwardRampOptions,
  machineTimingFor,
  playCallRateFromTimerSamples,
  seekSpeedFor,
  seekSpeedTiers,
  type MachineTiming,
} from "./remoteSeekPlan";
import {
  isSidPlayerTitle,
  parseSidPlayerClock,
  SID_PLAYER_CLOCK_OFFSET,
  sidPlayerScreenAddress,
} from "./sidPlayerScreen";

/**
 * Fast forward, rewind and jumps for a tune the C64 plays itself.
 *
 * Holding the left-arrow key makes the Ultimate's SID player call the tune's play routine back to
 * back, and CPU Speed sets how fast that loop runs. A rewind restarts the sub tune with the player's
 * own keys and fast forwards to the target. Every operation borrows the key and CPU Speed through a
 * RemoteSeekDeviceSession, which records the original values first and gives them back however the
 * operation ends.
 */

export type RemoteSeekApi = RemoteSeekDeviceApi & {
  readMemory: (
    address: string,
    length: number,
    options?: { __c64uBypassCooldown?: boolean; __c64uIntent?: InteractionIntent },
  ) => Promise<Uint8Array>;
};

export type RemoteTuneSeekProfile = {
  screenAddress: number;
  timing: MachineTiming;
  /** Play calls per second when the header settles it; null for a CIA-timed tune, which is measured. */
  headerPlayCallHz: number | null;
  /** Empty when the machine has no CPU Speed; rewinding and jumping back need it. */
  cpuSpeedOptions: string[];
};

export type RemoteSeekPositionListener = (positionSeconds: number) => void;

/** Ramp step while Next is held, and how often the clock is read for the elapsed time display. */
export const FAST_FORWARD_RAMP_INTERVAL_MS = 1000;
export const FAST_FORWARD_POLL_INTERVAL_MS = 250;
/** A hold longer than this ends by itself: no tune needs it, and a stuck gesture must not run on. */
export const FAST_FORWARD_MAX_HOLD_MS = 120_000;
/** A jump that has not landed by now is abandoned and the device given back. */
export const JUMP_TIMEOUT_MS = 30_000;
/** The fastest the clock is read during a jump; each read is a short REST round trip. */
const JUMP_POLL_MIN_INTERVAL_MS = 30;
const KEY_HOLD_MS = 60;
const KEY_GAP_MS = 50;
const RESTART_TIMEOUT_MS = 3000;
const SCREEN_PROBE_ATTEMPTS = 8;
const SCREEN_PROBE_INTERVAL_MS = 400;
const TIMER_SAMPLE_COUNT = 40;

const hex = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorDetails = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

class RemoteSeekCancelled extends Error {
  constructor(reason: string) {
    super(`Remote seek cancelled: ${reason}`);
    this.name = "RemoteSeekCancelled";
  }
}

/** Why a tune cannot be seeked on the C64, or null when it can be as far as its header tells. */
export const remoteSeekHeaderBlocker = (header: SidHeaderMetadata | null): string | null => {
  if (!header) return "the tune's header is not available";
  if (header.magicId !== "PSID") return "RSID tunes run their own interrupt, which the player cannot speed up";
  if (header.playAddress === 0) return "the tune installs its own interrupt, which the player cannot speed up";
  return null;
};

/** Play calls per second from the header, or null when the tune's own CIA timer decides it. */
export const headerPlayCallHz = (header: SidHeaderMetadata, songNr: number, timing: MachineTiming): number | null => {
  const speedBit = Math.min(Math.max(songNr, 1), 32) - 1;
  if (((header.speedBits >>> speedBit) & 1) === 1) return null;
  if (header.clock === "pal") return 50;
  if (header.clock === "ntsc") return 60;
  return timing.frameHz;
};

const readClockAt = async (api: RemoteSeekApi, screenAddress: number, fast: boolean): Promise<number | null> =>
  parseSidPlayerClock(
    await api.readMemory(hex(screenAddress + SID_PLAYER_CLOCK_OFFSET), 5, {
      __c64uIntent: "user",
      __c64uBypassCooldown: fast,
    }),
  );

/**
 * Find the player's screen after a tune starts, and the settings a seek depends on.
 * Returns null when the C64 is not showing the Ultimate SID player, e.g. on a simulated device.
 */
export const probeRemoteTuneSeek = async (
  api: RemoteSeekApi,
  header: SidHeaderMetadata,
  songNr: number,
  isCurrent: () => boolean = () => true,
): Promise<RemoteTuneSeekProfile | null> => {
  let screenAddress: number | null = null;
  for (let attempt = 0; attempt < SCREEN_PROBE_ATTEMPTS && isCurrent(); attempt += 1) {
    if (attempt > 0) await sleep(SCREEN_PROBE_INTERVAL_MS);
    const [dd00] = await api.readMemory("DD00", 1);
    const [d018] = await api.readMemory("D018", 1);
    const candidate = sidPlayerScreenAddress(dd00, d018);
    if (!isSidPlayerTitle(await api.readMemory(hex(candidate), 40))) continue;
    if ((await readClockAt(api, candidate, false)) === null) continue;
    screenAddress = candidate;
    break;
  }
  if (screenAddress === null) return null;
  const systemMode = await readU64ConfigItem(api, SYSTEM_MODE_ITEM).catch((error) => {
    addLog("warn", "Remote seek: System Mode unreadable; assuming PAL timing", errorDetails(error));
    return null;
  });
  const cpuSpeed = await readU64ConfigItem(api, CPU_SPEED_ITEM).catch((error) => {
    addLog("warn", "Remote seek: CPU Speed unreadable; fast forward only", errorDetails(error));
    return null;
  });
  const timing = machineTimingFor(systemMode?.value);
  const cpuSpeedOptions = (cpuSpeed?.options ?? []).filter((option) => cpuSpeedMhz(option) !== null);
  return {
    screenAddress,
    timing,
    headerPlayCallHz: headerPlayCallHz(header, songNr, timing),
    cpuSpeedOptions: cpuSpeedOptions.length > 1 ? cpuSpeedOptions : [],
  };
};

export const canRewindRemotely = (profile: RemoteTuneSeekProfile) => profile.cpuSpeedOptions.length > 1;

/**
 * Tune position while fast forwarding. The clock counts play calls as frames then, so a clock
 * second is 1 / clockPerTuneSecond tune seconds with the key down, and one tune second with it up.
 */
class PositionModel {
  private lastClock: number;

  constructor(
    private position: number,
    clock: number,
    private readonly clockPerTuneSecond: number,
  ) {
    this.lastClock = clock;
  }

  advance(clock: number, keyHeld: boolean): number {
    const delta = Math.max(0, clock - this.lastClock);
    this.lastClock = clock;
    this.position += keyHeld ? delta / this.clockPerTuneSecond : delta;
    return this.position;
  }

  get seconds() {
    return this.position;
  }
}

type FastForwardRun = {
  session: RemoteSeekDeviceSession;
  model: PositionModel;
  rampTimer: ReturnType<typeof setInterval> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  speedWrites: Promise<void>;
  onPosition: RemoteSeekPositionListener;
};

export class RemoteSidSeekController {
  private clockPerTuneSecond: number | null;
  private fastForward: FastForwardRun | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  private cancelGeneration = 0;
  private activeSession: RemoteSeekDeviceSession | null = null;

  constructor(
    private readonly api: RemoteSeekApi,
    readonly profile: RemoteTuneSeekProfile,
  ) {
    this.clockPerTuneSecond =
      profile.headerPlayCallHz === null ? null : clockSecondsPerTuneSecond(profile.headerPlayCallHz, profile.timing);
  }

  get canRewind() {
    return canRewindRemotely(this.profile);
  }

  /** Hold Next: press the key, then raise CPU Speed one step a second. Positions arrive on `onPosition`. */
  beginFastForward(fromSeconds: number, onPosition: RemoteSeekPositionListener): Promise<void> {
    return this.serialize(async (generation) => {
      if (this.fastForward) return;
      const ratio = await this.resolveClockPerTuneSecond();
      const session = await this.openSession();
      try {
        this.assertCurrent(generation);
        const clock = await this.readClock(false);
        if (clock === null) throw new Error("The SID player's clock is not on screen");
        const run: FastForwardRun = {
          session,
          model: new PositionModel(fromSeconds, clock, ratio),
          rampTimer: null,
          pollTimer: null,
          watchdog: null,
          speedWrites: Promise.resolve(),
          onPosition,
        };
        this.fastForward = run;
        await session.pressKey();
        const ramp = this.profile.cpuSpeedOptions.length
          ? fastForwardRampOptions(this.profile.cpuSpeedOptions, cpuSpeedMhz(session.originalCpuSpeed) ?? 1)
          : [];
        run.rampTimer = setInterval(() => {
          const next = ramp.shift();
          if (next === undefined) return;
          run.speedWrites = run.speedWrites
            .then(() => (this.fastForward === run ? session.setCpuSpeed(next) : undefined))
            .catch((error) => addLog("warn", "Remote fast forward could not raise CPU Speed", errorDetails(error)));
        }, FAST_FORWARD_RAMP_INTERVAL_MS);
        run.pollTimer = setInterval(() => void this.pollFastForward(run), FAST_FORWARD_POLL_INTERVAL_MS);
        run.watchdog = setTimeout(() => {
          addLog("warn", "Remote fast forward held too long; ending it", { maxHoldMs: FAST_FORWARD_MAX_HOLD_MS });
          void this.endFastForward("hold limit");
        }, FAST_FORWARD_MAX_HOLD_MS);
        addLog("debug", "Remote fast forward started", { fromSeconds, clock, ratio, ramp });
      } catch (error) {
        this.fastForward = null;
        await this.giveBack(session, "fast forward failed to start");
        throw error;
      }
    });
  }

  /** Release Next: stop, give the device back, and return the position reached (null if unknown). */
  endFastForward(reason = "released"): Promise<number | null> {
    return this.serialize(async () => {
      const run = this.fastForward;
      if (!run) return null;
      this.fastForward = null;
      this.stopTimers(run);
      try {
        await run.session.releaseKey();
        const clock = await this.readClock(false);
        if (clock !== null) run.model.advance(clock, true);
      } catch (error) {
        addLog("warn", "Remote fast forward could not read where it stopped", errorDetails(error));
      }
      await run.speedWrites;
      await this.giveBack(run.session, reason);
      addLog("debug", "Remote fast forward ended", { reason, positionSeconds: run.model.seconds });
      return run.model.seconds;
    });
  }

  /**
   * Land on `targetSeconds`: restart first when it lies behind `fromSeconds`, then fast forward in
   * speed tiers and release the key when the clock reaches the target. Returns the position landed
   * on, or null when the jump was cancelled or failed (the device is given back either way).
   */
  jumpTo(fromSeconds: number, targetSeconds: number, onPosition?: RemoteSeekPositionListener): Promise<number | null> {
    return this.serialize(async (generation) => {
      const target = Math.max(0, targetSeconds);
      if (target < fromSeconds && !this.canRewind) {
        addLog("debug", "Remote seek: jumping back needs CPU Speed; ignored", { fromSeconds, targetSeconds });
        return null;
      }
      const startedAt = Date.now();
      let session: RemoteSeekDeviceSession | null = null;
      try {
        const ratio = await this.resolveClockPerTuneSecond();
        session = await this.openSession();
        let from = fromSeconds;
        if (target < from) {
          await this.restartTune(generation);
          from = 0;
        }
        const startClock = await this.readClock(true);
        if (startClock === null) throw new Error("The SID player's clock is not on screen");
        const model = new PositionModel(from, startClock, ratio);
        const tiers = seekSpeedTiers(this.profile.cpuSpeedOptions, session.originalCpuSpeed);
        let speed = session.originalCpuSpeed;
        let held = false;
        let lastReadAt = 0;
        while (model.seconds < target) {
          this.assertCurrent(generation);
          if (Date.now() - startedAt > JUMP_TIMEOUT_MS)
            throw new Error(`Jump did not land within ${JUMP_TIMEOUT_MS} ms`);
          const wait = JUMP_POLL_MIN_INTERVAL_MS - (Date.now() - lastReadAt);
          if (wait > 0) await sleep(wait);
          lastReadAt = Date.now();
          const clock = await this.readClock(true);
          if (clock === null) continue;
          const position = model.advance(clock, held);
          onPosition?.(Math.min(position, target));
          if (position >= target) break;
          const wanted = this.profile.cpuSpeedOptions.length
            ? seekSpeedFor(tiers, (target - position) * ratio)
            : session.originalCpuSpeed;
          if (wanted !== speed) {
            // Key up before the speed changes: the write may wait out the config write interval,
            // and with the key up the tune plays on at normal speed instead of racing past the target.
            if (held) {
              await session.releaseKey();
              held = false;
            }
            await session.setCpuSpeed(wanted);
            speed = wanted;
            continue;
          }
          if (!held) {
            await session.pressKey();
            held = true;
          }
        }
        await session.releaseKey();
        addLog("debug", "Remote seek landed", {
          fromSeconds,
          targetSeconds: target,
          landedSeconds: model.seconds,
          tookMs: Date.now() - startedAt,
        });
        return model.seconds;
      } catch (error) {
        if (error instanceof RemoteSeekCancelled || error instanceof RemoteSeekSessionClosedError) {
          addLog("debug", error.message, { fromSeconds, targetSeconds });
        } else {
          addErrorLog("Remote seek failed", { fromSeconds, targetSeconds, ...errorDetails(error) });
        }
        return null;
      } finally {
        if (session) await this.giveBack(session, "jump finished");
      }
    });
  }

  /**
   * Stop whatever is running and give the device back. Every caller that changes what the C64 is
   * doing (stop, pause, another tune, another device) awaits this first.
   */
  async cancel(reason: string): Promise<void> {
    this.cancelGeneration += 1;
    const run = this.fastForward;
    if (run) {
      this.fastForward = null;
      this.stopTimers(run);
    }
    const session = this.activeSession;
    if (session) await this.giveBack(session, reason);
    await this.busy.catch(() => undefined);
  }

  get isFastForwarding() {
    return this.fastForward !== null;
  }

  private serialize<T>(work: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.cancelGeneration;
    const next = this.busy.catch(() => undefined).then(() => work(generation));
    this.busy = next;
    return next;
  }

  private assertCurrent(generation: number) {
    if (generation !== this.cancelGeneration) throw new RemoteSeekCancelled("superseded");
  }

  private async openSession() {
    const session = await RemoteSeekDeviceSession.open(this.api);
    this.activeSession = session;
    return session;
  }

  private async giveBack(session: RemoteSeekDeviceSession, reason: string) {
    if (this.activeSession === session) this.activeSession = null;
    await session.restore(reason);
  }

  private stopTimers(run: FastForwardRun) {
    if (run.rampTimer !== null) clearInterval(run.rampTimer);
    if (run.pollTimer !== null) clearInterval(run.pollTimer);
    if (run.watchdog !== null) clearTimeout(run.watchdog);
    run.rampTimer = run.pollTimer = run.watchdog = null;
  }

  private async pollFastForward(run: FastForwardRun) {
    try {
      const clock = await this.readClock(false);
      if (clock === null || this.fastForward !== run) return;
      run.onPosition(run.model.advance(clock, true));
    } catch (error) {
      addLog("warn", "Remote fast forward could not read the SID player's clock", errorDetails(error));
    }
  }

  private readClock(fast: boolean) {
    return readClockAt(this.api, this.profile.screenAddress, fast);
  }

  /** Clock seconds per tune second while fast forwarding; measured from CIA 1 timer A for CIA-timed tunes. */
  private async resolveClockPerTuneSecond(): Promise<number> {
    if (this.clockPerTuneSecond !== null) return this.clockPerTuneSecond;
    const samples: number[] = [];
    for (let index = 0; index < TIMER_SAMPLE_COUNT; index += 1) {
      const raw = await this.api.readMemory("DC04", 2, { __c64uIntent: "user", __c64uBypassCooldown: true });
      samples.push(raw[0] | (raw[1] << 8));
    }
    const callHz = playCallRateFromTimerSamples(samples, this.profile.timing.ciaClockHz) ?? this.profile.timing.frameHz;
    this.clockPerTuneSecond = clockSecondsPerTuneSecond(callHz, this.profile.timing);
    addLog("debug", "Remote seek measured the tune's play-call rate", {
      callHz,
      clockPerTuneSecond: this.clockPerTuneSecond,
    });
    return this.clockPerTuneSecond;
  }

  /**
   * Restart the sub tune the way the player's own keys do: minus then plus selects the same sub tune
   * again. Sent as press and release pairs: two taps in one batch lost the second key on the device.
   */
  private async restartTune(generation: number) {
    for (const key of ["minus", "plus"] as const) {
      await this.api.sendMachineInputBatch({ events: [{ kind: "keyboard", inputs: [key], transition: "press" }] });
      await sleep(KEY_HOLD_MS);
      await this.api.sendMachineInputBatch({ events: [{ kind: "keyboard", inputs: [key], transition: "release" }] });
      await sleep(KEY_GAP_MS);
    }
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      this.assertCurrent(generation);
      const clock = await this.readClock(true);
      if (clock !== null && clock <= 1) return;
      await sleep(JUMP_POLL_MIN_INTERVAL_MS);
    }
    throw new Error("The tune did not restart");
  }
}
