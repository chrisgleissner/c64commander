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
    expect(source).toMatch(
      /if \(seeked\.current\) \{[\s\S]{0,120}?window\.setTimeout\(\(\) => \{\s*seeked\.current = false;/,
    );
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
    // Amended: the expression now has a third source. A scrub still wins, which is what this test is
    // about, but a seek waiting for the renderer freezes the clock at the last audible position
    // instead of letting it run on through the silence. Insisting on the old two-way expression
    // would have required the clock to advance normally while nothing was sounding, which is the
    // defect the pending-seek state exists to remove.
    expect(page).toContain("const displayElapsedMs = isScrubbing ? scrubTargetMs :");
    expect(page).toContain("pendingSeek?.audibleMs ?? elapsedMs");
    // Both the bar and the timer must use it, or they disagree mid-gesture.
    expect(page).toMatch(/progressPercent = currentDurationMs \? Math\.min\(100, \(displayElapsedMs/);
    expect(page).toContain("elapsedLabel={formatTime(displayElapsedMs)}");
  });

  it("does not seek at all while the finger is down", async () => {
    // Amended. Seeking on a cadence during the gesture was still one full re-render per tick, because
    // libsidplayfp cannot rewind: on a Pixel 4 that is fifteen to twenty seconds of silence per seek,
    // for positions the listener had already dragged past. Only where the finger is LIFTED matters, so
    // the gesture moves the bar and the release seeks once.
    const { readFileSync } = await import("node:fs");
    const hook = readFileSync("src/pages/playFiles/hooks/usePlaybackController.ts", "utf8");
    expect(hook).not.toContain("SCRUB_SEEK_INTERVAL_MS");
    expect(hook).not.toContain("runScrubSeek");
    // The release is what seeks, and it still lands exactly where the finger left off.
    expect(hook).toContain("const endScrub = useCallback(");
    expect(hook).toContain("scrubTargetMsRef.current");
  });
});

/**
 * The auto-advance deadline is computed once, at launch, as "now + the tune's
 * remaining duration". Seeking rebases the playback clocks but used to leave
 * that deadline untouched, so a tune scrubbed forward kept playing long past
 * its end: jumping to 95% of a 4:28 tune left it still playing at 4:57 and
 * counting, because the original schedule had not expired. Every seek path has
 * to move the deadline with the position.
 */
describe("auto-advance follows a seek", () => {
  it("reschedules from every seek path", async () => {
    const { readFileSync } = await import("node:fs");
    const hook = readFileSync("src/pages/playFiles/hooks/usePlaybackController.ts", "utf8");
    expect(hook).toContain("const rescheduleAutoAdvance = useCallback(");
    // Relative seek (hold), scrub release, and the two that drive them.
    const calls = hook.match(/rescheduleAutoAdvance\(positionMs\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // Deadline is derived from the tune's duration and the NEW position.
    expect(hook).toContain("const dueAtMs = Date.now() + Math.max(0, durationMs - positionMs)");
    // A rescheduled track must be allowed to fire again.
    expect(hook).toContain("guard.autoFired = false");
  });

  it("holds the deadline still while a seek waits for the renderer", async () => {
    // The deadline is set from the TARGET the instant the target is accepted, before a note of that
    // position has been heard. A wait of twenty seconds therefore spent twenty seconds of the tune's
    // own time, and a target deep into a long tune advanced the playlist before playback resumed at
    // all — the tune reported itself finished without ever reaching the position asked for.
    //
    // What holds it still is the anchor: for as long as the wait lasts the engine's playhead sits at
    // the target, so the elapsed time the deadline is computed from does not move either.
    const { resolvePlayheadAnchor } = await import("@/lib/playback/playheadAnchor");
    const durationMs = 240_000;
    const targetMs = 180_000;
    const acceptedAtMs = 1_000_000;
    // The seek is accepted: the clocks are rebased to the target.
    const trackStartedAtMs = acceptedAtMs - targetMs;

    // Twenty seconds of rendering pass. The playhead has not moved — nothing was heard.
    const nowMs = acceptedAtMs + 20_000;
    const anchor = resolvePlayheadAnchor({ enginePositionMs: targetMs, trackStartedAtMs, nowMs });

    expect(anchor?.elapsedMs).toBe(targetMs);
    // So the tune still has all of its remaining minute left, rather than forty seconds.
    expect(durationMs - (anchor?.elapsedMs ?? 0)).toBe(60_000);
    // And the wall clock had genuinely run away by the whole wait, which is what the anchor caught.
    expect(anchor?.driftMs).toBe(20_000);
    expect(anchor?.drifted).toBe(true);
  });

  it("re-derives the deadline from the anchored elapsed time, not from wall time", async () => {
    // Contract on the wiring: the timeline tick is the one place that owns this. A second mechanism
    // writing the same deadline drifted from it AND spent a Capacitor bridge call twice a second.
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/pages/PlayFilesPage.tsx", "utf8");
    expect(page).toContain("resolvePlayheadAnchor({");
    expect(page).toContain("const dueAtMs = now + Math.max(0, currentDurationMsRef.current - anchor.elapsedMs);");
    // Only when it moved: this deadline is mirrored to the native background watchdog.
    expect(page).toContain("if (anchor.drifted && !anchor.stalled && currentDurationMsRef.current)");
    expect(page).not.toContain("holdAutoAdvanceWhilePending");
  });
});

/**
 * When a tune is allowed to report that it has finished.
 *
 * The engine fires "ended" once every source it scheduled has reported back. It counts those reports
 * itself and zeroes the count on a seek — so the count it is compared against has to be zeroed by
 * the same seek. Measured on a Pixel 4 before this: a tune seeked into played to the end of its
 * audio with 114 chunks scheduled against 28 reported, never fired "ended", and the playlist sat on
 * a silent track.
 */
describe("chunk accounting across a seek", () => {
  it("counts scheduled chunks from the last seek, not from the start of the tune", () => {
    const sink = new FakeSink();
    const scheduler = new LocalSidChunkScheduler(sink as never, { startPaddingSec: 0 });
    scheduler.schedule(chunk(), 2);
    scheduler.schedule(chunk(), 2);
    expect(scheduler.chunksScheduledSinceReset()).toBe(2);

    scheduler.resetTo(60);

    expect(scheduler.chunksScheduledSinceReset()).toBe(0);
    scheduler.schedule(chunk(), 2);
    expect(scheduler.chunksScheduledSinceReset()).toBe(1);
    // The session total is untouched, because the stats bridge reads that one.
    expect(scheduler.getStats().chunksScheduled).toBe(3);
  });

  it("silences the pre-seek sources without their ends ever being reported", () => {
    // Which is why the count has to restart rather than be subtracted from: those sources have their
    // completion handler removed, so they can never balance the books.
    const sink = new FakeSink();
    const scheduler = new LocalSidChunkScheduler(sink as never, { startPaddingSec: 0 });
    let ended = 0;
    scheduler.schedule(chunk(), 2);
    sink.sources.forEach((source) => (source.onended = () => (ended += 1)));

    scheduler.resetTo(60);
    sink.sources.forEach((source) => source.onended?.());

    expect(ended).toBe(0);
  });
});
