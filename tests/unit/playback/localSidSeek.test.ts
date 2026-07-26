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
    // The clear must still be asynchronous (a scrub-end call may precede it).
    expect(source).toMatch(/if \(seeked\.current\) \{[\s\S]{0,120}?window\.setTimeout\(\(\) => \{\s*seeked\.current = false;/);
    expect(source).toContain("keypad-first");
  });
});

/**
 * Hold-to-seek has to give feedback while the finger is down. The engine cannot
 * provide it: rewinding reloads the tune and re-renders up to the target, so
 * its reported position lags by however long that takes, and a progress bar
 * following the engine sits still through the whole gesture — which reads as a
 * broken control. The UI therefore follows a scrub TARGET that moves instantly,
 * and the engine is sent after it.
 */
describe("scrub feedback contract", () => {
  it("moves the target on every repeat tick, not once per engine seek", async () => {
    const { readFileSync } = await import("node:fs");
    const card = readFileSync("src/pages/playFiles/components/PlaybackControlsCard.tsx", "utf8");
    // The repeat interval must drive scrub.step (the target), not onSeek.
    expect(card).toMatch(/repeatTimer\.current = window\.setInterval\(\(\) => \{\s*scrub\.step\?\.\(deltaSeconds\)/);
    // Releasing the button lands on the target.
    expect(card).toContain("scrubRef.current?.end?.()");
  });

  it("shows the scrub position rather than the audio clock while scrubbing", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/pages/PlayFilesPage.tsx", "utf8");
    expect(page).toContain("const isScrubbing = scrubTargetMs !== null");
    expect(page).toContain("const displayElapsedMs = isScrubbing ? scrubTargetMs : elapsedMs");
    // Both the bar and the timer must use it, or they disagree mid-gesture.
    expect(page).toMatch(/progressPercent = currentDurationMs \? Math\.min\(100, \(displayElapsedMs/);
    expect(page).toContain("elapsedLabel={formatTime(displayElapsedMs)}");
  });

  it("sends the engine to the latest target on a bounded cadence", async () => {
    const { readFileSync } = await import("node:fs");
    const hook = readFileSync("src/pages/playFiles/hooks/usePlaybackController.ts", "utf8");
    // One seek in flight at a time, aimed at wherever the finger is now.
    expect(hook).toContain("if (!controller || target === null || scrubSeekInFlightRef.current) return");
    expect(hook).toContain("SCRUB_SEEK_INTERVAL_MS");
  });
});
