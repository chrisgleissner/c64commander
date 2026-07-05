import { describe, expect, it } from "vitest";

import {
  isBackgroundExecutionEnabled,
  shouldStartBackgroundExecution,
  shouldStopBackgroundExecution,
  shouldSyncBackgroundExecutionDueAt,
} from "@/pages/playFiles/backgroundExecutionPolicy";

describe("backgroundExecutionPolicy", () => {
  it("reads the background execution feature flag from the resolved snapshot", () => {
    expect(
      isBackgroundExecutionEnabled({
        flags: { background_execution_enabled: true },
        isLoaded: true,
      }),
    ).toBe(true);
    expect(
      isBackgroundExecutionEnabled({
        flags: { background_execution_enabled: false },
        isLoaded: true,
      }),
    ).toBe(false);
  });

  it("starts native background execution only for active unpaused playback when the feature is enabled", () => {
    expect(
      shouldStartBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: false,
        isPlaying: true,
        isPaused: false,
      }),
    ).toBe(true);
    expect(
      shouldStartBackgroundExecution({
        backgroundExecutionEnabled: false,
        backgroundExecutionActive: false,
        isPlaying: true,
        isPaused: false,
      }),
    ).toBe(false);
    expect(
      shouldStartBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: false,
        isPlaying: true,
        isPaused: true,
      }),
    ).toBe(false);
  });

  it("stops native background execution when playback stops, pauses, or the feature is disabled", () => {
    expect(
      shouldStopBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: true,
        isPlaying: false,
        isPaused: false,
      }),
    ).toBe(true);
    expect(
      shouldStopBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: true,
        isPlaying: true,
        isPaused: true,
      }),
    ).toBe(true);
    expect(
      shouldStopBackgroundExecution({
        backgroundExecutionEnabled: false,
        backgroundExecutionActive: true,
        isPlaying: true,
        isPaused: false,
      }),
    ).toBe(true);
    expect(
      shouldStopBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: false,
        isPlaying: true,
        isPaused: false,
      }),
    ).toBe(false);
  });

  it("HARD12-018: stops native background execution once the playlist auto-ended, even when isPlaying remains true (song-category device keeps playing)", () => {
    // The wake lock's only job is to service auto-advance; once the guard
    // goes null there is no remaining job, so the wake lock must be released
    // even though the device is still audibly playing the song (Stop
    // affordance must remain reachable via the unchanged isPlaying flag).
    expect(
      shouldStopBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: true,
        isPlaying: true,
        isPaused: false,
        playlistEnded: true,
      }),
    ).toBe(true);
  });

  it("HARD12-018: keeps background execution running when the playlist has not ended (default playback)", () => {
    expect(
      shouldStopBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: true,
        isPlaying: true,
        isPaused: false,
        playlistEnded: false,
      }),
    ).toBe(false);
  });

  it("HARD12-018: refuses to start background execution while playlistEnded is true (no auto-advance to service)", () => {
    expect(
      shouldStartBackgroundExecution({
        backgroundExecutionEnabled: true,
        backgroundExecutionActive: false,
        isPlaying: true,
        isPaused: false,
        playlistEnded: true,
      }),
    ).toBe(false);
  });

  it("syncs due-at timestamps whenever the enabled native Android path needs a new dueAtMs", () => {
    expect(shouldSyncBackgroundExecutionDueAt(true, true, true)).toBe(true);
    expect(shouldSyncBackgroundExecutionDueAt(false, true, true)).toBe(false);
    expect(shouldSyncBackgroundExecutionDueAt(true, false, true)).toBe(true);
    expect(shouldSyncBackgroundExecutionDueAt(true, true, false)).toBe(false);
  });
});
