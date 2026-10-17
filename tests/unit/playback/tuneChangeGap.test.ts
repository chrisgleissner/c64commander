/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import type { LocalSidEngine } from "@/lib/playback/localSidEngine";
import { TuneChangeGapTracker, tuneChangeGapTracker } from "@/lib/playback/tuneChangeGap";
import { getLogs } from "@/lib/logging";

describe("TuneChangeGapTracker", () => {
  let nowMs = 0;
  const tracker = () => new TuneChangeGapTracker(() => nowMs);

  beforeEach(() => {
    nowMs = 0;
    localStorage.setItem("c64u_debug_logging_enabled", "1");
  });

  it("measures the silence from the previous songlength to the next tune's first audio", () => {
    const t = tracker();
    t.noteTuneAudioStarted({ durationMs: 60_000, auto: false });
    nowMs = 64_500;
    expect(t.noteTuneAudioStarted({ durationMs: 30_000, auto: true })).toBe(4500);
    expect(t.stats()).toMatchObject({ changes: 1, longGaps: 1, maxGapMs: 4500, totalGapMs: 4500, lastGapMs: 4500 });
  });

  it("reports zero for a tune that started before its predecessor ended, and counts no long gap", () => {
    const t = tracker();
    t.noteTuneAudioStarted({ durationMs: 60_000, auto: false });
    nowMs = 57_500;
    expect(t.noteTuneAudioStarted({ durationMs: 30_000, auto: true })).toBe(0);
    expect(t.stats().longGaps).toBe(0);
  });

  it("does not measure a user skip, an unknown songlength, or the first tune after a reset", () => {
    const t = tracker();
    t.noteTuneAudioStarted({ durationMs: 60_000, auto: false });
    nowMs = 70_000;
    expect(t.noteTuneAudioStarted({ durationMs: null, auto: false })).toBeNull();
    nowMs = 80_000;
    expect(t.noteTuneAudioStarted({ durationMs: 10_000, auto: true })).toBeNull();
    t.reset();
    nowMs = 99_000;
    expect(t.noteTuneAudioStarted({ durationMs: 10_000, auto: true })).toBeNull();
    expect(t.stats().changes).toBe(0);
  });

  it("logs each measured change at info level and a long gap as a warning", () => {
    const t = tracker();
    t.noteTuneAudioStarted({ durationMs: 10_000, auto: false });
    nowMs = 10_200;
    t.noteTuneAudioStarted({ durationMs: 10_000, auto: true, label: "a" });
    nowMs = 23_300;
    t.noteTuneAudioStarted({ durationMs: 10_000, auto: true, label: "b" });
    const entries = getLogs().filter(
      (entry) => entry.message === "Tune change gap" && ["a", "b"].includes((entry.details as { next: string }).next),
    );
    expect(entries.reverse().map((entry) => [entry.level, (entry.details as { gapMs: number }).gapMs])).toEqual([
      ["info", 200],
      ["warn", 3100],
    ]);
  });
});

describe("LocalSidPlaybackController tune change gap", () => {
  it("measures an automatic advance and forgets the tune on stop", async () => {
    tuneChangeGapTracker.reset();
    tuneChangeGapTracker.clearStats();
    const engine = {
      play: vi.fn(async () => ({ romRequired: false, started: true, sampleRate: 48000, channels: 2, tuneInfo: null })),
      stop: vi.fn(),
      prerender: vi.fn(),
    } as unknown as LocalSidEngine;
    const controller = new LocalSidPlaybackController(() => engine);
    const source = { arrayBuffer: async () => new ArrayBuffer(4), name: "t.sid" };
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(1_000);
    await controller.play(source, 0, {}, { durationSeconds: 10 });
    now.mockReturnValue(15_000);
    await controller.play(source, 0, {}, { durationSeconds: 10, outgoingEndsAtSeconds: 10 });
    expect(tuneChangeGapTracker.stats().lastGapMs).toBe(4000);

    controller.stop();
    now.mockReturnValue(40_000);
    await controller.play(source, 0, {}, { durationSeconds: 10, outgoingEndsAtSeconds: 10 });
    expect(tuneChangeGapTracker.stats().changes).toBe(1);
    now.mockRestore();
  });
});
