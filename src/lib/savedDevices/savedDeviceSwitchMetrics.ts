import type { VerificationResult } from "@/lib/connection/connectionManager";

export const SAVED_DEVICE_SWITCH_METRICS_EVENT = "c64u-saved-device-switch-metrics";

export type SavedDeviceSwitchAttemptOutcome = "running" | "success" | "offline" | "error";

export type SavedDeviceSwitchAttempt = {
  id: string;
  fromDeviceId: string | null;
  toDeviceId: string;
  routePath: string;
  startedAt: string;
  selectedAt: string | null;
  verificationStartedAt: string | null;
  verificationResolvedAt: string | null;
  completedAt: string | null;
  outcome: SavedDeviceSwitchAttemptOutcome;
  verificationOk: boolean | null;
  totalDurationMs: number | null;
  selectionLatencyMs: number | null;
  verificationDurationMs: number | null;
  errorMessage: string | null;
  deviceInfo: VerificationResult["deviceInfo"] | null;
};

export type SavedDeviceSwitchMetricsSnapshot = {
  activeAttemptId: string | null;
  attempts: SavedDeviceSwitchAttempt[];
};

export type SavedDeviceSwitchLatencySummary = {
  count: number;
  successCount: number;
  failureCount: number;
  minDurationMs: number | null;
  p50DurationMs: number | null;
  p90DurationMs: number | null;
  maxDurationMs: number | null;
  averageDurationMs: number | null;
};

type MutableAttempt = SavedDeviceSwitchAttempt & {
  startedAtMs: number;
  selectedAtMs: number | null;
  verificationStartedAtMs: number | null;
  verificationResolvedAtMs: number | null;
  completedAtMs: number | null;
};

const MAX_ATTEMPTS = 250;

let activeAttemptId: string | null = null;
let attempts: MutableAttempt[] = [];

const nowIso = (timestampMs: number) => new Date(timestampMs).toISOString();

const buildId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
  `saved-device-switch-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const publishSnapshot = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SAVED_DEVICE_SWITCH_METRICS_EVENT, { detail: getSavedDeviceSwitchMetricsSnapshot() }),
  );
};

const toPublicAttempt = (attempt: MutableAttempt): SavedDeviceSwitchAttempt => ({
  id: attempt.id,
  fromDeviceId: attempt.fromDeviceId,
  toDeviceId: attempt.toDeviceId,
  routePath: attempt.routePath,
  startedAt: attempt.startedAt,
  selectedAt: attempt.selectedAt,
  verificationStartedAt: attempt.verificationStartedAt,
  verificationResolvedAt: attempt.verificationResolvedAt,
  completedAt: attempt.completedAt,
  outcome: attempt.outcome,
  verificationOk: attempt.verificationOk,
  totalDurationMs: attempt.totalDurationMs,
  selectionLatencyMs: attempt.selectionLatencyMs,
  verificationDurationMs: attempt.verificationDurationMs,
  errorMessage: attempt.errorMessage,
  deviceInfo: attempt.deviceInfo,
});

const updateAttempt = (attemptId: string, updater: (attempt: MutableAttempt) => MutableAttempt) => {
  let changed = false;
  attempts = attempts.map((attempt) => {
    if (attempt.id !== attemptId) {
      return attempt;
    }
    changed = true;
    return updater(attempt);
  });
  if (changed) {
    publishSnapshot();
  }
};

export const beginSavedDeviceSwitchAttempt = (args: {
  fromDeviceId: string | null;
  toDeviceId: string;
  routePath: string;
}): string => {
  const startedAtMs = Date.now();
  const attempt: MutableAttempt = {
    id: buildId(),
    fromDeviceId: args.fromDeviceId,
    toDeviceId: args.toDeviceId,
    routePath: args.routePath,
    startedAt: nowIso(startedAtMs),
    startedAtMs,
    selectedAt: null,
    selectedAtMs: null,
    verificationStartedAt: null,
    verificationStartedAtMs: null,
    verificationResolvedAt: null,
    verificationResolvedAtMs: null,
    completedAt: null,
    completedAtMs: null,
    outcome: "running",
    verificationOk: null,
    totalDurationMs: null,
    selectionLatencyMs: null,
    verificationDurationMs: null,
    errorMessage: null,
    deviceInfo: null,
  };

  activeAttemptId = attempt.id;
  attempts = [attempt, ...attempts].slice(0, MAX_ATTEMPTS);
  publishSnapshot();
  return attempt.id;
};

export const markSavedDeviceSwitchSelectionApplied = (attemptId: string) => {
  const selectedAtMs = Date.now();
  updateAttempt(attemptId, (attempt) => ({
    ...attempt,
    selectedAtMs,
    selectedAt: nowIso(selectedAtMs),
    selectionLatencyMs: Math.max(0, selectedAtMs - attempt.startedAtMs),
  }));
};

export const markSavedDeviceSwitchVerificationStarted = (attemptId: string) => {
  const verificationStartedAtMs = Date.now();
  updateAttempt(attemptId, (attempt) => ({
    ...attempt,
    verificationStartedAtMs,
    verificationStartedAt: nowIso(verificationStartedAtMs),
  }));
};

export const completeSavedDeviceSwitchAttempt = (
  attemptId: string,
  args:
    | {
        outcome: "success" | "offline";
        verification: VerificationResult;
      }
    | {
        outcome: "error";
        errorMessage: string;
      },
): SavedDeviceSwitchAttempt | null => {
  const completedAtMs = Date.now();
  let completedAttempt: SavedDeviceSwitchAttempt | null = null;

  updateAttempt(attemptId, (attempt) => {
    const verificationResolvedAtMs = completedAtMs;
    const verificationResolvedAt = nowIso(verificationResolvedAtMs);
    const totalDurationMs = Math.max(0, completedAtMs - attempt.startedAtMs);
    const verificationDurationMs =
      attempt.verificationStartedAtMs === null
        ? null
        : Math.max(0, verificationResolvedAtMs - attempt.verificationStartedAtMs);

    const next: MutableAttempt = {
      ...attempt,
      verificationResolvedAtMs,
      verificationResolvedAt,
      completedAtMs,
      completedAt: nowIso(completedAtMs),
      outcome: args.outcome,
      verificationOk: args.outcome === "error" ? false : args.verification.ok,
      totalDurationMs,
      verificationDurationMs,
      errorMessage: args.outcome === "error" ? args.errorMessage : null,
      deviceInfo: args.outcome === "error" ? null : (args.verification.deviceInfo ?? null),
    };

    completedAttempt = toPublicAttempt(next);
    return next;
  });

  if (activeAttemptId === attemptId) {
    activeAttemptId = null;
    publishSnapshot();
  }

  return completedAttempt;
};

export const clearSavedDeviceSwitchMetrics = () => {
  activeAttemptId = null;
  attempts = [];
  publishSnapshot();
};

export const getSavedDeviceSwitchMetricsSnapshot = (): SavedDeviceSwitchMetricsSnapshot => ({
  activeAttemptId,
  attempts: attempts.map(toPublicAttempt),
});

export const computeSavedDeviceSwitchLatencySummary = (
  attemptList: ReadonlyArray<Pick<SavedDeviceSwitchAttempt, "outcome" | "totalDurationMs">>,
): SavedDeviceSwitchLatencySummary => {
  const durations = attemptList
    .map((attempt) => attempt.totalDurationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  const successCount = attemptList.filter((attempt) => attempt.outcome === "success").length;
  const failureCount = attemptList.filter(
    (attempt) => attempt.outcome === "offline" || attempt.outcome === "error",
  ).length;

  const percentile = (ratio: number) => {
    if (durations.length === 0) return null;
    const index = Math.min(durations.length - 1, Math.max(0, Math.round((durations.length - 1) * ratio)));
    return durations[index] ?? null;
  };

  return {
    count: attemptList.length,
    successCount,
    failureCount,
    minDurationMs: durations[0] ?? null,
    p50DurationMs: percentile(0.5),
    p90DurationMs: percentile(0.9),
    maxDurationMs: durations.length > 0 ? (durations[durations.length - 1] ?? null) : null,
    averageDurationMs:
      durations.length === 0 ? null : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
  };
};
