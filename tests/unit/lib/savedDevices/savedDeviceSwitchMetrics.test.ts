import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSavedDeviceSwitchAttempt,
  clearSavedDeviceSwitchMetrics,
  completeSavedDeviceSwitchAttempt,
  computeSavedDeviceSwitchLatencySummary,
  getSavedDeviceSwitchMetricsSnapshot,
  markSavedDeviceSwitchSelectionApplied,
  markSavedDeviceSwitchVerificationStarted,
} from "@/lib/savedDevices/savedDeviceSwitchMetrics";

describe("savedDeviceSwitchMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:00:00.000Z"));
    clearSavedDeviceSwitchMetrics();
  });

  it("records a successful switch attempt with selection and verification timings", () => {
    const attemptId = beginSavedDeviceSwitchAttempt({
      fromDeviceId: "device-a",
      toDeviceId: "device-b",
      routePath: "/settings",
    });

    vi.advanceTimersByTime(25);
    markSavedDeviceSwitchSelectionApplied(attemptId);
    vi.advanceTimersByTime(75);
    markSavedDeviceSwitchVerificationStarted(attemptId);
    vi.advanceTimersByTime(250);

    const attempt = completeSavedDeviceSwitchAttempt(attemptId, {
      outcome: "success",
      verification: {
        ok: true,
        deviceInfo: {
          product: "U64",
          hostname: "u64",
          unique_id: "UID-1",
        },
      },
    });

    expect(attempt).toMatchObject({
      fromDeviceId: "device-a",
      toDeviceId: "device-b",
      routePath: "/settings",
      outcome: "success",
      verificationOk: true,
      selectionLatencyMs: 25,
      verificationDurationMs: 250,
      totalDurationMs: 350,
      errorMessage: null,
    });
    expect(getSavedDeviceSwitchMetricsSnapshot().activeAttemptId).toBeNull();
  });

  it("captures failed attempts and summarizes mixed latency history", () => {
    const firstAttemptId = beginSavedDeviceSwitchAttempt({
      fromDeviceId: "device-a",
      toDeviceId: "device-b",
      routePath: "/",
    });
    vi.advanceTimersByTime(10);
    markSavedDeviceSwitchSelectionApplied(firstAttemptId);
    markSavedDeviceSwitchVerificationStarted(firstAttemptId);
    vi.advanceTimersByTime(190);
    completeSavedDeviceSwitchAttempt(firstAttemptId, {
      outcome: "offline",
      verification: {
        ok: false,
        deviceInfo: null,
      },
    });

    const secondAttemptId = beginSavedDeviceSwitchAttempt({
      fromDeviceId: "device-b",
      toDeviceId: "device-a",
      routePath: "/play",
    });
    vi.advanceTimersByTime(20);
    markSavedDeviceSwitchSelectionApplied(secondAttemptId);
    markSavedDeviceSwitchVerificationStarted(secondAttemptId);
    vi.advanceTimersByTime(80);
    completeSavedDeviceSwitchAttempt(secondAttemptId, {
      outcome: "error",
      errorMessage: "Boom",
    });

    const summary = computeSavedDeviceSwitchLatencySummary(getSavedDeviceSwitchMetricsSnapshot().attempts);
    expect(summary).toEqual({
      count: 2,
      successCount: 0,
      failureCount: 2,
      minDurationMs: 100,
      p50DurationMs: 200,
      p90DurationMs: 200,
      maxDurationMs: 200,
      averageDurationMs: 150,
    });
  });
});
