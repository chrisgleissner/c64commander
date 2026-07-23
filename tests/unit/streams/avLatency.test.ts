/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { AvLatencyTracker } from "@/lib/streams/avLatency";

describe("AvLatencyTracker", () => {
  it("measures press→see, press→hear and the wire offset for one keypress (video first)", () => {
    const t = new AvLatencyTracker();
    t.markPress(100);
    t.onVideoPop(120); // seen 20 ms after press
    t.onAudioPop(125); // heard 25 ms after press
    t.onMatchOffset(-3); // wire offset audio−video = -3 → |3|
    const s = t.getStats();
    expect(s.count).toBe(1);
    expect(s.seeLastMs).toBe(20);
    expect(s.hearLastMs).toBe(25);
    expect(s.offsetLastMs).toBe(3);
    expect(s.missed).toBe(0);
  });

  it("handles the audio-pop-first ordering", () => {
    const t = new AvLatencyTracker();
    t.markPress(100);
    t.onAudioPop(122);
    t.onVideoPop(124);
    t.onMatchOffset(2);
    const s = t.getStats();
    expect(s.count).toBe(1);
    expect(s.seeLastMs).toBe(24);
    expect(s.hearLastMs).toBe(22);
    expect(s.offsetLastMs).toBe(2);
  });

  it("ignores a stale pop that predates the press", () => {
    const t = new AvLatencyTracker();
    t.markPress(100);
    t.onVideoPop(90); // stale — before the press
    t.onVideoPop(130); // the real one
    t.onAudioPop(132);
    t.onMatchOffset(1);
    expect(t.getStats().seeLastMs).toBe(30);
  });

  it("counts a press whose pop never arrives as missed when superseded", () => {
    const t = new AvLatencyTracker();
    t.markPress(100);
    t.onVideoPop(120); // incomplete — no audio / offset
    t.markPress(500); // supersedes the incomplete measurement
    t.onVideoPop(520);
    t.onAudioPop(525);
    t.onMatchOffset(0);
    const s = t.getStats();
    expect(s.count).toBe(1);
    expect(s.missed).toBe(1);
  });

  it("aggregates P99 across many presses", () => {
    const t = new AvLatencyTracker();
    for (let i = 0; i < 100; i++) {
      const press = i * 1000;
      t.markPress(press);
      t.onVideoPop(press + 10 + (i === 99 ? 40 : 0)); // one slow outlier
      t.onAudioPop(press + 12);
      t.onMatchOffset(2);
    }
    const s = t.getStats();
    expect(s.count).toBe(100);
    // P99 see-latency sits near the top of the distribution but the single 50ms outlier
    // is the 100th sample, so P99 is high yet the median stays ~10ms.
    expect(s.seeP99Ms!).toBeGreaterThan(10);
    expect(s.offsetP99Ms).toBe(2);
  });

  it("resets cleanly", () => {
    const t = new AvLatencyTracker();
    t.markPress(0);
    t.onVideoPop(10);
    t.onAudioPop(12);
    t.onMatchOffset(1);
    t.reset();
    const s = t.getStats();
    expect(s.count).toBe(0);
    expect(s.seeLastMs).toBeNull();
    expect(s.offsetP99Ms).toBeNull();
    expect(s.missed).toBe(0);
  });
});
