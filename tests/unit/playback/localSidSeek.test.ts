import { describe, expect, it } from "vitest";

import { LocalSidChunkScheduler } from "@/lib/playback/localSidChunkScheduler";

/**
 * Seeking has to do two things the normal path never does: throw away audio
 * that is already queued (it belongs to the position we just left) and keep
 * reporting a position that continues from the new spot rather than restarting
 * at zero. Both live in the scheduler, so both are pinned here.
 */

class FakeSource {
  onended: (() => void) | null = null;
  started: number | null = null;
  stopped = false;
  start(when: number) {
    this.started = when;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeSink {
  currentTime = 0;
  readonly sampleRate = 48000;
  readonly sources: FakeSource[] = [];
  createBuffer(channels: number, frames: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { getChannelData: (c: number) => data[c]! } as unknown as AudioBuffer;
  }
  createSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as never;
  }
}

/** One second of stereo silence. */
const chunk = (seconds = 1) => new Int16Array(48000 * seconds * 2);

describe("LocalSidChunkScheduler seek support", () => {
  it("reports position from the seek target, not from zero", () => {
    const sink = new FakeSink();
    const scheduler = new LocalSidChunkScheduler(sink as never, { startPaddingSec: 0 });

    scheduler.schedule(chunk(), 2);
    sink.currentTime = 1;
    expect(scheduler.positionSeconds()).toBeCloseTo(1, 3);

    scheduler.resetTo(90);
    // Nothing scheduled yet after the seek: the position is simply the target.
    expect(scheduler.positionSeconds()).toBeCloseTo(90, 3);

    scheduler.schedule(chunk(), 2);
    sink.currentTime = 2;
    expect(scheduler.positionSeconds()).toBeCloseTo(91, 3);
  });

  it("stops every queued source so pre-seek audio is never heard", () => {
    const sink = new FakeSink();
    const scheduler = new LocalSidChunkScheduler(sink as never, { startPaddingSec: 0 });
    scheduler.schedule(chunk(), 2);
    scheduler.schedule(chunk(), 2);

    scheduler.resetTo(30);

    expect(sink.sources).toHaveLength(2);
    expect(sink.sources.every((source) => source.stopped)).toBe(true);
  });

  it("does not count the seek discontinuity as an underrun", () => {
    // The first chunk after a seek starts long after the old audio ended. That
    // is the seek, not a buffer starvation, and must not pollute the underrun
    // budget (which is pinned at 0).
    const sink = new FakeSink();
    const scheduler = new LocalSidChunkScheduler(sink as never, { startPaddingSec: 0 });
    scheduler.schedule(chunk(), 2);

    scheduler.resetTo(120);
    sink.currentTime = 500; // long gap while the engine re-rendered
    scheduler.schedule(chunk(), 2);

    expect(scheduler.getStats().underruns).toBe(0);
  });

  it("keeps session counters across a seek", () => {
    // chunksScheduled and underruns are session totals; the stats bridge banks
    // underruns whenever it sees the count fall, so resetting them here would
    // double-count.
    const sink = new FakeSink();
    const scheduler = new LocalSidChunkScheduler(sink as never, { startPaddingSec: 0 });
    scheduler.schedule(chunk(), 2);
    scheduler.schedule(chunk(), 2);
    const before = scheduler.getStats().chunksScheduled;

    scheduler.resetTo(10);

    expect(scheduler.getStats().chunksScheduled).toBe(before);
  });

  it("clamps a rewind past the start to the start", () => {
    const sink = new FakeSink();
    const scheduler = new LocalSidChunkScheduler(sink as never, { startPaddingSec: 0 });
    scheduler.resetTo(-30);
    expect(scheduler.positionSeconds()).toBe(0);
  });
});

/**
 * Hold-to-seek shares one button with skip-track, so the suppression flag that
 * stops a hold from also changing track must not outlive the click it belongs
 * to. A keyboard or keypad activation raises `click` with no pointerdown to
 * reset the flag, and the C64U Remote variant is keypad-first.
 */
describe("hold-to-seek click suppression", () => {
  it("is documented as clearing on the tick after pointerup", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/pages/playFiles/components/PlaybackControlsCard.tsx", "utf8");

    // The flag must be cleared asynchronously in stop(), not only in start():
    // clearing it only on the next press is what swallowed a later keypad click.
    expect(source).toMatch(/if \(seeked\.current\) \{\s*window\.setTimeout/);
    expect(source).toContain("keypad-first");
  });
});
