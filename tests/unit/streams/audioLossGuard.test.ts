/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { AUDIO_PACKETS_PER_SECOND, AudioLossGuard, DEFAULT_AUDIO_LOSS_GUARD } from "@/lib/streams/audioLossGuard";

const C = DEFAULT_AUDIO_LOSS_GUARD;
const perWindow = (fraction: number) => Math.round(AUDIO_PACKETS_PER_SECOND * (C.windowMs / 1000) * fraction);

/** Feed one window's worth of ticks at `lossFraction`, returning the cumulative lost count and the last result. */
const feedWindow = (guard: AudioLossGuard, startMs: number, lostBefore: number, lossFraction: number) => {
  const lost = lostBefore + perWindow(lossFraction);
  const result = guard.update(startMs + C.windowMs, lost, true);
  return { lost, result, ms: startMs + C.windowMs };
};

describe("AudioLossGuard", () => {
  it("trips after two consecutive windows that lose 8% or more of the audio packets", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);

    const first = feedWindow(guard, 0, 0, 0.17);
    expect(first.result).toBeNull();
    const second = feedWindow(guard, first.ms, first.lost, 0.17);
    expect(second.result).toBeCloseTo(0.17, 2);
  });

  it("does not trip while no audio arrives at all, because stopping the video cannot bring it back", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);
    let state = { lost: 0, ms: 0 };
    for (let i = 0; i < 10; i++) {
      const next = feedWindow(guard, state.ms, state.lost, 1);
      expect(next.result).toBeNull();
      state = next;
    }
  });

  it("trips on a heavy loss that still lets some audio through", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);

    const first = feedWindow(guard, 0, 0, 0.55);
    const second = feedWindow(guard, first.ms, first.lost, 0.55);
    expect(second.result).toBeCloseTo(0.55, 2);
  });

  it("does not let a window with no audio complete a run of bad windows, and counts afresh after it", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);

    const bad = feedWindow(guard, 0, 0, 0.3);
    const absent = feedWindow(guard, bad.ms, bad.lost, 1);
    const bad2 = feedWindow(guard, absent.ms, absent.lost, 0.3);
    expect(absent.result).toBeNull();
    expect(bad2.result).toBeNull();
  });

  it("does not trip on the 3% loss a healthy 5 GHz link shows while video streams", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);
    let state = { lost: 0, ms: 0 };
    for (let i = 0; i < 60; i++) {
      const next = feedWindow(guard, state.ms, state.lost, 0.03);
      expect(next.result).toBeNull();
      state = next;
    }
  });

  it("does not trip on one bad window, because one clump of lost packets is not a link that cannot carry both", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);

    const bad = feedWindow(guard, 0, 0, 0.5);
    const good = feedWindow(guard, bad.ms, bad.lost, 0.01);
    const bad2 = feedWindow(guard, good.ms, good.lost, 0.5);
    expect(bad.result).toBeNull();
    expect(good.result).toBeNull();
    expect(bad2.result).toBeNull();
  });

  it("measures nothing while audio and video are not both streaming, and starts fresh when they are", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);
    feedWindow(guard, 0, 0, 0.5);

    expect(guard.update(2500, 9999, false)).toBeNull();
    expect(guard.update(3000, 9999, true)).toBeNull();
    const next = feedWindow(guard, 3000, 9999, 0.5);
    expect(next.result).toBeNull();
  });

  it("starts a new window when the lost-packet counter goes backwards after a restart of the stream", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 500, true);

    expect(guard.update(C.windowMs, 10, true)).toBeNull();
    const after = feedWindow(guard, C.windowMs, 10, 0.5);
    expect(after.result).toBeNull();
  });

  it("waits for a full window before judging, however many ticks arrive inside it", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);

    expect(guard.update(C.windowMs / 2, 1000, true)).toBeNull();
    expect(guard.update(C.windowMs - 1, 1000, true)).toBeNull();
  });

  it("can trip again after it has tripped and the video has been started again", () => {
    const guard = new AudioLossGuard();
    guard.update(0, 0, true);
    const a = feedWindow(guard, 0, 0, 0.5);
    const b = feedWindow(guard, a.ms, a.lost, 0.5);
    expect(b.result).not.toBeNull();

    guard.reset();
    guard.update(b.ms, b.lost, true);
    const c = feedWindow(guard, b.ms, b.lost, 0.5);
    const d = feedWindow(guard, c.ms, c.lost, 0.5);
    expect(c.result).toBeNull();
    expect(d.result).not.toBeNull();
  });
});
