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

  it("syncs due-at timestamps only while the enabled native Android path is active", () => {
    expect(shouldSyncBackgroundExecutionDueAt(true, true, true)).toBe(true);
    expect(shouldSyncBackgroundExecutionDueAt(false, true, true)).toBe(false);
    expect(shouldSyncBackgroundExecutionDueAt(true, false, true)).toBe(false);
    expect(shouldSyncBackgroundExecutionDueAt(true, true, false)).toBe(false);
  });
});
