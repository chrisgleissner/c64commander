/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { RemoteSeekDeviceApi, RemoteSeekDeviceSession } from "./remoteSeekDeviceGuard";
import { clockSecondsPerTuneSecond, playCallRateFromTimerSamples } from "./remoteSeekPlan";
import type { PositionModel } from "./remoteSeekPositionModel";
import type { RemoteSeekOrigin } from "./remoteSidSeekController";
import type { RemoteTuneSeekProfile } from "./remoteTuneSeekProbe";
import { readSidPlayerClock } from "./sidPlayerClock";
import { patchRoutineDifferences, type PatchRoutine } from "./sidPlayerFastForwardPatch";
import { sidPlayerScreenAddress } from "./sidPlayerScreen";

/** The clock shows whole seconds, so the tune is on average half a second past what it shows. */
export const CLOCK_ROUNDING_SECONDS = 0.5;
const KEY_HOLD_MS = 60;
/**
 * A released key takes a frame or two to stop the fast forward. A light tune passes several clock
 * seconds in that time at 64 MHz, so the clock is read again only once it has.
 */
const KEY_SETTLE_MS = 80;
const KEY_GAP_MS = 50;
const RESTART_TIMEOUT_MS = 3000;
const RESTART_POLL_MS = 30;
/**
 * The largest of these many timer samples must come from the top 15% of the count, or a 100 Hz
 * tune measures as 120 Hz. Forty samples missed it once in a 30-minute soak on the Ultimate 64.
 */
const TIMER_SAMPLE_COUNT = 100;
/** A clock read takes tens of ms; one still out after this, with the key held, gets the key released. */
const HELD_READ_DEADLINE_MS = 250;
/** A clock read slower than this may carry a value read seconds before it arrived. */
const STALE_READ_MS = 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Over this long a clock playing at normal speed moves on one or two seconds, a stuck fast forward many. */
const HEALTH_WINDOW_MS = 1200;

/**
 * How the SID player is after a seek through its patched code. `unknown`: the player is no longer on
 * screen or the tune started again, so nothing about it can be judged.
 */
export type PatchedPlayerHealth = "working" | "code changed" | "clock not at normal speed" | "unknown";

/** What a seek reads from and does to the SID player on the C64, apart from borrowing its settings. */
export class SeekMachine {
  constructor(
    private readonly api: RemoteSeekDeviceApi,
    private readonly profile: RemoteTuneSeekProfile,
  ) {}

  /**
   * True when the player's clock is the tune's position: a tune called once a frame on its own
   * machine. A multi-speed tune's clock runs ahead of its music while fast forwarding.
   */
  get clockIsPosition() {
    return this.profile.headerPlayCallHz !== null && this.profile.headerPlayCallHz === this.profile.timing.frameHz;
  }

  /**
   * Where the tune is now. For a tune whose clock is its position, the reading of the clock nearest to
   * what the page shows, so a page that fell behind cannot make a seek count from the wrong place;
   * otherwise the page's own figure.
   */
  positionAt(origin: RemoteSeekOrigin, clock: number): number {
    const shown = origin();
    const wrap = this.profile.clock.wrapSeconds;
    if (!this.clockIsPosition) return shown;
    const second = Number.isFinite(wrap) ? clock + wrap * Math.round((shown - clock) / wrap) : clock;
    // The page knows the fraction of the second the clock shows; it is only wrong when off that second.
    return shown >= second && shown < second + 1 ? shown : second + CLOCK_ROUNDING_SECONDS;
  }

  /**
   * The clock, read twice: a read that caught the player rewriting its digits shows the minutes one
   * low, never high, so the higher of two reads is the clock. Null when neither shows it.
   */
  async readClockTwice(): Promise<number | null> {
    const first = await this.readClock(true);
    const second = await this.readClock(true);
    return first === null ? second : second === null ? first : Math.max(first, second);
  }

  /** The VIC still shows the screen the player's clock was found on. */
  async showsPlayerScreen(): Promise<boolean> {
    const [dd00] = await this.api.readMemory("DD00", 1, { __c64uIntent: "user", __c64uBypassCooldown: true });
    const [d018] = await this.api.readMemory("D018", 1, { __c64uIntent: "user", __c64uBypassCooldown: true });
    return sidPlayerScreenAddress(dd00, d018) === this.profile.clock.screenAddress;
  }

  async playerOnScreen(): Promise<boolean> {
    if (!(await this.showsPlayerScreen())) return false;
    // One blank read can be a passing frame; two in a row are a screen without the player's clock.
    return (await this.readClock(true)) !== null || (await this.readClock(true)) !== null;
  }

  /** After a seek through the patch: the routine is byte for byte as found, and the clock plays at normal speed. */
  async patchedPlayerHealth(patch: { ldyOperandAddress: number; routine: PatchRoutine }): Promise<PatchedPlayerHealth> {
    if (!(await this.showsPlayerScreen())) return "unknown";
    if ((await patchRoutineDifferences(this.api.readMemory, patch)).length > 0) return "code changed";
    const startedAt = Date.now();
    const first = await this.readClockTwice();
    await sleep(HEALTH_WINDOW_MS);
    const second = await this.readClockTwice();
    // A read the firmware answered seconds late says nothing about the speed the clock runs at.
    if (Date.now() - startedAt > HEALTH_WINDOW_MS + STALE_READ_MS) return "unknown";
    if (first === null || second === null) return "clock not at normal speed";
    const moved = second - first;
    // Back to the start: another tune or a restart, which is not the seek's doing.
    if (moved < 0 && first + 3 < this.profile.clock.wrapSeconds) return "unknown";
    const sinceFirst = moved < 0 ? moved + this.profile.clock.wrapSeconds : moved;
    return sinceFirst >= 1 && sinceFirst <= 3 ? "working" : "clock not at normal speed";
  }

  /** Read the clock once the key is surely up, crediting what ran since the last read to the fast forward. */
  async settle(model: PositionModel, fast: boolean) {
    await sleep(KEY_SETTLE_MS);
    const clock = await this.readClockFor(model, fast);
    if (clock !== null) model.advance(clock, true);
  }

  /**
   * The player rewrites its clock digits ones first, so a read in the middle of that shows the
   * minutes a minute behind. A read that steps back is therefore read again: only a second one that
   * agrees is the clock wrapping at 99:59.
   */
  async readClockFor(model: PositionModel, fast: boolean) {
    const clock = await this.readClock(fast);
    return clock !== null && model.stepsBack(clock) ? this.readClock(fast) : clock;
  }

  /**
   * The clock as it is now. The firmware sometimes answers a request 8 s late with what it read when
   * the request arrived; a reading that slow is stale, so the clock is read again.
   */
  async readClock(fast: boolean) {
    const startedAt = Date.now();
    const clock = await readSidPlayerClock(this.api.readMemory, this.profile.clock, fast);
    if (Date.now() - startedAt <= STALE_READ_MS) return clock;
    return readSidPlayerClock(this.api.readMemory, this.profile.clock, fast);
  }

  async measureClockPerTuneSecond(): Promise<number> {
    const samples: number[] = [];
    for (let index = 0; index < TIMER_SAMPLE_COUNT; index += 1) {
      // Uneven gaps across a whole frame: reads that repeat at the timer's period meet the same count.
      if (index > 0) await sleep((index * 7) % 20);
      const raw = await this.api.readMemory("DC04", 2, { __c64uIntent: "user", __c64uBypassCooldown: true });
      samples.push(raw[0] | (raw[1] << 8));
    }
    const callHz = playCallRateFromTimerSamples(samples, this.profile.timing) ?? this.profile.timing.frameHz;
    const clockPerTuneSecond = clockSecondsPerTuneSecond(callHz, this.profile.timing);
    addLog("debug", "Remote seek measured the tune's play-call rate", { callHz, clockPerTuneSecond });
    return clockPerTuneSecond;
  }

  /**
   * Restart the sub tune the way the player's own keys do: minus then plus selects the same sub tune
   * again. Sent as press and release pairs: two taps in one batch lost the second key on the device.
   */
  async restartTune(
    session: RemoteSeekDeviceSession,
    replayTune: (() => Promise<void>) | null,
    assertCurrent: () => void,
  ) {
    // No key without the player on screen: at BASIC, minus and plus would be typed. Twice, because a
    // read that catches 1:00 being written shows 0:00.
    const before = await this.readClockTwice();
    if (before === null) throw new Error("The SID player's clock is not on screen; no restart keys sent");
    // Within its first second the tune is already at the start, and a restart could not be seen.
    if (before === 0) return;
    // A clock that already shows 0:01 has to drop to 0:00 before the restart counts as done.
    const restartedBelow = before <= 1 ? 1 : 2;
    if (this.profile.restart === "replay") {
      assertCurrent();
      await (replayTune as () => Promise<void>)();
    } else {
      for (const key of ["minus", "plus"] as const) {
        assertCurrent();
        await session.tapKey(key, KEY_HOLD_MS);
        await sleep(KEY_GAP_MS);
      }
    }
    const keysSentAt = Date.now();
    let deadline = keysSentAt + RESTART_TIMEOUT_MS;
    // Twice in a row: a single read can catch the clock mid-update with its minutes a minute behind.
    // A restarted clock shows about the time since the keys, which a stalled read has let grow.
    let restartedReads = 0;
    while (Date.now() < deadline) {
      assertCurrent();
      const readStartedAt = Date.now();
      const clock = await this.readClock(true);
      const readMs = Date.now() - readStartedAt;
      if (readMs > STALE_READ_MS) deadline += readMs;
      const sinceKeys = Math.ceil((Date.now() - keysSentAt) / 1000) + 2;
      const restarted = clock !== null && clock < before && clock < Math.max(restartedBelow, sinceKeys);
      restartedReads = restarted ? restartedReads + 1 : 0;
      if (restartedReads === 2) return;
      await sleep(RESTART_POLL_MS);
    }
    throw new Error("The tune did not restart");
  }

  /**
   * Read the clock during a jump. With the key held, a read the device has not answered within
   * HELD_READ_DEADLINE_MS releases the key first: the firmware sometimes answers 8 s late, and the
   * tune would race on past its target meanwhile. Other requests are answered during such a stall.
   */
  async readClockHeld(model: PositionModel, heldBy: RemoteSeekDeviceSession | null) {
    let release: Promise<void> | null = null;
    const timer = heldBy
      ? setTimeout(() => {
          release = heldBy.releaseKey();
        }, HELD_READ_DEADLINE_MS)
      : null;
    try {
      return { clock: await this.readClockFor(model, true), released: release !== null };
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (release) await release;
    }
  }
}
