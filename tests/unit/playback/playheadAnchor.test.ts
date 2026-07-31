/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { PLAYHEAD_DRIFT_TOLERANCE_MS, resolvePlayheadAnchor } from "@/lib/playback/playheadAnchor";

describe("resolvePlayheadAnchor", () => {
  it("keeps the wall clock when the route has no playhead of its own", () => {
    // A tune playing on the C64: the machine reports nothing back, so wall time is the only clock.
    const result = resolvePlayheadAnchor({
      enginePositionMs: null,
      trackStartedAtMs: 1_000,
      nowMs: 31_000,
    });

    expect(result).toEqual({ elapsedMs: 30_000, trackStartedAtMs: 1_000, drifted: false, driftMs: 0, stalled: false });
  });

  it("has nothing to publish for a track that has not started", () => {
    expect(resolvePlayheadAnchor({ enginePositionMs: null, trackStartedAtMs: null, nowMs: 5_000 })).toBeNull();
  });

  it("takes the elapsed time from the engine, not from wall time", () => {
    // The wall clock says 30 s have passed. The engine has only put 12 s of audio out — the other
    // 18 s went on rendering towards a seek target. What the listener has heard is 12 s.
    const result = resolvePlayheadAnchor({
      enginePositionMs: 12_000,
      trackStartedAtMs: 1_000,
      nowMs: 31_000,
    });

    expect(result?.elapsedMs).toBe(12_000);
  });

  it("moves the anchor so everything derived from it agrees with the audio", () => {
    // The auto-advance deadline, the background auto-skip watchdog and the duration-change re-arm are
    // all computed from this anchor. Left where it was, a 4:00 tune is advanced past at 3:42.
    const result = resolvePlayheadAnchor({
      enginePositionMs: 12_000,
      trackStartedAtMs: 1_000,
      nowMs: 31_000,
    });

    expect(result?.trackStartedAtMs).toBe(19_000);
    expect(31_000 - (result?.trackStartedAtMs ?? 0)).toBe(12_000);
  });

  it("reports the drift so a correction worth pushing through can be told from jitter", () => {
    const drifted = resolvePlayheadAnchor({ enginePositionMs: 12_000, trackStartedAtMs: 1_000, nowMs: 31_000 });
    expect(drifted).toMatchObject({ drifted: true, driftMs: 18_000 });

    const steady = resolvePlayheadAnchor({
      enginePositionMs: 12_000,
      trackStartedAtMs: 19_050,
      nowMs: 31_000,
    });
    // 50 ms: under the tolerance, so the anchor still moves but the deadlines are left alone.
    expect(steady).toMatchObject({ drifted: false, driftMs: -50 });
    expect(steady?.trackStartedAtMs).toBe(19_000);
  });

  it("treats the tolerance as exclusive, so the boundary does not flap", () => {
    const at = resolvePlayheadAnchor({
      enginePositionMs: 10_000,
      trackStartedAtMs: 0,
      nowMs: 10_000 + PLAYHEAD_DRIFT_TOLERANCE_MS,
    });
    expect(at?.drifted).toBe(false);

    const past = resolvePlayheadAnchor({
      enginePositionMs: 10_000,
      trackStartedAtMs: 0,
      nowMs: 10_001 + PLAYHEAD_DRIFT_TOLERANCE_MS,
    });
    expect(past?.drifted).toBe(true);
  });

  it("anchors a first reading without calling it drift", () => {
    const result = resolvePlayheadAnchor({ enginePositionMs: 500, trackStartedAtMs: null, nowMs: 9_000 });
    expect(result).toEqual({ elapsedMs: 500, trackStartedAtMs: 8_500, drifted: false, driftMs: 0, stalled: false });
  });

  it("holds the clock still while the engine has produced no audio yet", () => {
    // The start-up buffer is filled before the first sample sounds. A clock that ran during it would
    // start the tune already behind.
    const result = resolvePlayheadAnchor({ enginePositionMs: 0, trackStartedAtMs: 1_000, nowMs: 2_200 });
    expect(result?.elapsedMs).toBe(0);
    expect(result?.trackStartedAtMs).toBe(2_200);
  });

  it("ignores a playhead that is not a usable number", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(resolvePlayheadAnchor({ enginePositionMs: bad, trackStartedAtMs: 1_000, nowMs: 31_000 })).toEqual({
        elapsedMs: 30_000,
        trackStartedAtMs: 1_000,
        drifted: false,
        driftMs: 0,
        stalled: false,
      });
    }
  });
});

/**
 * A playhead that has stopped moving.
 *
 * The auto-advance deadline is the last line of defence against a tune that has gone silent and will
 * never report its own end, and it only works because it runs down in wall time. Re-deriving it from
 * a frozen playhead pushes it into the future for ever — so the anchor that keeps the clock honest
 * would, unattended, remove the very safety net that covers the clock being honest about a stall.
 *
 * Observed on a Pixel 4: a tune seeked into ran to the end of its audio, stopped, and sat there for
 * as long as it was watched, because every tick pushed the deadline out again.
 */
describe("a stalled playhead", () => {
  it("is reported when the playhead has not moved since the last tick", () => {
    const result = resolvePlayheadAnchor({
      enginePositionMs: 89_000,
      trackStartedAtMs: 0,
      nowMs: 120_000,
      previousElapsedMs: 89_000,
    });

    expect(result?.stalled).toBe(true);
  });

  it("is not reported while the playhead is advancing", () => {
    const result = resolvePlayheadAnchor({
      enginePositionMs: 90_000,
      trackStartedAtMs: 0,
      nowMs: 120_000,
      previousElapsedMs: 89_000,
    });

    expect(result?.stalled).toBe(false);
  });

  it("is not reported while a seek is waiting for the renderer", () => {
    // That wait freezes the playhead for tens of seconds on purpose, is bounded by the render it is
    // waiting on, and is shown on screen. Letting the deadline run down through it would advance the
    // playlist past a tune the listener is still waiting to hear.
    const result = resolvePlayheadAnchor({
      enginePositionMs: 180_000,
      trackStartedAtMs: 0,
      nowMs: 300_000,
      previousElapsedMs: 180_000,
      awaitingSeek: true,
    });

    expect(result?.stalled).toBe(false);
  });

  it("is not reported while the start-up buffer is still filling", () => {
    // Every track begins with a playhead sitting at zero while the buffer fills. The second tick has
    // a previous reading of zero and a playhead of zero, which is not a stall — and reporting one
    // withheld the single deadline update that tick was entitled to.
    const result = resolvePlayheadAnchor({
      enginePositionMs: 0,
      trackStartedAtMs: 1_000,
      nowMs: 3_000,
      previousElapsedMs: 0,
    });

    expect(result?.stalled).toBe(false);
  });

  it("is not reported on the first tick of a track, which has nothing to compare against", () => {
    const result = resolvePlayheadAnchor({ enginePositionMs: 0, trackStartedAtMs: null, nowMs: 1_000 });
    expect(result?.stalled).toBe(false);
  });

  it("counts a playhead that went backwards as stalled too", () => {
    // Nothing legitimate moves it backwards without a seek, and treating it as progress would keep
    // pushing the deadline out.
    const result = resolvePlayheadAnchor({
      enginePositionMs: 80_000,
      trackStartedAtMs: 0,
      nowMs: 120_000,
      previousElapsedMs: 89_000,
    });

    expect(result?.stalled).toBe(true);
  });
});
