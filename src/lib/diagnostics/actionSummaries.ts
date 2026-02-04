import type { BackendTarget, TraceEvent, TraceOrigin } from '@/lib/tracing/types';

export type ActionSummaryOrigin = 'HUMAN' | 'MACHINE';
export type ActionSummaryOutcome = 'SUCCESS' | 'ERROR' | 'BLOCKED' | 'TIMEOUT' | 'INCOMPLETE';

export type RestEffect = {
  type: 'REST';
  method: string;
  path: string;
  target: BackendTarget | null;
  status: number | string | null;
  durationMs: number | null;
  error: string | null;
};

export type FtpEffect = {
  type: 'FTP';
  operation: string;
  path: string;
  target: BackendTarget | null;
  result: string | null;
  error: string | null;
};

export type ActionSummaryEffect = RestEffect | FtpEffect;

export type ActionSummary = {
  correlationId: string;
  actionName: string;
  summaryOrigin: ActionSummaryOrigin;
  originalOrigin: TraceOrigin | null;
  startTimestamp: string | null;
  endTimestamp: string | null;
  durationMs: number | null;
  outcome: ActionSummaryOutcome;
  errorMessage: string | null;
  restCount: number;
  ftpCount: number;
  errorCount: number;
  effects: ActionSummaryEffect[];
  startRelativeMs: number;
};

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const readNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const resolveSummaryOrigin = (origin: TraceOrigin | null): ActionSummaryOrigin => (origin === 'user' ? 'HUMAN' : 'MACHINE');

const resolveOutcome = (status: string | null, isComplete: boolean): ActionSummaryOutcome => {
  if (!isComplete) return 'INCOMPLETE';
  switch (status) {
    case 'success':
      return 'SUCCESS';
    case 'error':
      return 'ERROR';
    case 'blocked':
      return 'BLOCKED';
    case 'timeout':
      return 'TIMEOUT';
    default:
      return 'INCOMPLETE';
  }
};

const resolveActionName = (actionStart: TraceEvent | undefined, correlationId: string): string => {
  const name = readString(actionStart?.data?.name);
  return name ?? `Action ${correlationId}`;
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
      restEffects.push({
        type: 'REST',
        method: readString(requestData.method) ?? 'UNKNOWN',
        path: readString(requestData.normalizedUrl) ?? readString(requestData.url) ?? 'unknown',
        target: (readString(requestData.target) as BackendTarget | null) ?? null,
        status: readNumber(responseData.status) ?? (endStatus ?? null),
        durationMs: readNumber(responseData.durationMs),
        error: readString(responseData.error) ?? (responseData.error ? String(responseData.error) : null),
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
      error: endError ?? null,
    });
  });

  return restEffects;
};

const resolveFtpEffects = (events: TraceEvent[]): FtpEffect[] => {
  return events
    .filter((event) => event.type === 'ftp-operation')
    .map((event) => {
      const data = event.data as Record<string, unknown>;
      return {
        type: 'FTP',
        operation: readString(data.operation) ?? 'unknown',
        path: readString(data.path) ?? 'unknown',
        target: (readString(data.target) as BackendTarget | null) ?? null,
        result: readString(data.result),
        error: readString(data.error) ?? null,
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
    const summaryOrigin = resolveSummaryOrigin(originalOrigin);
    const errorCount = errorEvents.length > 0 ? errorEvents.length : status === 'error' ? 1 : 0;

    const restEffects = resolveRestEffects(ordered, actionEnd);
    const ftpEffects = resolveFtpEffects(ordered);

    summaries.push({
      correlationId,
      actionName: resolveActionName(actionStart, correlationId),
      summaryOrigin,
      originalOrigin,
      startTimestamp: actionStart?.timestamp ?? ordered[0]?.timestamp ?? null,
      endTimestamp: actionEnd?.timestamp ?? ordered[ordered.length - 1]?.timestamp ?? null,
      durationMs: endRelativeMs >= startRelativeMs ? endRelativeMs - startRelativeMs : null,
      outcome,
      errorMessage: resolveActionError(actionEnd, errorEvents),
      restCount: restRequests.length,
      ftpCount: ftpOperations.length,
      errorCount,
      effects: [...restEffects, ...ftpEffects],
      startRelativeMs,
    });
  });

  return summaries.sort((a, b) => {
    if (a.startRelativeMs !== b.startRelativeMs) return a.startRelativeMs - b.startRelativeMs;
    return a.correlationId.localeCompare(b.correlationId);
  });
};
