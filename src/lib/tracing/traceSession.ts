import { zipSync, strToU8 } from 'fflate';
import { getTraceContextSnapshot } from '@/lib/tracing/traceContext';
import { redactHeaders, redactPayload, redactErrorMessage } from '@/lib/tracing/redaction';
import type {
  TraceEvent,
  TraceEventType,
  TraceOrigin,
  TraceActionContext,
  BackendTarget,
  BackendDecisionReason,
} from '@/lib/tracing/types';
import { resolveBackendTarget } from '@/lib/tracing/traceTargets';
import { getPlatform } from '@/lib/native/platform';
import { nextTraceEventId, resetTraceIds } from '@/lib/tracing/traceIds';

const RETENTION_WINDOW_MS = 30 * 60 * 1000;
const MAX_EVENT_COUNT = 100_000;

let sessionStartMs = Date.now();
let events: TraceEvent[] = [];
const decisionByCorrelation = new Set<string>();
let errorOnce = new WeakSet<Error>();
let lastExport: { reason: string; timestamp: string; data: Uint8Array } | null = null;

const evictExpired = (nowMs: number) => {
  const threshold = nowMs - RETENTION_WINDOW_MS;
  events = events.filter((event) => {
    const eventMs = Date.parse(event.timestamp);
    return Number.isNaN(eventMs) || eventMs >= threshold;
  });
};

const appendEvent = <T extends Record<string, unknown>>(
  type: TraceEventType,
  origin: TraceOrigin,
  correlationId: string,
  data: T,
) => {
  const nowMs = Date.now();
  evictExpired(nowMs);
  const event: TraceEvent<T> = {
    id: nextTraceEventId(),
    timestamp: new Date(nowMs).toISOString(),
    relativeMs: nowMs - sessionStartMs,
    type,
    origin,
    correlationId,
    data,
  };
  events = [...events, event];
  if (events.length > MAX_EVENT_COUNT) {
    events = events.slice(events.length - MAX_EVENT_COUNT);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('c64u-traces-updated'));
  }
};

const emitBackendDecision = (origin: TraceOrigin, correlationId: string, target: BackendTarget, reason: BackendDecisionReason) => {
  if (decisionByCorrelation.has(correlationId)) return;
  decisionByCorrelation.add(correlationId);
  appendEvent('backend-decision', origin, correlationId, {
    selectedTarget: target,
    reason,
  });
};

export const getTraceEvents = () => [...events];

export const clearTraceEvents = () => {
  events = [];
  decisionByCorrelation.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('c64u-traces-updated'));
  }
};

export const resetTraceSession = (eventStart = 0, correlationStart = 0) => {
  events = [];
  decisionByCorrelation.clear();
  errorOnce = new WeakSet<Error>();
  lastExport = null;
  sessionStartMs = Date.now();
  resetTraceIds(eventStart, correlationStart);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('c64u-traces-updated'));
  }
};

export const recordActionStart = (action: TraceActionContext) => {
  const context = getTraceContextSnapshot();
  appendEvent('action-start', action.origin, action.correlationId, {
    name: action.name,
    component: action.componentName ?? null,
    context: redactPayload(context),
  });
};

export const recordActionEnd = (action: TraceActionContext, error?: Error | null) => {
  appendEvent('action-end', action.origin, action.correlationId, {
    status: error ? 'error' : 'success',
    error: error ? redactErrorMessage(error.message) : null,
  });
};

export const recordActionScopeStart = (action: TraceActionContext, name: string) => {
  appendEvent('action-scope-start', action.origin, action.correlationId, { name });
};

export const recordActionScopeEnd = (action: TraceActionContext, name: string, error?: Error | null) => {
  appendEvent('action-scope-end', action.origin, action.correlationId, {
    name,
    status: error ? 'error' : 'success',
    error: error ? redactErrorMessage(error.message) : null,
  });
};

export const recordRestRequest = (action: TraceActionContext, payload: {
  method: string;
  url: string;
  normalizedUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}) => {
  const { target, reason } = resolveBackendTarget(payload.url);
  emitBackendDecision(action.origin, action.correlationId, target, reason);
  appendEvent('rest-request', action.origin, action.correlationId, {
    method: payload.method,
    url: payload.url,
    normalizedUrl: payload.normalizedUrl,
    headers: redactHeaders(payload.headers),
    body: redactPayload(payload.body ?? null),
    target,
  });
};

export const recordRestResponse = (action: TraceActionContext, payload: {
  status: number | null;
  body: unknown;
  durationMs: number;
  error: Error | null;
  errorMessage?: string | null;
}) => {
  const errorMessage = payload.errorMessage ?? (payload.error ? payload.error.message : null);
  appendEvent('rest-response', action.origin, action.correlationId, {
    status: payload.status,
    body: redactPayload(payload.body ?? null),
    durationMs: payload.durationMs,
    error: errorMessage ? redactErrorMessage(errorMessage) : null,
  });
};

export const recordFtpOperation = (action: TraceActionContext, payload: {
  operation: string;
  path: string;
  result: 'success' | 'failure';
  error: Error | null;
}) => {
  const { target, reason } = resolveBackendTarget(null);
  emitBackendDecision(action.origin, action.correlationId, target, reason);
  appendEvent('ftp-operation', action.origin, action.correlationId, {
    operation: payload.operation,
    path: payload.path,
    result: payload.result,
    error: payload.error ? redactErrorMessage(payload.error.message) : null,
    target,
  });
};

export const recordTraceError = (action: TraceActionContext, error: Error) => {
  if (errorOnce.has(error)) return;
  errorOnce.add(error);
  appendEvent('error', action.origin, action.correlationId, {
    message: redactErrorMessage(error.message),
    name: error.name,
  });
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      try {
        const data = exportTraceZip();
        lastExport = { reason: 'error', timestamp: new Date().toISOString(), data };
        window.dispatchEvent(new CustomEvent('c64u-trace-exported', { detail: { reason: 'error' } }));
      } catch {
        // ignore export failures
      }
    }, 0);
  }
};

export const buildAppMetadata = () => {
  return {
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '',
    gitSha: typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : '',
    buildTime: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '',
    platform: getPlatform(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
};

export const exportTraceZip = () => {
  const traceJson = JSON.stringify(getTraceEvents(), null, 2);
  const metadataJson = JSON.stringify(buildAppMetadata(), null, 2);
  const data = zipSync({
    'trace.json': strToU8(traceJson),
    'app-metadata.json': strToU8(metadataJson),
  });
  lastExport = { reason: 'manual', timestamp: new Date().toISOString(), data };
  return data;
};

export const getLastTraceExport = () => lastExport;

export const TRACE_SESSION = {
  RETENTION_WINDOW_MS,
  MAX_EVENT_COUNT,
};
