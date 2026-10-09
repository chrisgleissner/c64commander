/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const CLOCK_WRAP_SECONDS = 100 * 60;
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
  ) {
    this.lastClock = clock;
  }

  advance(clock: number, keyHeld: boolean): number {
    const now = Date.now();
    const elapsed = Math.max(0, (now - this.lastAtMs) / 1000);
    this.lastAtMs = now;
    // The clock wraps after 99:59, which a light tune passes in a couple of seconds at 64 MHz.
    const delta = clock >= this.lastClock ? clock - this.lastClock : clock + CLOCK_WRAP_SECONDS - this.lastClock;
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

  get seconds() {
    return this.position;
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
