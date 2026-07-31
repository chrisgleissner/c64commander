/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which clock the transport shows.
 *
 * The Play page runs the elapsed time off a wall clock: the instant the track started is recorded,
 * and elapsed is `now - that`. For a tune playing on the C64 that is the only clock available — the
 * machine plays the SID itself and reports nothing back — so it stays.
 *
 * For a tune playing on the device it is the wrong clock, and wrong in a way that only ever gets
 * worse. Wall time passes at one second per second no matter what the renderer is doing; the audio
 * only advances when samples actually reach the speaker. Every wait between the two is a permanent
 * offset, because nothing re-converges them:
 *
 * - A seek past what is rendered holds playback while the renderer catches up, which is tens of
 *   seconds on a Pixel 4 for a target deep into a tune. The wall clock spends all of it.
 * - The start-up buffer is deliberately filled before the first sample sounds.
 * - An underrun is silence the wall clock counts as played.
 *
 * The visible result is everything the listener reported: the timer disagreeing with the audio, the
 * solid part of the progress bar disagreeing with both, and the tune reaching its full duration —
 * and being auto-advanced past — while it is still playing.
 *
 * So on that route the engine's playhead is the clock, and the wall-clock anchor is corrected to
 * match it on every tick. Anchoring rather than simply displaying the playhead matters because the
 * anchor is what every derived deadline is computed from: the auto-advance guard, the background
 * auto-skip watchdog, and the duration-change re-arm all read `trackStartedAt`. Correcting the one
 * anchor keeps all of them right, instead of each needing its own correction.
 */

/**
 * Drift worth re-deriving the auto-advance deadline for.
 *
 * The anchor itself is corrected on every tick — it is one assignment. Moving the deadline is not
 * free: it is mirrored to the native background watchdog across the Capacitor bridge, so doing it
 * once a second for jitter of a few milliseconds would be constant traffic for no change in
 * behaviour. A quarter of a second is well below anything a listener can see on a clock that
 * displays whole seconds, and well under the smallest wait that actually matters.
 */
export const PLAYHEAD_DRIFT_TOLERANCE_MS = 250;

export type PlayheadAnchorInput = {
  /**
   * Where the engine's own playhead stands, in milliseconds.
   *
   * Null when the current track is not playing on this device, which is the signal to leave the wall
   * clock alone rather than to assume a position of zero.
   */
  enginePositionMs: number | null;
  /** The instant the track is currently anchored to, or null when it has never been anchored. */
  trackStartedAtMs: number | null;
  /** Now, in wall-clock milliseconds. */
  nowMs: number;
  /**
   * What this returned as `elapsedMs` on the previous tick, or null on the first.
   *
   * Used only to tell a playhead that is moving from one that has stopped.
   */
  previousElapsedMs?: number | null;
  /**
   * True while a seek is waiting for the renderer.
   *
   * That wait legitimately freezes the playhead for tens of seconds and is shown on screen, so it
   * must not be mistaken for the engine having died.
   */
  awaitingSeek?: boolean;
  toleranceMs?: number;
};

export type PlayheadAnchorResult = {
  /** The elapsed time to publish. */
  elapsedMs: number;
  /** The anchor to store, so everything derived from it agrees with the audio. */
  trackStartedAtMs: number;
  /**
   * True when the correction was large enough to be worth pushing through to the deadlines derived
   * from the anchor. See {@link PLAYHEAD_DRIFT_TOLERANCE_MS}.
   */
  drifted: boolean;
  /** How far the wall clock had run from the audio, in milliseconds; 0 on the first anchor. */
  driftMs: number;
  /**
   * The playhead has stopped moving for a reason nobody asked for.
   *
   * The auto-advance deadline is the last line of defence against a tune that has gone silent and
   * will never report its own end, and it only works because it runs down in wall time. Re-deriving
   * it from a frozen playhead pushes it into the future for ever, which turns the safety net into
   * the thing that removes the safety net — a stalled tune would sit there indefinitely instead of
   * being advanced past. So when this is true the caller must leave the deadline alone and let it
   * expire.
   *
   * A seek waiting for the renderer freezes the playhead too, and that one IS asked for, is bounded
   * by the render it is waiting on, and is on screen — so it does not count as stalled.
   */
  stalled: boolean;
};

/**
 * Work out what the transport clock should say, and what to anchor it to.
 *
 * Returns null when there is nothing to publish: no engine playhead and no existing anchor, which is
 * a track that has not started.
 */
export const resolvePlayheadAnchor = (input: PlayheadAnchorInput): PlayheadAnchorResult | null => {
  const { enginePositionMs, trackStartedAtMs, nowMs } = input;
  const toleranceMs = input.toleranceMs ?? PLAYHEAD_DRIFT_TOLERANCE_MS;

  const usable = enginePositionMs !== null && Number.isFinite(enginePositionMs) && enginePositionMs >= 0;
  if (!usable) {
    // The C64 route, or a device engine with nothing open. The wall clock is the only clock there
    // is, so it is left exactly as it was.
    if (trackStartedAtMs === null) return null;
    return { elapsedMs: nowMs - trackStartedAtMs, trackStartedAtMs, drifted: false, driftMs: 0, stalled: false };
  }

  const playheadMs = enginePositionMs as number;
  const driftMs = trackStartedAtMs === null ? 0 : nowMs - trackStartedAtMs - playheadMs;
  const previous = input.previousElapsedMs;
  // Strictly "has not moved". A playhead that is playing advances by about a second per tick, so
  // there is no need for a tolerance here and no risk of a slow tick reading as a stall.
  const frozen = typeof previous === "number" && playheadMs <= previous;
  return {
    elapsedMs: playheadMs,
    trackStartedAtMs: nowMs - playheadMs,
    drifted: Math.abs(driftMs) > toleranceMs,
    driftMs,
    stalled: frozen && !input.awaitingSeek,
  };
};
