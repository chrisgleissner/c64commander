/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
  ActionTrigger,
  BackendTarget,
  TraceEvent,
  TraceOrigin,
} from "@/lib/tracing/types";

export type ActionSummaryOrigin = "user" | "system" | "unknown";
export type ActionSummaryOutcome =
  | "success"
  | "error"
  | "blocked"
  | "timeout"
  | "incomplete";

export type RestEffect = {
  type: "REST";
  label: string;
  method: string;
  path: string;
  target: BackendTarget | null;
  product?: string;
  status: number | string | null;
  durationMs: number | null;
  error?: string;
};

export type FtpEffect = {
  type: "FTP";
  label: string;
  operation: string;
  path: string;
  target: BackendTarget | null;
  result: string | null;
  error?: string;
};

export type ErrorEffect = {
  type: "ERROR";
  label: string;
  message: string;
};

export type ActionSummaryEffect = RestEffect | FtpEffect | ErrorEffect;

export type ActionSummary = {
  correlationId: string;
  actionName: string;
  origin: ActionSummaryOrigin;
  originalOrigin?: TraceOrigin;
  trigger?: ActionTrigger | null;
  startTimestamp: string | null;
  endTimestamp: string | null;
  durationMs: number | null;
  durationMsMissing?: true;
  outcome: ActionSummaryOutcome;
  errorMessage?: string;
  restCount?: number;
  ftpCount?: number;
  errorCount?: number;
  effects?: ActionSummaryEffect[];
  startRelativeMs: number;
};

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const readNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const resolveSummaryOrigin = (
  origin: TraceOrigin | null,
): ActionSummaryOrigin => {
  if (origin === "user") return "user";
  if (origin === "automatic" || origin === "system") return "system";
  // Fallback for malformed/legacy traces where origin is missing or unrecognized.
  return "unknown";
};

const resolveOutcome = (
  status: string | null,
  isComplete: boolean,
): ActionSummaryOutcome => {
  if (!isComplete) return "incomplete";
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "blocked":
      return "blocked";
    case "timeout":
      return "timeout";
    default:
      return "incomplete";
  }
};

const resolveActionName = (
  actionStart: TraceEvent | undefined,
  correlationId: string,
): string => {
  const name = readString(actionStart?.data?.name);
  return name ?? `Action ${correlationId}`;
};

const toTimestampMs = (timestamp: string | null | undefined): number | null => {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
};

const resolveDurationMs = (
  startTimestamp: string | null,
  endTimestamp: string | null,
  orderedEvents: TraceEvent[],
  startRelativeMs: number,
  endRelativeMs: number,
): { durationMs: number | null; durationMsMissing: boolean } => {
  const startMs = toTimestampMs(startTimestamp);
  const endMs = toTimestampMs(endTimestamp);
  const completionMs = orderedEvents.reduce<number | null>((latest, event) => {
    if (event.type !== "rest-response" && event.type !== "ftp-operation")
      return latest;
    const candidate = toTimestampMs(event.timestamp);
    if (candidate === null) return latest;
    return latest === null || candidate > latest ? candidate : latest;
  }, null);

  if (startMs !== null) {
    const effectiveEnd = completionMs ?? endMs;
    if (effectiveEnd !== null && effectiveEnd >= startMs) {
      return { durationMs: effectiveEnd - startMs, durationMsMissing: false };
    }
  }

  if (
    Number.isFinite(startRelativeMs) &&
    Number.isFinite(endRelativeMs) &&
    endRelativeMs >= startRelativeMs
  ) {
    return {
      durationMs: endRelativeMs - startRelativeMs,
      durationMsMissing: false,
    };
  }

  return { durationMs: null, durationMsMissing: true };
};

const resolveActionError = (
  actionEnd: TraceEvent | undefined,
  errorEvents: TraceEvent[],
): string | null => {
  const endError = readString(actionEnd?.data?.error);
  if (endError) return endError;
  const errorMessage = readString(errorEvents[0]?.data?.message);
  return errorMessage ?? null;
};

const resolveErrorEffects = (
  errorEvents: TraceEvent[],
  actionEnd: TraceEvent | undefined,
): ErrorEffect[] => {
  const effects: ErrorEffect[] = [];
  const seenMessages = new Set<string>();

  errorEvents.forEach((event) => {
    const message = readString(event.data?.message) ?? "unknown error";
    if (!seenMessages.has(message)) {
      effects.push({
        type: "ERROR",
        label: "error",
        message,
      });
      seenMessages.add(message);
    }
  });

  const endError = readString(actionEnd?.data?.error);
  if (endError) {
    if (!seenMessages.has(endError)) {
      effects.push({
        type: "ERROR",
        label: "action-end error",
        message: endError,
      });
    }
    return effects;
  }
  if (effects.length === 0) {
    const status = readString(actionEnd?.data?.status);
    if (status === "error") {
      effects.push({
        type: "ERROR",
        label: "action-end error",
        message: "action ended with error",
      });
    }
  }
  return effects;
};

const resolveRestEffects = (
  events: TraceEvent[],
  actionEnd: TraceEvent | undefined,
): RestEffect[] => {
  const restEffects: RestEffect[] = [];
  const pendingRequests: TraceEvent[] = [];
  const endStatus = readString(actionEnd?.data?.status);
  const endError = readString(actionEnd?.data?.error);

  events.forEach((event) => {
    if (event.type === "rest-request") {
      pendingRequests.push(event);
      return;
    }
    if (event.type === "rest-response") {
      const request = pendingRequests.shift();
      if (!request) return;
      const requestData = request.data as Record<string, unknown>;
      const responseData = event.data as Record<string, unknown>;
      const error =
        readString(responseData.error) ??
        (responseData.error ? String(responseData.error) : null);
      const method = readString(requestData.method) ?? "UNKNOWN";
      const path =
        readString(requestData.normalizedUrl) ??
        readString(requestData.url) ??
        "unknown";
      const responseBody =
        responseData.body &&
        typeof responseData.body === "object" &&
        !Array.isArray(responseData.body)
          ? (responseData.body as Record<string, unknown>)
          : null;
      const product = readString(responseBody?.product);
      const hasResponseStatus = "status" in responseData;
      const responseStatus = hasResponseStatus
        ? responseData.status === null
          ? null
          : (readNumber(responseData.status) ?? null)
        : (endStatus ?? null);
      restEffects.push({
        type: "REST",
        label: `${method} ${path}`,
        method,
        path,
        target:
          (readString(requestData.target) as BackendTarget | null) ?? null,
        ...(product ? { product } : {}),
        status: responseStatus,
        durationMs: readNumber(responseData.durationMs),
        ...(error !== null ? { error } : {}),
      });
    }
  });

  pendingRequests.forEach((request) => {
    const requestData = request.data as Record<string, unknown>;
    const method = readString(requestData.method) ?? "UNKNOWN";
    const path =
      readString(requestData.normalizedUrl) ??
      readString(requestData.url) ??
      "unknown";
    restEffects.push({
      type: "REST",
      label: `${method} ${path}`,
      method,
      path,
      target: (readString(requestData.target) as BackendTarget | null) ?? null,
      status: endStatus ?? null,
      durationMs: null,
      ...(endError !== null ? { error: endError } : {}),
    });
  });

  return restEffects;
};

const resolveFtpEffects = (events: TraceEvent[]): FtpEffect[] => {
  return events
    .filter((event) => event.type === "ftp-operation")
    .map((event) => {
      const data = event.data as Record<string, unknown>;
      const error = readString(data.error);
      const operation = readString(data.operation) ?? "unknown";
      const path = readString(data.path) ?? "unknown";
      return {
        type: "FTP",
        label: `${operation} ${path}`,
        operation,
        path,
        target: (readString(data.target) as BackendTarget | null) ?? null,
        result: readString(data.result),
        ...(error !== null ? { error } : {}),
      };
    });
};

export const buildActionSummaries = (
  traceEvents: TraceEvent[],
): ActionSummary[] => {
  const grouped = new Map<string, TraceEvent[]>();
  traceEvents.forEach((event) => {
    if (!grouped.has(event.correlationId)) {
      grouped.set(event.correlationId, []);
    }
    grouped.get(event.correlationId)?.push(event);
  });

  const summaries: ActionSummary[] = [];

  grouped.forEach((events, correlationId) => {
    const ordered = [...events].sort((a, b) => a.relativeMs - b.relativeMs);
    const actionStart = ordered.find((event) => event.type === "action-start");
    const actionEnd = ordered.find((event) => event.type === "action-end");
    const startRelativeBoundary = actionStart?.relativeMs ?? null;
    const endRelativeBoundary = actionEnd?.relativeMs ?? null;
    const scoped = ordered.filter((event) => {
      if (
        startRelativeBoundary !== null &&
        event.relativeMs < startRelativeBoundary
      )
        return false;
      if (
        endRelativeBoundary !== null &&
        event.relativeMs > endRelativeBoundary
      )
        return false;
      return true;
    });
    const errorEvents = scoped.filter((event) => event.type === "error");
    const startRelativeMs =
      actionStart?.relativeMs ?? ordered[0]?.relativeMs ?? 0;
    const endRelativeMs =
      actionEnd?.relativeMs ??
      ordered[ordered.length - 1]?.relativeMs ??
      startRelativeMs;
    const isComplete = Boolean(actionStart && actionEnd);
    const status = readString(actionEnd?.data?.status);
    const outcome = resolveOutcome(status, isComplete);
    const originalOrigin =
      actionStart?.origin ?? actionEnd?.origin ?? ordered[0]?.origin ?? null;
    const origin = resolveSummaryOrigin(originalOrigin);
    const restEffects = resolveRestEffects(scoped, actionEnd);
    const ftpEffects = resolveFtpEffects(scoped);
    const errorEffects = resolveErrorEffects(errorEvents, actionEnd);
    const effects = [...restEffects, ...ftpEffects, ...errorEffects];
    const errorMessage = resolveActionError(actionEnd, errorEvents);
    const restCount = restEffects.length;
    const ftpCount = ftpEffects.length;
    const errorCount = errorEffects.length;

    const startTimestamp =
      actionStart?.timestamp ?? ordered[0]?.timestamp ?? null;
    const endTimestamp =
      actionEnd?.timestamp ?? ordered[ordered.length - 1]?.timestamp ?? null;
    const { durationMs, durationMsMissing } = resolveDurationMs(
      startTimestamp,
      endTimestamp,
      ordered,
      startRelativeMs,
      endRelativeMs,
    );

    const startData = actionStart?.data as Record<string, unknown> | undefined;
    const trigger =
      (startData?.trigger as ActionTrigger | null | undefined) ?? undefined;

    summaries.push({
      correlationId,
      actionName: resolveActionName(actionStart, correlationId),
      origin,
      ...(originalOrigin && originalOrigin !== origin
        ? { originalOrigin }
        : {}),
      ...(trigger ? { trigger } : {}),
      startTimestamp,
      endTimestamp,
      durationMs,
      ...(durationMsMissing ? { durationMsMissing: true } : {}),
      outcome,
      ...(errorMessage ? { errorMessage } : {}),
      ...(restCount > 0 ? { restCount } : {}),
      ...(ftpCount > 0 ? { ftpCount } : {}),
      ...(errorCount > 0 ? { errorCount } : {}),
      ...(effects.length > 0 ? { effects } : {}),
      startRelativeMs,
    });
  });

  return summaries.sort((a, b) => {
    if (a.startRelativeMs !== b.startRelativeMs)
      return a.startRelativeMs - b.startRelativeMs;
    return a.correlationId.localeCompare(b.correlationId);
  });
};
