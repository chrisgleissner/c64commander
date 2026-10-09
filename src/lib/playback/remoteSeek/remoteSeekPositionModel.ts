/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Reads with the key believed down that are further apart than this span a stalled request, during
 * which the key may have been up: the press had not arrived yet, or the release had already.
 */
export const LONG_HELD_INTERVAL_SECONDS = 1.5;
/** The fast forward rate is taken over at least this much wall time, since the clock shows whole seconds. */
const FAST_RATE_WINDOW_SECONDS = 0.25;

/**
 * Tune position while fast forwarding. The clock counts play calls as frames then, so a clock
 * second is 1 / clockPerTuneSecond tune seconds with the key down, and one tune second with it up.
 *
 * Normal play advances the clock one second per second. Between two reads far enough apart, the
 * clock seconds that the fast forward rate seen just before cannot explain are therefore counted as
 * normal play. Without a rate seen yet, the clock seconds up to the wall time between the reads are.
 */
export class PositionModel {
  private lastClock: number;
  private lastAtMs = Date.now();
  private fastClockRate: number | null = null;
  private window = { clock: 0, seconds: 0 };

  constructor(
    private position: number,
    clock: number,
    private readonly clockPerTuneSecond: number,
    /** When the clock rolls over to zero: 6000 s for the current player's "mm:ss". */
    private readonly wrapSeconds: number,
  ) {
    this.lastClock = clock;
  }

  advance(clock: number, keyHeld: boolean): number {
    const now = Date.now();
    const elapsed = Math.max(0, (now - this.lastAtMs) / 1000);
    this.lastAtMs = now;
    const delta = this.clockDelta(clock, keyHeld, elapsed);
    this.lastClock = clock;
    if (!keyHeld) {
      this.position += delta;
      return this.position;
    }
    const normal = elapsed > LONG_HELD_INTERVAL_SECONDS ? this.normalPlayWithin(delta, elapsed) : 0;
    if (elapsed <= LONG_HELD_INTERVAL_SECONDS) this.observeFastRate(delta, elapsed);
    this.position += (delta - normal) / this.clockPerTuneSecond + normal;
    return this.position;
  }

  stepsBack(clock: number) {
    return clock < this.lastClock;
  }

  get seconds() {
    return this.position;
  }

  /**
   * Clock seconds since the last read. A clock that went back rolled over at its wrap, which a light
   * tune passes in a couple of seconds at 64 MHz, or was restarted by something else, e.g. a key on
   * the C64 itself. At normal speed it can only have rolled over if it was about to.
   */
  private clockDelta(clock: number, keyHeld: boolean, elapsed: number) {
    if (clock >= this.lastClock) return clock - this.lastClock;
    const couldRollOver = keyHeld || this.lastClock + elapsed + 2 >= this.wrapSeconds;
    if (couldRollOver) return clock + this.wrapSeconds - this.lastClock;
    this.position = 0;
    return clock;
  }

  private normalPlayWithin(delta: number, elapsed: number) {
    const rate = this.fastClockRate;
    const normal = rate === null || rate <= 1 ? elapsed : (elapsed * rate - delta) / (rate - 1);
    return Math.min(Math.max(normal, 0), elapsed, delta);
  }

  private observeFastRate(delta: number, elapsed: number) {
    this.window.clock += delta;
    this.window.seconds += elapsed;
    if (this.window.seconds < FAST_RATE_WINDOW_SECONDS) return;
    this.fastClockRate = this.window.clock / this.window.seconds;
    this.window = { clock: 0, seconds: 0 };
  }
}

/** A jump that has not moved the tune on for this long has stalled; the clock or the device stopped answering. */
export const JUMP_STALL_MS = 10_000;
/** No jump runs longer, however slowly it fast forwards. */
export const JUMP_MAX_MS = 10 * 60_000;
/** Held for this long, a fast forward must have gained at least `MIN_FAST_FORWARD_GAIN` tune seconds a second. */
const FAST_FORWARD_PROOF_MS = 5000;
const MIN_FAST_FORWARD_GAIN = 1.5;

/**
 * Why a jump should stop short of its target, or null while it is getting there. A jump is not
 * bounded by a fixed time: one deep into an hour-long tune on a machine without CPU Speed takes
 * minutes, and is fine as long as it keeps moving and the key really does fast forward.
 */
export class JumpProgressWatch {
  private best: number;
  private lastProgressAt: number;
  private lastPosition: number;
  private lastAt: number;
  private heldMs = 0;
  private gainedWhileHeld = 0;

  constructor(
    position: number,
    private readonly startedAt = Date.now(),
  ) {
    this.best = this.lastPosition = position;
    this.lastProgressAt = this.lastAt = startedAt;
  }

  observe(position: number, keyHeld: boolean, now = Date.now()): string | null {
    if (keyHeld) {
      this.heldMs += now - this.lastAt;
      this.gainedWhileHeld += position - this.lastPosition;
    }
    this.lastAt = now;
    this.lastPosition = position;
    if (position >= this.best + 1) {
      this.best = position;
      this.lastProgressAt = now;
    }
    return this.stopReason(now);
  }

  stopReason(now = Date.now()): string | null {
    if (now - this.startedAt > JUMP_MAX_MS) return `Jump did not land within ${JUMP_MAX_MS} ms`;
    if (now - this.lastProgressAt > JUMP_STALL_MS) return `Jump made no progress for ${JUMP_STALL_MS} ms`;
    if (this.heldMs >= FAST_FORWARD_PROOF_MS && this.gainedWhileHeld < (this.heldMs / 1000) * MIN_FAST_FORWARD_GAIN)
      return "The SID player does not fast forward this tune";
    return null;
  }
}
