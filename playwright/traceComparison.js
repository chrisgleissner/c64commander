import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const VOLATILE_KEY_PATTERN = /^(timestamp|relativeMs|relative_ms|durationMs|duration_ms|elapsedMs|elapsed_ms|timeMs|time_ms|timingMs|timing_ms)$/i;
const TRACE_ID_PATTERN = /^(EVT|COR)-\d{4}$/;
const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright');
const defaultGoldenRoot = path.resolve(process.cwd(), 'playwright', 'fixtures', 'traces', 'golden');
const legacyGoldenRoot = path.resolve(process.cwd(), 'test-results', 'traces', 'golden');

const sanitizeSegment = (value) => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'untitled';
};

const normalizeUrl = (value) => {
  if (!value || typeof value !== 'string') return value;
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value.replace(/https?:\/\/[^/]+/i, '');
  }
};

const normalizeHeaders = (headers) => {
  if (!headers || typeof headers !== 'object') return headers;
  const normalized = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (/host/i.test(key)) {
      normalized[key] = '***';
      return;
    }
    normalized[key] = value;
  });
  return normalized;
};

const normalizeHostLikeString = (value) => {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return value;
  let normalized = value;
  normalized = normalized.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '***');
  normalized = normalized.replace(/\b[a-z0-9.-]+:\d+\b/gi, '***');
  if (/^\*\*\*$/.test(normalized)) return normalized;
  return normalized;
};

const normalizeHostLike = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return '***';
  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) return '***';
  if (/^[a-z0-9.-]+$/i.test(trimmed) && trimmed.includes('.')) return '***';
  return normalizeHostLikeString(value);
};

const normalizePayload = (value) => {
  if (Array.isArray(value)) return value.map((entry) => normalizePayload(entry));
  if (value && typeof value === 'object') {
    const normalized = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (VOLATILE_KEY_PATTERN.test(key)) {
        return;
      }
      if (/port/i.test(key)) {
        normalized[key] = '***';
        return;
      }
      if (/(\bvol\b|volume)/i.test(key)) {
        normalized[key] = '***VOL';
        return;
      }
      if (/host|hostname|ip|address/i.test(key)) {
        normalized[key] = normalizeHostLike(entry);
        return;
      }
      normalized[key] = normalizePayload(entry);
    });
    return normalized;
  }
  if (typeof value === 'string') return normalizeHostLikeString(value);
  return normalizeHostLike(value);
};

const normalizeEventData = (data) => {
  if (!data || typeof data !== 'object') return data;
  const normalized = normalizePayload(data);
  if (normalized && typeof normalized === 'object') {
    if (typeof normalized.url === 'string') normalized.url = normalizeUrl(normalized.url);
    if (typeof normalized.normalizedUrl === 'string') normalized.normalizedUrl = normalizeUrl(normalized.normalizedUrl);
    if (normalized.headers) normalized.headers = normalizeHeaders(normalized.headers);
    if ('durationMs' in normalized) delete normalized.durationMs;
  }
  return normalized;
};

const deepPartialMatch = (expected, actual) => {
  if (expected === undefined) return true;
  if (expected === null || typeof expected !== 'object') {
    return Object.is(expected, actual);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    const used = new Array(actual.length).fill(false);
    return expected.every((entry) => {
      const index = actual.findIndex((candidate, idx) => !used[idx] && deepPartialMatch(entry, candidate));
      if (index === -1) return false;
      used[index] = true;
      return true;
    });
  }
  if (!actual || typeof actual !== 'object') return false;
  return Object.keys(expected).every((key) => deepPartialMatch(expected[key], actual[key]));
};

const extractActionName = (event) => {
  if (!event || typeof event !== 'object') return 'unknown';
  if (event.type !== 'action-start') return 'unknown';
  const data = event.data;
  if (data && typeof data.name === 'string' && data.name.trim()) return data.name.trim();
  return 'unknown';
};

const extractActions = (events) => {
  const actions = new Map();
  const order = [];

  events.forEach((event) => {
    const correlationId = typeof event.correlationId === 'string' ? event.correlationId : 'unknown';
    if (!actions.has(correlationId)) {
      actions.set(correlationId, {
        correlationId,
        name: 'unknown',
        restCalls: [],
        ftpOps: [],
        pendingRequests: [],
      });
      order.push(correlationId);
    }
    const entry = actions.get(correlationId);

    if (event.type === 'action-start' && entry.name === 'unknown') {
      entry.name = extractActionName(event);
    }

    if (event.type === 'rest-request') {
      const data = normalizeEventData(event.data ?? {});
      const method = typeof data?.method === 'string' ? data.method.toUpperCase() : 'GET';
      const url = typeof data?.normalizedUrl === 'string'
        ? data.normalizedUrl
        : typeof data?.url === 'string'
          ? data.url
          : '';
      entry.pendingRequests.push({
        method,
        url,
        body: normalizePayload(data?.body),
        target: typeof data?.target === 'string' ? data.target : undefined,
      });
    }

    if (event.type === 'rest-response') {
      const data = normalizeEventData(event.data ?? {});
      const status = typeof data?.status === 'number' ? data.status : undefined;
      const responseBody = normalizePayload(data?.body);
      const request = entry.pendingRequests.shift();
      entry.restCalls.push({
        method: request?.method ?? 'UNKNOWN',
        url: request?.url ?? '',
        status,
        requestBody: request?.body,
        responseBody,
        target: request?.target,
      });
    }

    if (event.type === 'ftp-operation') {
      const data = normalizeEventData(event.data ?? {});
      entry.ftpOps.push({
        operation: typeof data?.operation === 'string' ? data.operation : 'unknown',
        path: typeof data?.path === 'string' ? data.path : '',
        result: typeof data?.result === 'string' ? data.result : 'unknown',
        error: data?.error ?? null,
      });
    }
  });

  return order.map((correlationId) => {
    const entry = actions.get(correlationId);
    return {
      correlationId,
      name: entry.name,
      restCalls: entry.restCalls,
      ftpOps: entry.ftpOps,
    };
  });
};

const formatRestCall = (call) => {
  const url = call.url || 'unknown-url';
  const status = call.status !== undefined ? ` ${call.status}` : '';
  return `${call.method} ${url}${status}`;
};

const matchRestCall = (expected, actual) => {
  if (expected.method !== actual.method) return false;
  if (expected.url !== actual.url) return false;
  if (expected.status !== undefined && expected.status !== actual.status) return false;
  if (!deepPartialMatch(expected.requestBody, actual.requestBody)) return false;
  if (!deepPartialMatch(expected.responseBody, actual.responseBody)) return false;
  return true;
};

const matchFtpOp = (expected, actual) => {
  if (expected.operation !== actual.operation) return false;
  if (expected.path !== actual.path) return false;
  if (expected.result !== actual.result) return false;
  if (expected.error && !deepPartialMatch(expected.error, actual.error)) return false;
  return true;
};

const filterEssentialActions = (actions) =>
  actions.filter((action) => action.restCalls.length > 0 || action.ftpOps.length > 0);

// Demo/connection discovery can issue variable GET polling; compare at least one per unique signature.
const isNoisyGetAction = (action) => {
  if (action.name !== 'rest.get') return false;
  if (!action.restCalls.length || action.ftpOps.length) return false;
  return action.restCalls.every((call) =>
    call.method === 'GET'
    && typeof call.url === 'string'
    && (
      call.url.startsWith('/v1/info')
      || call.url.startsWith('/v1/drives')
      || call.url.startsWith('/v1/configs/')
    ));
};

const getActionSignature = (action, options = {}) => {
  const restCalls = options.ignoreTarget
    ? action.restCalls.map(({ target, ...call }) => call)
    : action.restCalls;
  return JSON.stringify({
    name: action.name,
    restCalls,
    ftpOps: action.ftpOps,
  });
};

const collapseNoisyActions = (actions) => {
  const result = [];
  const seen = new Set();
  actions.forEach((action) => {
    if (!isNoisyGetAction(action)) {
      result.push(action);
      return;
    }
    const signature = getActionSignature(action, { ignoreTarget: true });
    if (seen.has(signature)) return;
    seen.add(signature);
    result.push(action);
  });
  return result;
};

const compareActionSets = (expectedActions, actualActions) => {
  const errors = [];
  const used = new Array(actualActions.length).fill(false);

  expectedActions.forEach((expectedAction) => {
    const index = actualActions.findIndex((candidate, idx) => {
      if (used[idx]) return false;
      if (candidate.name !== expectedAction.name) return false;

      const remainingRest = [...candidate.restCalls];
      const remainingFtp = [...candidate.ftpOps];

      const restOk = expectedAction.restCalls.every((call) => {
        const matchIdx = remainingRest.findIndex((actual) => matchRestCall(call, actual));
        if (matchIdx === -1) return false;
        remainingRest.splice(matchIdx, 1);
        return true;
      });
      if (!restOk) return false;

      const ftpOk = expectedAction.ftpOps.every((op) => {
        const matchIdx = remainingFtp.findIndex((actual) => matchFtpOp(op, actual));
        if (matchIdx === -1) return false;
        remainingFtp.splice(matchIdx, 1);
        return true;
      });

      return ftpOk;
    });

    if (index === -1) {
      const restSummary = expectedAction.restCalls.map(formatRestCall).join(', ');
      errors.push(`Missing matching action: ${expectedAction.name}${restSummary ? ` (${restSummary})` : ''}`);
      return;
    }
    used[index] = true;
  });

  return errors;
};

const validateTraceIds = (events) => {
  const errors = [];
  const seen = new Set();
  events.forEach((event) => {
    if (typeof event.id === 'string') {
      if (!TRACE_ID_PATTERN.test(event.id)) {
        errors.push(`Invalid trace id format: ${event.id}`);
      } else if (seen.has(event.id)) {
        errors.push(`Duplicate trace id: ${event.id}`);
      }
      seen.add(event.id);
    }
    if (typeof event.correlationId === 'string' && !TRACE_ID_PATTERN.test(event.correlationId)) {
      errors.push(`Invalid correlationId format: ${event.correlationId}`);
    }
  });
  return errors;
};

export const resolveGoldenRoot = () => {
  if (process.env.TRACE_GOLDEN_DIR) {
    return path.resolve(process.env.TRACE_GOLDEN_DIR);
  }
  if (fs.existsSync(defaultGoldenRoot)) return defaultGoldenRoot;
  return legacyGoldenRoot;
};

export const resolveGoldenDirForEvidence = (evidenceDir) => {
  const suite = process.env.TRACE_SUITE ? sanitizeSegment(process.env.TRACE_SUITE) : null;
  const root = resolveGoldenRoot();
  const relative = path.relative(evidenceRoot, evidenceDir);
  const base = suite ? path.join(root, suite) : root;
  return path.join(base, relative);
};

export const compareTracesEssential = (expectedEvents, actualEvents) => {
  const errors = [];

  if (!Array.isArray(expectedEvents) || !Array.isArray(actualEvents)) {
    errors.push('Trace payload is not a valid array.');
    return errors;
  }

  errors.push(...validateTraceIds(actualEvents));

  const expectedActions = collapseNoisyActions(filterEssentialActions(extractActions(expectedEvents)));
  const actualActions = collapseNoisyActions(filterEssentialActions(extractActions(actualEvents)));

  errors.push(...compareActionSets(expectedActions, actualActions));

  return errors;
};

export const compareTraceFiles = async (goldenDir, evidenceDir) => {
  const goldenPath = path.join(goldenDir, 'trace.json');
  const evidencePath = path.join(evidenceDir, 'trace.json');

  const [goldenRaw, evidenceRaw] = await Promise.all([
    fsp.readFile(goldenPath, 'utf8'),
    fsp.readFile(evidencePath, 'utf8'),
  ]);

  const golden = JSON.parse(goldenRaw);
  const evidence = JSON.parse(evidenceRaw);

  return compareTracesEssential(golden, evidence);
};

export const formatTraceErrors = (errors, context) => {
  if (!errors.length) return '';
  const header = context ? `Trace comparison failed for ${context}` : 'Trace comparison failed';
  return `${header}:\n${errors.join('\n')}`;
};
