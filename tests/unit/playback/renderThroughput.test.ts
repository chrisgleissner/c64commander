/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A tune that starts and then pauses half a second later sounds broken; one that starts a moment later
 * sounds like loading. So playback waits for a buffer it cannot exhaust — sized from how fast this
 * device has actually been measured to render, never a fixed delay.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRenderThroughput,
  recordRenderMeasurement,
  renderRatio,
  startupBufferMs,
  startupBufferSeconds,
} from "@/lib/playback/renderThroughput";

describe("how much to buffer before a tune starts", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetRenderThroughput();
  });

  it("waits less on a device that renders faster", () => {
    // The whole point of measuring: the wait is a consequence of the device, not a constant.
    for (let i = 0; i < 40; i += 1) recordRenderMeasurement(0.5, 25); // 20x real time
    const quick = startupBufferSeconds();

    __resetRenderThroughput();
    for (let i = 0; i < 40; i += 1) recordRenderMeasurement(0.5, 400); // 1.25x real time
    const slow = startupBufferSeconds();

    expect(quick).toBeLessThan(slow);
  });

  it("never starts on nothing, however fast it measures", () => {
    // The ratio is an average, and averages hide their own worst cases.
    for (let i = 0; i < 60; i += 1) recordRenderMeasurement(1, 5); // 200x
    expect(startupBufferSeconds()).toBeGreaterThan(0.5);
  });

  it("caps the wait, because a long wait is its own defect", () => {
    for (let i = 0; i < 60; i += 1) recordRenderMeasurement(0.5, 5000); // 0.1x — cannot keep up at all
    expect(startupBufferSeconds()).toBeLessThanOrEqual(4);
  });

  it("gives a renderer that cannot keep up all the protection there is", () => {
    for (let i = 0; i < 60; i += 1) recordRenderMeasurement(1, 1000); // exactly real time: no headroom
    expect(startupBufferSeconds()).toBe(4);
  });

  it("ignores chunks that took no time, which come from the cache rather than the renderer", () => {
    const before = renderRatio();
    recordRenderMeasurement(5, 0);
    recordRenderMeasurement(0, 100);
    expect(renderRatio()).toBe(before);
  });

  it("ignores implausible timings rather than learning from them", () => {
    for (let i = 0; i < 30; i += 1) recordRenderMeasurement(0.5, 100); // settle at 5x
    const settled = renderRatio();
    recordRenderMeasurement(1_000_000, 1); // nonsense
    expect(renderRatio()).toBe(settled);
  });

  it("remembers across runs, so the first tune of a session is protected too", () => {
    for (let i = 0; i < 40; i += 1) recordRenderMeasurement(0.5, 50); // 10x
    const learned = renderRatio();

    // A fresh module state, as on a relaunch: the stored figure is picked back up.
    __resetRenderThroughput();
    localStorage.setItem("c64c.local-sid.render-throughput", String(learned));
    expect(renderRatio()).toBeCloseTo(learned, 5);
  });

  it("follows a device that has become slower, within a few seconds of rendering", () => {
    for (let i = 0; i < 40; i += 1) recordRenderMeasurement(0.5, 25); // 20x
    const fast = startupBufferSeconds();
    // Thermal throttling, or the UI getting busy.
    for (let i = 0; i < 40; i += 1) recordRenderMeasurement(0.5, 450);
    expect(startupBufferSeconds()).toBeGreaterThan(fast);
  });

  it("reports the same figure in milliseconds", () => {
    expect(startupBufferMs()).toBe(Math.round(startupBufferSeconds() * 1000));
  });

  it("makes a sober assumption before it has measured anything", () => {
    // A first tune must not wait the maximum just because nothing is known yet — but it must not be
    // given an optimistic guess either, or it starts on too little and pauses, which is the defect
    // this exists to prevent. A Pixel 4 measures 2.0-2.2x, so the untested assumption sits there.
    const initial = startupBufferSeconds();
    expect(initial).toBeGreaterThan(0.6);
    expect(initial).toBeLessThan(2);
  });
});
