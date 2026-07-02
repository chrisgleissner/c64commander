import { describe, expect, it } from "vitest";
import {
  resolveAutoAdvanceDueAtMsOnDurationChange,
  resolveVolumeSyncDecision,
  type VolumeUiTarget,
} from "@/pages/playFiles/playbackGuards";

describe("playbackGuards resolveVolumeSyncDecision", () => {
  it("applies sync when there is no pending ui target", () => {
    expect(resolveVolumeSyncDecision(null, 4, 1000)).toBe("apply");
  });

  it("clears pending target when incoming index matches reserved target", () => {
    const pending: VolumeUiTarget = { index: 5, setAtMs: 1000 };
    expect(resolveVolumeSyncDecision(pending, 5, 1200)).toBe("clear");
  });

  it("defers sync while stale competing value arrives before hold window expires", () => {
    const pending: VolumeUiTarget = { index: 6, setAtMs: 1000 };
    expect(resolveVolumeSyncDecision(pending, 3, 3400, 2500)).toBe("defer");
  });

  it("clears pending target when hold window expires for stale competing value", () => {
    const pending: VolumeUiTarget = { index: 6, setAtMs: 1000 };
    expect(resolveVolumeSyncDecision(pending, 3, 3500, 2500)).toBe("clear");
  });
});

describe("playbackGuards resolveAutoAdvanceDueAtMsOnDurationChange", () => {
  it("recomputes dueAtMs from the new duration while playing", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 600_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_180_000,
      }),
    ).toBe(1_600_000);
  });

  it("shortening duration below elapsed time still yields the new (past) due time", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 60_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_600_000,
      }),
    ).toBe(1_060_000);
  });

  it("returns null when nothing is playing", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: false,
        isPaused: false,
        durationMs: 600_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: undefined,
      }),
    ).toBeNull();
  });

  it("returns null while paused, deferring to handlePauseResume's own recompute on resume", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: true,
        durationMs: 600_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_180_000,
      }),
    ).toBeNull();
  });

  it("returns null when duration is not yet resolved", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: undefined,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: undefined,
      }),
    ).toBeNull();
  });

  it("returns null when the track has not recorded a start time", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 600_000,
        trackStartedAtMs: null,
        currentDueAtMs: undefined,
      }),
    ).toBeNull();
  });

  it("returns null (no-op) when the recomputed due time already matches the guard, e.g. right after track launch", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 180_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_180_000,
      }),
    ).toBeNull();
  });
});
