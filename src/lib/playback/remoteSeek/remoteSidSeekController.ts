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
  SYSTEM_MODE_ITEM,
  type RemoteSeekDeviceApi,
} from "./remoteSeekDeviceGuard";
import {
  clockSecondsPerTuneSecond,
  cpuSpeedMhz,
  fastForwardRampOptions,
  machineTimingFor,
  playCallRateFromTimerSamples,
  JumpSpeedPlanner,
  RATE_WINDOW_SECONDS,
  type MachineTiming,
} from "./remoteSeekPlan";
import {
  isSidPlayerTitle,
  parseSidPlayerClock,
  SID_PLAYER_CLOCK_OFFSET,
  sidPlayerScreenAddress,
} from "./sidPlayerScreen";
import {
  isRemoteSeekSuperseded,
  RemoteSeekCancelled,
  remoteSeekErrorDetails as errorDetails,
} from "./remoteSeekErrors";
import { PositionModel } from "./remoteSeekPositionModel";

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

/**
 * Where a seek landed and when. The device is given back after landing, which takes a few config
 * writes; the tune plays on meanwhile, so the caller adds the time since `atMs`.
 */
export type RemoteSeekLanding = {
  seconds: number;
  atMs: number;
  /** False when the operation was cancelled or failed part way; the position is still where it got to. */
  completed: boolean;
};

/**
 * Where the tune is now, asked for when an operation actually starts rather than when it was
 * requested: an operation queued behind another must start from where that one left the tune.
 */
export type RemoteSeekOrigin = () => number;

/** Ramp step while Next is held, and how often the clock is read for the elapsed time display. */
export const FAST_FORWARD_RAMP_INTERVAL_MS = 1000;
export const FAST_FORWARD_POLL_INTERVAL_MS = 250;
/** A hold longer than this ends by itself: no tune needs it, and a stuck gesture must not run on. */
export const FAST_FORWARD_MAX_HOLD_MS = 120_000;
/** A jump that has not landed by now is abandoned and the device given back. */
export const JUMP_TIMEOUT_MS = 30_000;
/** The fastest the clock is read during a jump; each read is a short REST round trip. */
const JUMP_POLL_MIN_INTERVAL_MS = 30;
const INITIAL_READ_PERIOD_SECONDS = 0.06;
/** The clock shows whole seconds, so a rate is only trusted over a few of them. */
const RATE_WINDOW_MIN_CLOCK_SECONDS = 4;
/** Within this many reads of the target at the last speed, the key is released on a timer. */
const FINAL_APPROACH_READS = 1.5;
/** The clock shows whole seconds, so the tune is on average half a second past what it shows. */
const CLOCK_ROUNDING_SECONDS = 0.5;
const KEY_HOLD_MS = 60;
/**
 * A released key takes a frame or two to stop the fast forward. A light tune passes several clock
 * seconds in that time at 64 MHz, so the clock is read again only once it has.
 */
const KEY_SETTLE_MS = 80;
const KEY_GAP_MS = 50;
const RESTART_TIMEOUT_MS = 3000;
const SCREEN_PROBE_ATTEMPTS = 8;
const SCREEN_PROBE_INTERVAL_MS = 400;
const TIMER_SAMPLE_COUNT = 40;

const hex = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

type FastForwardRun = {
  session: RemoteSeekDeviceSession;
  polling: boolean;
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
  private pendingOperations = 0;

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
  beginFastForward(origin: RemoteSeekOrigin, onPosition: RemoteSeekPositionListener): Promise<void> {
    return this.serialize(async (generation) => {
      if (this.fastForward) return;
      this.assertCurrent(generation);
      const ratio = await this.resolveClockPerTuneSecond();
      this.assertCurrent(generation);
      const session = await this.openSession();
      try {
        this.assertCurrent(generation);
        const clock = await this.readClock(false);
        if (clock === null) throw new Error("The SID player's clock is not on screen");
        const fromSeconds = origin();
        const run: FastForwardRun = {
          session,
          polling: false,
          model: new PositionModel(fromSeconds, clock, ratio),
          rampTimer: null,
          pollTimer: null,
          watchdog: null,
          speedWrites: Promise.resolve(),
          onPosition,
        };
        this.fastForward = run;
        await session.pressKey();
        // A cancel while the press was on the wire has already given the device back; no timers then.
        this.assertCurrent(generation);
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
        if (this.fastForward?.session === session) this.fastForward = null;
        await this.giveBack(session, "fast forward failed to start");
        throw error;
      }
    });
  }

  /** Release Next: stop, give the device back, and return where it landed (null if unknown). */
  endFastForward(reason = "released"): Promise<RemoteSeekLanding | null> {
    return this.serialize(async () => {
      const run = this.fastForward;
      if (!run) return null;
      this.fastForward = null;
      this.stopTimers(run);
      let landed = false;
      try {
        await run.session.releaseKey();
        await this.settle(run.model, false);
        landed = true;
      } catch (error) {
        addLog("warn", "Remote fast forward could not read where it stopped", errorDetails(error));
      }
      let landing = { seconds: run.model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: true };
      await run.speedWrites;
      await this.giveBack(run.session, reason);
      if (!landed) {
        // The key may have stayed down until the restore released it; only a read after that says where.
        await this.settle(run.model, true).catch((error) =>
          addLog("warn", "Remote fast forward could not read where the restore left it", errorDetails(error)),
        );
        landing = { seconds: run.model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: true };
      }
      addLog("debug", "Remote fast forward ended", { reason, positionSeconds: landing.seconds });
      return landing;
    });
  }

  /**
   * Land on `targetSeconds`: restart first when it lies behind `fromSeconds`, then fast forward in
   * speed tiers and release the key when the clock reaches the target. Returns the position landed
   * on, or null when the jump was cancelled or failed (the device is given back either way).
   */
  jumpTo(
    origin: RemoteSeekOrigin,
    targetSeconds: number,
    onPosition?: RemoteSeekPositionListener,
  ): Promise<RemoteSeekLanding | null> {
    return this.serialize(async (generation) => {
      const target = Math.max(0, targetSeconds);
      const fromSeconds = origin();
      if (target < fromSeconds && !this.canRewind) {
        addLog("debug", "Remote seek: jumping back needs CPU Speed; ignored", { fromSeconds, targetSeconds });
        return null;
      }
      const startedAt = Date.now();
      let session: RemoteSeekDeviceSession | null = null;
      // Where the tune is known to be once anything has moved it, so a failed jump still lands the display.
      let model: PositionModel | null = null;
      try {
        this.assertCurrent(generation);
        const ratio = await this.resolveClockPerTuneSecond();
        this.assertCurrent(generation);
        session = await this.openSession();
        this.assertCurrent(generation);
        const restart = target < origin();
        if (restart) {
          model = new PositionModel(0, 0, ratio);
          await this.restartTune(session, generation);
        }
        const startClock = await this.readClock(true);
        if (startClock === null) throw new Error("The SID player's clock is not on screen");
        // Asked again now: the tune played on while the rate was measured and the session opened.
        model = new PositionModel(restart ? 0 : origin(), startClock, ratio);
        const planner = new JumpSpeedPlanner(this.profile.cpuSpeedOptions, session.originalCpuSpeed);
        let speed = session.originalCpuSpeed;
        let held = false;
        // The read after a release still covers fast forward up to the moment the key came up.
        let fastSinceLastRead = false;
        let rateWindow: { atMs: number; clock: number } | null = null;
        let readPeriodSeconds = INITIAL_READ_PERIOD_SECONDS;
        let lastReadAt = 0;
        while (model.seconds < target) {
          this.assertCurrent(generation);
          if (Date.now() - startedAt > JUMP_TIMEOUT_MS)
            throw new Error(`Jump did not land within ${JUMP_TIMEOUT_MS} ms`);
          const wait = JUMP_POLL_MIN_INTERVAL_MS - (Date.now() - lastReadAt);
          if (wait > 0) await sleep(wait);
          const readStartedAt = Date.now();
          const clock = await this.readClock(true);
          const readAt = Date.now();
          // The poll cadence plus this read's round trip; waits for a CPU Speed write are not part of it.
          const period = (JUMP_POLL_MIN_INTERVAL_MS + readAt - readStartedAt) / 1000;
          readPeriodSeconds = 0.7 * readPeriodSeconds + 0.3 * period;
          lastReadAt = readAt;
          if (clock === null) continue;
          const position = model.advance(clock, held || fastSinceLastRead);
          fastSinceLastRead = held;
          onPosition?.(Math.min(position, target));
          if (position >= target) break;
          if (held && !rateWindow) rateWindow = { atMs: readAt, clock };
          else if (held && rateWindow) {
            const seconds = (readAt - rateWindow.atMs) / 1000;
            if (seconds >= RATE_WINDOW_SECONDS && clock - rateWindow.clock >= RATE_WINDOW_MIN_CLOCK_SECONDS) {
              planner.record(speed, (clock - rateWindow.clock) / seconds);
            }
          }
          const remainingClock = (target - position) * ratio;
          const baseRate = speed === planner.finalOption ? planner.measuredRate(speed) : null;
          if (held && baseRate !== null && remainingClock < baseRate * readPeriodSeconds * FINAL_APPROACH_READS) {
            // The next read would land past the target, so release on a timer instead: half a read
            // period early, which is about when the release request reaches the device.
            await sleep(Math.max(0, (remainingClock / baseRate - readPeriodSeconds / 2) * 1000));
            await session.releaseKey();
            held = false;
            await this.settle(model, true);
            break;
          }
          const wanted = planner.choose(remainingClock, readPeriodSeconds);
          if (wanted !== speed) {
            // Key up before the speed changes: the write may wait out the config write interval,
            // and with the key up the tune plays on at normal speed instead of racing past the target.
            if (held) {
              await session.releaseKey();
              held = false;
              // Settle what ran fast before the write, which may wait with the tune at normal speed.
              await this.settle(model, true);
              fastSinceLastRead = false;
            }
            await session.setCpuSpeed(wanted);
            speed = wanted;
            rateWindow = null;
            continue;
          }
          if (!held) {
            // The rate window opens at the next read, the first that is sure to see the key held.
            await session.pressKey();
            held = true;
          }
        }
        if (held) {
          await session.releaseKey();
          await this.settle(model, true);
        }
        addLog("debug", "Remote seek landed", {
          fromSeconds,
          targetSeconds: target,
          landedSeconds: model.seconds,
          tookMs: Date.now() - startedAt,
        });
        return { seconds: model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: true };
      } catch (error) {
        if (isRemoteSeekSuperseded(error)) {
          addLog("debug", error.message, { fromSeconds, targetSeconds });
        } else {
          addErrorLog("Remote seek failed", { fromSeconds, targetSeconds, ...errorDetails(error) });
        }
        if (session) await this.giveBack(session, "jump stopped");
        if (!model) return null;
        if (session && this.api.currentDeviceKey() !== session.deviceKey) {
          return { seconds: model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: false };
        }
        // The restore has released the key, so one read now says where the tune really got to.
        await this.settle(model, true).catch((settleError) =>
          addLog("warn", "Remote seek could not read where a stopped jump left the tune", errorDetails(settleError)),
        );
        return { seconds: model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: false };
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
    await this.busy.catch((error) =>
      addLog("warn", "Remote seek operation ended with an error while being cancelled", {
        reason,
        ...errorDetails(error),
      }),
    );
  }

  get isFastForwarding() {
    return this.fastForward !== null;
  }

  /** True while anything is queued, running or holding the device. */
  get isBusy() {
    return this.pendingOperations > 0 || this.fastForward !== null || this.activeSession !== null;
  }

  private serialize<T>(work: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.cancelGeneration;
    this.pendingOperations += 1;
    // The previous operation's caller already received and logged its failure; this one only waits for it.
    const next = this.busy
      .then(
        () => undefined,
        (error) => addLog("debug", "Remote seek: queued after an operation that failed", errorDetails(error)),
      )
      .then(() => work(generation))
      .finally(() => {
        this.pendingOperations -= 1;
      });
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
    // Reads that overlap can return out of order, which would count clock seconds twice.
    if (run.polling) return;
    run.polling = true;
    try {
      const clock = await this.readClock(false);
      if (clock === null || this.fastForward !== run) return;
      run.onPosition(run.model.advance(clock, true));
    } catch (error) {
      addLog("warn", "Remote fast forward could not read the SID player's clock", errorDetails(error));
    } finally {
      run.polling = false;
    }
  }

  /** Read the clock once the key is surely up, crediting what ran since the last read to the fast forward. */
  private async settle(model: PositionModel, fast: boolean) {
    await sleep(KEY_SETTLE_MS);
    const clock = await this.readClock(fast);
    if (clock !== null) model.advance(clock, true);
  }

  private readClock(fast: boolean) {
    return readClockAt(this.api, this.profile.screenAddress, fast);
  }

  /** Clock seconds per tune second while fast forwarding; measured from CIA 1 timer A for CIA-timed tunes. */
  private async resolveClockPerTuneSecond(): Promise<number> {
    if (this.clockPerTuneSecond !== null) return this.clockPerTuneSecond;
    const samples: number[] = [];
    for (let index = 0; index < TIMER_SAMPLE_COUNT; index += 1) {
      // Uneven gaps: reads that happen to repeat at the timer's own period all land at the same
      // count, and their largest value then falls well short of the latch (12% in the soak test).
      if (index > 0) await sleep((index * 7) % 13);
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
  private async restartTune(session: RemoteSeekDeviceSession, generation: number) {
    for (const key of ["minus", "plus"] as const) {
      this.assertCurrent(generation);
      await session.tapKey(key, KEY_HOLD_MS);
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
