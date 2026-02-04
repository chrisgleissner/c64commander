import type { BackendTarget, TraceEvent, TraceOrigin } from '@/lib/tracing/types';

export type ActionSummaryOrigin = 'user' | 'system';
export type ActionSummaryOutcome = 'success' | 'error' | 'blocked' | 'timeout' | 'incomplete';

export type RestEffect = {
  type: 'REST';
  method: string;
  path: string;
  target: BackendTarget | null;
  status: number | string | null;
  durationMs: number | null;
  error?: string;
};

export type FtpEffect = {
  type: 'FTP';
  operation: string;
  path: string;
  target: BackendTarget | null;
  result: string | null;
  error?: string;
};

export type ActionSummaryEffect = RestEffect | FtpEffect;

export type ActionSummary = {
  correlationId: string;
  actionName: string;
  origin: ActionSummaryOrigin;
  originalOrigin?: TraceOrigin;
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

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const readNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const resolveSummaryOrigin = (origin: TraceOrigin | null): ActionSummaryOrigin => (origin === 'user' ? 'user' : 'system');

const resolveOutcome = (status: string | null, isComplete: boolean): ActionSummaryOutcome => {
  if (!isComplete) return 'incomplete';
  switch (status) {
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'blocked':
      return 'blocked';
    case 'timeout':
      return 'timeout';
    default:
      return 'incomplete';
  }
};

const resolveActionName = (actionStart: TraceEvent | undefined, correlationId: string): string => {
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
    if (event.type !== 'rest-response' && event.type !== 'ftp-operation') return latest;
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

  if (Number.isFinite(startRelativeMs) && Number.isFinite(endRelativeMs) && endRelativeMs >= startRelativeMs) {
    return { durationMs: endRelativeMs - startRelativeMs, durationMsMissing: false };
  }

  return { durationMs: null, durationMsMissing: true };
};

const resolveActionError = (actionEnd: TraceEvent | undefined, errorEvents: TraceEvent[]): string | null => {
  const endError = readString(actionEnd?.data?.error);
  if (endError) return endError;
  const errorMessage = readString(errorEvents[0]?.data?.message);
  return errorMessage ?? null;
};

const resolveRestEffects = (events: TraceEvent[], actionEnd: TraceEvent | undefined): RestEffect[] => {
  const restEffects: RestEffect[] = [];
  const pendingRequests: TraceEvent[] = [];
  const endStatus = readString(actionEnd?.data?.status);
  const endError = readString(actionEnd?.data?.error);

  events.forEach((event) => {
    if (event.type === 'rest-request') {
      pendingRequests.push(event);
      return;
    }
    if (event.type === 'rest-response') {
      const request = pendingRequests.shift();
      if (!request) return;
      const requestData = request.data as Record<string, unknown>;
      const responseData = event.data as Record<string, unknown>;
      const error = readString(responseData.error) ?? (responseData.error ? String(responseData.error) : null);
      restEffects.push({
        type: 'REST',
        method: readString(requestData.method) ?? 'UNKNOWN',
        path: readString(requestData.normalizedUrl) ?? readString(requestData.url) ?? 'unknown',
        target: (readString(requestData.target) as BackendTarget | null) ?? null,
        status: readNumber(responseData.status) ?? (endStatus ?? null),
        durationMs: readNumber(responseData.durationMs),
        ...(error !== null ? { error } : {}),
      });
    }
  });

  pendingRequests.forEach((request) => {
    const requestData = request.data as Record<string, unknown>;
    restEffects.push({
      type: 'REST',
      method: readString(requestData.method) ?? 'UNKNOWN',
      path: readString(requestData.normalizedUrl) ?? readString(requestData.url) ?? 'unknown',
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
    .filter((event) => event.type === 'ftp-operation')
    .map((event) => {
      const data = event.data as Record<string, unknown>;
      const error = readString(data.error);
      return {
        type: 'FTP',
        operation: readString(data.operation) ?? 'unknown',
        path: readString(data.path) ?? 'unknown',
        target: (readString(data.target) as BackendTarget | null) ?? null,
        result: readString(data.result),
        ...(error !== null ? { error } : {}),
      };
    });
};

export const buildActionSummaries = (traceEvents: TraceEvent[]): ActionSummary[] => {
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
    const actionStart = ordered.find((event) => event.type === 'action-start');
    const actionEnd = ordered.find((event) => event.type === 'action-end');
    const errorEvents = ordered.filter((event) => event.type === 'error');
    const restRequests = ordered.filter((event) => event.type === 'rest-request');
    const ftpOperations = ordered.filter((event) => event.type === 'ftp-operation');
    const startRelativeMs = actionStart?.relativeMs ?? ordered[0]?.relativeMs ?? 0;
    const endRelativeMs = actionEnd?.relativeMs ?? ordered[ordered.length - 1]?.relativeMs ?? startRelativeMs;
    const isComplete = Boolean(actionStart && actionEnd);
    const status = readString(actionEnd?.data?.status);
    const outcome = resolveOutcome(status, isComplete);
    const originalOrigin = actionStart?.origin ?? actionEnd?.origin ?? ordered[0]?.origin ?? null;
    const origin = resolveSummaryOrigin(originalOrigin);
    const errorCount = errorEvents.length > 0 ? errorEvents.length : status === 'error' ? 1 : 0;

    const restEffects = resolveRestEffects(ordered, actionEnd);
    const ftpEffects = resolveFtpEffects(ordered);
    const effects = [...restEffects, ...ftpEffects];
    const errorMessage = resolveActionError(actionEnd, errorEvents);
    const restCount = restRequests.length;
    const ftpCount = ftpOperations.length;

    const startTimestamp = actionStart?.timestamp ?? ordered[0]?.timestamp ?? null;
    const endTimestamp = actionEnd?.timestamp ?? ordered[ordered.length - 1]?.timestamp ?? null;
    const { durationMs, durationMsMissing } = resolveDurationMs(
      startTimestamp,
      endTimestamp,
      ordered,
      startRelativeMs,
      endRelativeMs,
    );

    summaries.push({
      correlationId,
      actionName: resolveActionName(actionStart, correlationId),
      origin,
      ...(originalOrigin && originalOrigin !== origin ? { originalOrigin } : {}),
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
    if (a.startRelativeMs !== b.startRelativeMs) return a.startRelativeMs - b.startRelativeMs;
    return a.correlationId.localeCompare(b.correlationId);
  });
};
