/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadC64SeekMute, type C64SeekMute } from "@/lib/config/appSettings";
import { addErrorLog, addLog } from "@/lib/logging";
import { RemoteSeekDeviceSession, type RemoteSeekDeviceApi } from "./remoteSeekDeviceGuard";
import {
  clockSecondsPerTuneSecond,
  cpuSpeedMhz,
  fastForwardRampOptions,
  JumpSpeedPlanner,
  RATE_WINDOW_SECONDS,
} from "./remoteSeekPlan";
import { measureClockTick, type ClockTick } from "./sidPlayerClock";
import type { RemoteTuneSeekProfile } from "./remoteTuneSeekProbe";
import {
  isRemoteSeekSuperseded,
  RemoteSeekCancelled,
  remoteSeekErrorDetails as errorDetails,
} from "./remoteSeekErrors";
import { JumpProgressWatch, PositionModel } from "./remoteSeekPositionModel";
import { CLOCK_ROUNDING_SECONDS, SeekMachine } from "./remoteSeekMachine";

/**
 * Fast forward, rewind and jumps for a tune the C64 plays itself.
 *
 * Holding the left-arrow key makes the Ultimate's SID player call the tune's play routine back to
 * back, and CPU Speed sets how fast that loop runs. A rewind restarts the sub tune with the player's
 * own keys and fast forwards to the target. Every operation borrows the key and CPU Speed through a
 * RemoteSeekDeviceSession, which records the original values first and gives them back however the
 * operation ends.
 */

export type RemoteSeekApi = RemoteSeekDeviceApi;

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
/** The fastest the clock is read during a jump; each read is a short REST round trip. */
const JUMP_POLL_MIN_INTERVAL_MS = 30;
/** A clock read takes tens of ms; one still out after this, with the key held, gets the key released. */
const HELD_READ_DEADLINE_MS = 250;
const INITIAL_READ_PERIOD_SECONDS = 0.06;
/** The clock shows whole seconds, so a rate is only trusted over a few of them. */
const RATE_WINDOW_MIN_CLOCK_SECONDS = 4;
/** Within this many reads of the target at the last speed, the key is released on a timer. */
const FINAL_APPROACH_READS = 1.5;
/** A target this close is reached by playing on, unless the fast forward rate is already known. */
const NORMAL_PLAY_GAP_SECONDS = 4;
const NORMAL_PLAY_READ_INTERVAL_MS = 250;
/** A held fast forward ends after this many clock reads in a row that find no clock. */
const PLAYER_GONE_READS = 2;
/**
 * The fastest the player can possibly fast forward, in clock seconds a second per MHz: its loop
 * spends at least about 100 cycles on each play call, so 1 MHz runs at most 10000 calls a second.
 */
const FASTEST_FAST_FORWARD_PER_MHZ = 200;
const PULSE_MARGIN_SECONDS = 0.05;
/** A pulse aims at this share of what is left, so a rate slightly underestimated still stops short. */
const PULSE_SHARE = 0.8;
const MIN_PULSE_MS = 20;
/** Long enough to cover distance at the slowest speed, short enough to stay quick to cancel. */
const MAX_PULSE_MS = 2000;
/** The clock shows whole seconds, so a pulse shorter than this many of them cannot be measured. */
const MIN_PULSE_CLOCK_SECONDS = 1.5;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type FastForwardRun = {
  session: RemoteSeekDeviceSession;
  polling: boolean;
  /** Clock reads in a row that found no clock: the player may have left the screen. */
  missedReads: number;
  model: PositionModel;
  rampTimer: ReturnType<typeof setInterval> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  speedWrites: Promise<void>;
  onPosition: RemoteSeekPositionListener;
};

export class RemoteSidSeekController {
  private clockPerTuneSecond: Promise<number> | null;
  private fastForward: FastForwardRun | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  private cancelGeneration = 0;
  private activeSession: RemoteSeekDeviceSession | null = null;
  private pendingOperations = 0;
  private gestureArrived = false;
  private readonly machine: SeekMachine;
  /**
   * Told where a seek landed as soon as that is known, before the device's settings are given back:
   * the restore is a few config writes, and the page need not show the target while they run.
   */
  landingListener: ((landing: RemoteSeekLanding, kind: "jump" | "fast forward") => void) | null = null;

  /**
   * `replayTune` starts the tune afresh the way the Play page started it; a profile that restarts
   * by replaying cannot rewind without it.
   */
  constructor(
    private readonly api: RemoteSeekApi,
    readonly profile: RemoteTuneSeekProfile,
    private readonly replayTune: (() => Promise<void>) | null = null,
    /** Read when each seek starts, so a change in Settings applies to the next one. */
    private readonly seekMute: () => C64SeekMute = loadC64SeekMute,
  ) {
    this.machine = new SeekMachine(api, profile);
    this.clockPerTuneSecond =
      profile.headerPlayCallHz === null
        ? null
        : Promise.resolve(clockSecondsPerTuneSecond(profile.headerPlayCallHz, profile.timing));
  }

  /** Measure what a seek needs before the first gesture, so the gesture does not wait for it. */
  async prepare(): Promise<void> {
    await this.resolveClockPerTuneSecond();
  }

  /**
   * True when the player's clock is the tune's position: a tune called once a frame on its own
   * machine. A multi-speed tune's clock runs ahead of its music while fast forwarding.
   */
  get clockIsPosition() {
    return this.machine.clockIsPosition;
  }

  /**
   * The moment the player's clock last ticked, read when nothing else runs, so the page can show the
   * C64's own second at the C64's own moment. Null when the clock is not the position, or does not tick.
   */
  clockTick(): Promise<ClockTick | null> {
    // Never ahead of a gesture: a tick measured during a hold never sees a single step and holds the
    // release up for its whole limit, and one running when a jump arrives stops at its next read.
    if (!this.clockIsPosition || this.fastForward !== null) return Promise.resolve(null);
    this.gestureArrived = false;
    return this.serialize((generation) =>
      measureClockTick(
        () => this.machine.readClock(true),
        () => generation === this.cancelGeneration && !this.gestureArrived,
      ),
    );
  }

  /**
   * Read the clock during a jump. With the key held, a read the device has not answered within
   * HELD_READ_DEADLINE_MS releases the key first: the firmware sometimes answers 8 s late, and the
   * tune would race on past its target meanwhile. Other requests are answered during such a stall.
   */
  private async readClockHeld(model: PositionModel, heldBy: RemoteSeekDeviceSession | null) {
    let release: Promise<void> | null = null;
    const timer = heldBy
      ? setTimeout(() => {
          release = heldBy.releaseKey();
        }, HELD_READ_DEADLINE_MS)
      : null;
    try {
      return { clock: await this.machine.readClockFor(model, true), released: release !== null };
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (release) await release;
    }
  }

  /** Make a running clock re-sync give way to a gesture. */
  private gesture<T>(work: (generation: number) => Promise<T>): Promise<T> {
    this.gestureArrived = true;
    return this.serialize(work);
  }

  get canRewind() {
    return this.profile.restart === "keys" || this.replayTune !== null;
  }

  /** Hold Next: press the key, then raise CPU Speed one step a second. Positions arrive on `onPosition`. */
  beginFastForward(origin: RemoteSeekOrigin, onPosition: RemoteSeekPositionListener): Promise<void> {
    return this.gesture(async (generation) => {
      if (this.fastForward) return;
      this.assertCurrent(generation);
      const ratio = await this.resolveClockPerTuneSecond();
      this.assertCurrent(generation);
      const session = await this.openSession();
      session.muteWhenKeysPressed(this.seekMute() === "always");
      try {
        this.assertCurrent(generation);
        const clock = await this.machine.readClock(false);
        if (clock === null) throw new Error("The SID player's clock is not on screen");
        const fromSeconds = this.machine.positionAt(origin, clock);
        const run: FastForwardRun = {
          session,
          polling: false,
          missedReads: 0,
          model: new PositionModel(fromSeconds, clock, ratio, this.profile.clock.wrapSeconds),
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
    return this.gesture(async () => {
      const run = this.fastForward;
      if (!run) return null;
      this.fastForward = null;
      this.stopTimers(run);
      let landed = false;
      try {
        await run.session.releaseKey();
        await this.machine.settle(run.model, false);
        landed = true;
      } catch (error) {
        addLog("warn", "Remote fast forward could not read where it stopped", errorDetails(error));
      }
      let landing = { seconds: run.model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: true };
      if (landed) this.landingListener?.(landing, "fast forward");
      await run.speedWrites;
      await this.giveBack(run.session, reason);
      if (!landed) {
        // The key may have stayed down until the restore released it; only a read after that says where.
        await this.machine
          .settle(run.model, true)
          .catch((error) =>
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
    return this.gesture(async (generation) => {
      const target = Math.max(0, targetSeconds);
      const fromSeconds = origin();
      if (target < fromSeconds && !this.canRewind) {
        addLog("debug", "Remote seek: no way to restart the tune here; jump back ignored", {
          fromSeconds,
          targetSeconds,
        });
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
        let startClock = await this.machine.readClockTwice();
        if (startClock === null) throw new Error("The SID player's clock is not on screen");
        const restart = target < this.machine.positionAt(origin, startClock);
        const mute = this.seekMute();
        session.muteWhenKeysPressed(mute === "always" || (mute === "rewind" && restart));
        if (restart) {
          model = new PositionModel(0, 0, ratio, this.profile.clock.wrapSeconds);
          await this.machine.restartTune(session, this.replayTune, () => this.assertCurrent(generation));
          startClock = await this.machine.readClock(true);
          if (startClock === null) throw new Error("The SID player's clock is not on screen");
        }
        // Asked again now: the tune played on while the rate was measured and the session opened. Since a
        // restart it has only played at normal speed, so the clock is the position however late it was read.
        model = new PositionModel(
          restart ? startClock : this.machine.positionAt(origin, startClock),
          startClock,
          ratio,
          this.profile.clock.wrapSeconds,
        );
        const planner = new JumpSpeedPlanner(this.profile.cpuSpeedOptions, session.originalCpuSpeed);
        let speed = session.originalCpuSpeed;
        let held = false;
        // The read after a release still covers fast forward up to the moment the key came up.
        let fastSinceLastRead = false;
        let rateWindow: { atMs: number; clock: number } | null = null;
        let readPeriodSeconds = INITIAL_READ_PERIOD_SECONDS;
        let lastReadAt = 0;
        /** The rate the last key pulse showed, while none is measured at this speed. */
        let pulseRate: number | null = null;
        let pulsing = false;
        let smallestPulseGain = Number.POSITIVE_INFINITY;
        const progress = new JumpProgressWatch(model.seconds, ratio);
        while (model.seconds < target) {
          this.assertCurrent(generation);
          const stalled = progress.stopReason();
          if (stalled) throw new Error(stalled);
          const wait = JUMP_POLL_MIN_INTERVAL_MS - (Date.now() - lastReadAt);
          if (wait > 0) await sleep(wait);
          const readStartedAt = Date.now();
          const heldDuringRead = held;
          const read = await this.readClockHeld(model, held ? session : null);
          const clock = read.clock;
          if (read.released) {
            held = false;
            rateWindow = null;
          }
          const readAt = Date.now();
          // The poll cadence plus this read's round trip; waits for a CPU Speed write are not part of it.
          const period = (JUMP_POLL_MIN_INTERVAL_MS + readAt - readStartedAt) / 1000;
          readPeriodSeconds = 0.7 * readPeriodSeconds + 0.3 * period;
          lastReadAt = readAt;
          if (clock === null) {
            // Never hold a key while the player may not be there to take it.
            if (held) {
              await session.releaseKey();
              held = false;
            }
            continue;
          }
          const position = model.advance(clock, heldDuringRead || fastSinceLastRead);
          // A key released mid-read on a stall did not run fast for the whole read: no rate to prove.
          const ranFast = !read.released && (heldDuringRead || fastSinceLastRead);
          const stopReason = progress.observe(position, ranFast, readAt);
          if (stopReason) throw new Error(stopReason);
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
          // Until the machine's own speed is measured the planner has no bound to plan with, and one
          // read period of fast forward can pass a near target by several seconds. Such a target is
          // approached at the slowest speed in timed key pulses, each sized from the rate the last one
          // showed, and the last clock second or so, which a pulse cannot resolve, is played into.
          const fastest = FASTEST_FAST_FORWARD_PER_MHZ * (cpuSpeedMhz(speed) ?? 1);
          pulsing ||= !planner.calibrated && remainingClock < fastest * (2 * readPeriodSeconds + PULSE_MARGIN_SECONDS);
          if (pulsing) {
            if (held) {
              await session.releaseKey();
              held = false;
              await this.machine.settle(model, true);
              fastSinceLastRead = false;
              continue;
            }
            if (speed !== planner.finalOption && session.cpuSpeedOptions.length > 0) {
              await session.setCpuSpeed(planner.finalOption);
              speed = planner.finalOption;
              continue;
            }
            // A pulse carries a fixed overhead, the request latency and the key scan that notices the
            // release, so no pulse moves less than the smallest one did: closer than that, play into it.
            const playInto =
              pulseRate === null
                ? target - position <= NORMAL_PLAY_GAP_SECONDS
                : remainingClock < Math.max(MIN_PULSE_CLOCK_SECONDS, smallestPulseGain);
            if (playInto) {
              await sleep(Math.min((target - position) * 1000, NORMAL_PLAY_READ_INTERVAL_MS));
              continue;
            }
            const pulseMs = Math.min(
              MAX_PULSE_MS,
              Math.max(MIN_PULSE_MS, (remainingClock / (pulseRate ?? fastest)) * PULSE_SHARE * 1000),
            );
            const clockBefore = model.clock;
            await session.pressKey();
            await sleep(pulseMs);
            await session.releaseKey();
            await this.machine.settle(model, true);
            const gained = model.clock - clockBefore;
            // Never lowered: a short pulse can under-read the rate, and the next pulse would then overshoot.
            if (gained > 0) pulseRate = Math.max(pulseRate ?? 0, gained / (pulseMs / 1000));
            smallestPulseGain = Math.min(smallestPulseGain, gained);
            continue;
          }
          const baseRate = speed === planner.finalOption ? planner.measuredRate(speed) : null;
          if (held && baseRate !== null && remainingClock < baseRate * readPeriodSeconds * FINAL_APPROACH_READS) {
            // The next read would land past the target, so release on a timer instead: half a read
            // period early, which is about when the release request reaches the device.
            await sleep(Math.max(0, (remainingClock / baseRate - readPeriodSeconds / 2) * 1000));
            await session.releaseKey();
            held = false;
            await this.machine.settle(model, true);
            // Usually at the target now; a read the device was slow to answer can leave it short.
            fastSinceLastRead = false;
            continue;
          }
          const wanted = planner.choose(remainingClock, readPeriodSeconds);
          if (wanted !== speed) {
            // Key up before the speed changes: the write may wait out the config write interval,
            // and with the key up the tune plays on at normal speed instead of racing past the target.
            if (held) {
              await session.releaseKey();
              held = false;
              // Settle what ran fast before the write, which may wait with the tune at normal speed.
              await this.machine.settle(model, true);
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
            progress.keyDown();
          }
        }
        if (held) {
          await session.releaseKey();
          await this.machine.settle(model, true);
        }
        addLog("debug", "Remote seek landed", {
          fromSeconds,
          targetSeconds: target,
          landedSeconds: model.seconds,
          tookMs: Date.now() - startedAt,
        });
        const landing = { seconds: model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: true };
        this.landingListener?.(landing, "jump");
        return landing;
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
        await this.machine
          .settle(model, true)
          .catch((settleError) =>
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
    // The tune moved while the key was down; the page has to learn where to, or it shows the old place.
    if (run) {
      await this.machine.settle(run.model, true).then(
        () =>
          this.landingListener?.(
            { seconds: run.model.seconds + CLOCK_ROUNDING_SECONDS, atMs: Date.now(), completed: false },
            "fast forward",
          ),
        (error) =>
          addLog(
            "warn",
            "Remote seek could not read where a cancelled fast forward left the tune",
            errorDetails(error),
          ),
      );
    }
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
    const session = await RemoteSeekDeviceSession.open(this.api, {
      playerOnScreen: () => this.machine.playerOnScreen(),
      fastForward: this.profile.fastForward,
      withCpuSpeed: this.profile.cpuSpeedOptions.length > 0,
    });
    this.activeSession = session;
    return session;
  }

  /** The VIC still shows the screen the player's clock was found on, and the clock reads as a time there. */
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
      const clock = await this.machine.readClockFor(run.model, false);
      if (this.fastForward !== run) return;
      if (clock === null) {
        // The player has gone from the screen: whatever is there now would be typed into.
        run.missedReads += 1;
        if (run.missedReads >= PLAYER_GONE_READS) void this.endFastForward("the SID player left the screen");
        return;
      }
      run.missedReads = 0;
      run.onPosition(run.model.advance(clock, true));
    } catch (error) {
      addLog("warn", "Remote fast forward could not read the SID player's clock", errorDetails(error));
    } finally {
      run.polling = false;
    }
  }

  /** Clock seconds per tune second while fast forwarding; measured from CIA 1 timer A for CIA-timed tunes. */
  private resolveClockPerTuneSecond(): Promise<number> {
    this.clockPerTuneSecond ??= this.machine.measureClockPerTuneSecond().catch((error: unknown) => {
      // Measured again by the next caller rather than failing every seek of this tune.
      this.clockPerTuneSecond = null;
      throw error;
    });
    return this.clockPerTuneSecond;
  }
}
