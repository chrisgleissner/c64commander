/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Live View — the input-affinity cue for follow-focus.
 *
 * When the player steers with the app's own joystick, the app knows what it asserted. The object
 * whose motion follows those assertions is the one the player is driving, and that is causal
 * evidence no amount of image analysis can produce. See `docs/plans/follow-focus/DESIGN.md` §10.
 *
 * It can only ever be a weak prior, for reasons that are not all obvious:
 *
 * - The player may be on a real joystick plugged into the C64, so the app asserts nothing at all.
 * - Sprites keep moving without input — momentum, knockback, auto-scroll, cutscenes, demo mode.
 * - Input reaches the machine over the network and then through the game's own logic, so the lag
 *   is tens to hundreds of milliseconds and varies.
 * - "Right" rotates in Asteroids, accelerates in a racer, and does nothing in a menu.
 * - In a side-scroller it anti-correlates: pressing right holds the player at the centre of the
 *   screen and scrolls the world leftwards instead.
 *
 * Three properties make the cue safe to add to a fitted scorer:
 *
 * 1. **It only ever adds.** A candidate moving against the input is not penalised, it is merely
 *    not rewarded. That is what makes the side-scrolling case harmless rather than inverted.
 * 2. **It is zero unless there is something to say.** With no assertion covering the interval the
 *    bonus is exactly zero, so a player on a real joystick gets the tracker as it was fitted.
 * 3. **It gates itself on evidence.** {@link InputAffinity.observe} watches how the object the
 *    tracker already accepted has actually responded, and the bonus is scaled by that running
 *    agreement. A game that does not answer the stick positionally drives the cue to zero by
 *    itself, with no game detection and nothing to configure.
 */

/** A direction the app asserted, in screen axes: +x right, +y DOWN, as the frame is stored. */
export interface AffinityVector {
  dx: number;
  dy: number;
}

export interface InputAffinityOptions {
  /** Assertions older than this are dropped. */
  historyMs?: number;
  /** Earliest, and latest, the machine can be expected to have answered an assertion. */
  lagMinMs?: number;
  lagMaxMs?: number;
  /** Agreement samples needed before the cue may have any weight at all. */
  minSamples?: number;
  /** Time constant of the running agreement estimate, in samples. */
  reliabilityRate?: number;
  /** Displacement slower than this says nothing about direction, so it is not sampled. */
  minSpeedPxPerSec?: number;
  /** Share of the interval that must be covered by an assertion before it is worth judging. */
  minCoverage?: number;
  /** Largest bonus the cue may add to an association score, at full reliability. */
  maxBonus?: number;
}

const DEFAULTS: Required<InputAffinityOptions> = {
  historyMs: 1500,
  lagMinMs: 30,
  lagMaxMs: 260,
  minSamples: 12,
  reliabilityRate: 0.12,
  minSpeedPxPerSec: 25,
  minCoverage: 0.35,
  maxBonus: 0.08,
};

const MAX_ENTRIES = 64;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * What the input says about an interval: a direction, and how much of the interval it covers.
 * `weight` is 0 when nothing was asserted, which is the case that has to cost nothing.
 */
export interface ExpectedMotion {
  dx: number;
  dy: number;
  weight: number;
}

const NO_EXPECTATION: ExpectedMotion = { dx: 0, dy: 0, weight: 0 };

/**
 * How well a displacement agrees with an expected direction, in `[0,1]`, where 0 means "moving
 * against it or not at all" rather than "moving the wrong way and to be punished for it".
 */
export const affinityOf = (dx: number, dy: number, expected: ExpectedMotion): number => {
  if (expected.weight <= 0) return 0;
  const length = Math.sqrt(dx * dx + dy * dy);
  const expectedLength = Math.sqrt(expected.dx * expected.dx + expected.dy * expected.dy);
  if (length <= 0 || expectedLength <= 0) return 0;
  const cos = (dx * expected.dx + dy * expected.dy) / (length * expectedLength);
  return cos <= 0 ? 0 : cos * expected.weight;
};

/**
 * A short history of asserted directions, plus a running estimate of whether this game answers
 * them positionally at all.
 *
 * Ring buffer, fixed size, no allocation per assertion; one windowed average per tracker tick
 * rather than per candidate.
 */
export class InputAffinity {
  private readonly o: Required<InputAffinityOptions>;
  private readonly times = new Float64Array(MAX_ENTRIES);
  private readonly xs = new Float64Array(MAX_ENTRIES);
  private readonly ys = new Float64Array(MAX_ENTRIES);
  private head = 0;
  private count = 0;
  private agreement = 0;
  private samples = 0;
  private readonly scratch: ExpectedMotion = { dx: 0, dy: 0, weight: 0 };

  constructor(options?: InputAffinityOptions) {
    this.o = { ...DEFAULTS, ...(options ?? {}) };
  }

  /**
   * Record what the app is asserting as of `atMs`. `(0,0)` is "nothing held", which is itself
   * information: it ends the previous assertion's coverage rather than letting it run on.
   */
  assert(dx: number, dy: number, atMs: number): void {
    // Repeating the current direction changes nothing, and the tick loop calls this every frame.
    if (this.count > 0) {
      const last = (this.head + MAX_ENTRIES - 1) % MAX_ENTRIES;
      if (this.xs[last] === dx && this.ys[last] === dy) return;
    } else if (dx === 0 && dy === 0) {
      return;
    }
    this.times[this.head] = atMs;
    this.xs[this.head] = dx;
    this.ys[this.head] = dy;
    this.head = (this.head + 1) % MAX_ENTRIES;
    if (this.count < MAX_ENTRIES) this.count += 1;
  }

  /** Forget the history and the reliability estimate — a new lock is a new question. */
  reset(): void {
    this.head = 0;
    this.count = 0;
    this.agreement = 0;
    this.samples = 0;
  }

  /** `[0,1]`: how much this game has been answering the stick, 0 until there is enough evidence. */
  get reliability(): number {
    if (this.samples < this.o.minSamples) return 0;
    return clamp01(this.agreement);
  }

  /** The most a candidate's score may gain from this cue right now. Zero disables it entirely. */
  get bonusScale(): number {
    return this.o.maxBonus * this.reliability;
  }

  /**
   * What the input predicts about motion measured over `[fromMs, toMs]`.
   *
   * Motion seen in that interval was caused by assertions one machine lag earlier, so the window
   * consulted is `[fromMs - lagMax, toMs - lagMin]`. Directions are averaged over their dwell
   * time inside it, so 200 ms of "right" followed by 20 ms of nothing reads as "mostly right".
   *
   * The returned object is reused between calls; copy it if it has to outlive the next call.
   */
  expected(fromMs: number, toMs: number): ExpectedMotion {
    const start = fromMs - this.o.lagMaxMs;
    const end = toMs - this.o.lagMinMs;
    const span = end - start;
    if (this.count === 0 || span <= 0) return NO_EXPECTATION;

    let sx = 0;
    let sy = 0;
    let held = 0;
    for (let i = 0; i < this.count; i += 1) {
      const index = (this.head + MAX_ENTRIES - this.count + i) % MAX_ENTRIES;
      const dx = this.xs[index];
      const dy = this.ys[index];
      if (dx === 0 && dy === 0) continue;
      // Each assertion stands until the next one replaces it, or until the end of the window.
      const validFrom = this.times[index];
      const nextIndex = (index + 1) % MAX_ENTRIES;
      const isLast = i === this.count - 1;
      const validTo = isLast ? end : this.times[nextIndex];
      const overlap = Math.min(validTo, end) - Math.max(validFrom, start);
      if (overlap <= 0) continue;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length <= 0) continue;
      sx += (dx / length) * overlap;
      sy += (dy / length) * overlap;
      held += overlap;
    }
    if (held <= 0) return NO_EXPECTATION;

    const coverage = clamp01(held / span);
    if (coverage < this.o.minCoverage) return NO_EXPECTATION;
    this.scratch.dx = sx;
    this.scratch.dy = sy;
    this.scratch.weight = coverage;
    return this.scratch;
  }

  /**
   * Learn from the object the tracker has already accepted: did it move the way the input asked?
   *
   * This is the self-gating step. It is fed only from accepted measurements, so what it measures
   * is the game's response and not the tracker's guesswork, and a game that answers the stick
   * with something other than position — a rotation, a menu, a scrolling world that leaves the
   * player pinned at the centre — produces no agreement and drives the bonus to zero.
   */
  observe(dx: number, dy: number, dtMs: number, expected: ExpectedMotion): void {
    if (expected.weight <= 0 || dtMs <= 0) return;
    const speed = (Math.sqrt(dx * dx + dy * dy) * 1000) / dtMs;
    if (speed < this.o.minSpeedPxPerSec) return;
    const expectedLength = Math.sqrt(expected.dx * expected.dx + expected.dy * expected.dy);
    if (expectedLength <= 0) return;
    const cos = (dx * expected.dx + dy * expected.dy) / (Math.sqrt(dx * dx + dy * dy) * expectedLength);
    this.agreement += (cos - this.agreement) * this.o.reliabilityRate;
    this.samples += 1;
  }

  /** Purge assertions that can no longer be inside any query window. */
  prune(nowMs: number): void {
    const oldest = nowMs - this.o.historyMs - this.o.lagMaxMs;
    while (this.count > 1) {
      const index = (this.head + MAX_ENTRIES - this.count) % MAX_ENTRIES;
      const nextIndex = (index + 1) % MAX_ENTRIES;
      // Keep the entry whose validity still covers `oldest`; only drop ones fully superseded.
      if (this.times[nextIndex] > oldest) break;
      this.count -= 1;
    }
  }
}

/** The eight directions a C64 joystick can assert, as a screen-axis vector. */
export const joystickVector = (held: {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
}): AffinityVector => ({
  dx: (held.right ? 1 : 0) - (held.left ? 1 : 0),
  dy: (held.down ? 1 : 0) - (held.up ? 1 : 0),
});
