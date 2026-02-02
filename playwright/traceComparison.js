import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const VOLATILE_KEY_PATTERN = /^(timestamp|relativeMs|relative_ms|durationMs|duration_ms|elapsedMs|elapsed_ms|timeMs|time_ms|timingMs|timing_ms)$/i;
const TRACE_ID_PATTERN = /^(EVT|COR)-\d{4,}$/;
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
    const params = Array.from(parsed.searchParams.entries())
      .map(([key, val]) => [key, val])
      .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    const normalizedSearch = params.length
      ? `?${params.map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join('&')}`
      : '';
    return `${parsed.pathname}${normalizedSearch}`;
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

const normalizePathLikeString = (value) => {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return value;
  return value
    .replace(/\b[a-zA-Z]:\\[^\s"']+/g, '***')
    .replace(/\/(?:Users|home|runner|workspace|tmp|var)\/[^\s"']+/g, '***/***')
    .replace(/\\(?:Users|home|runner|workspace|tmp|var)\\[^\s"']+/g, '***\\***');
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
      if (/trace|session|correlation|request/i.test(key) && /id$/i.test(key)) {
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
  if (typeof value === 'string') return normalizePathLikeString(normalizeHostLikeString(value));
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

const sortEvents = (events) =>
  events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const aMs = typeof a.event?.relativeMs === 'number' ? a.event.relativeMs : null;
      const bMs = typeof b.event?.relativeMs === 'number' ? b.event.relativeMs : null;
      if (aMs !== null && bMs !== null && aMs !== bMs) return aMs - bMs;
      const aTs = a.event?.timestamp ? Date.parse(a.event.timestamp) : null;
      const bTs = b.event?.timestamp ? Date.parse(b.event.timestamp) : null;
      if (aTs !== null && bTs !== null && aTs !== bTs) return aTs - bTs;
      return a.index - b.index;
    });

const extractActionName = (event) => {
  if (!event || typeof event !== 'object') return 'unknown';
  if (event.type !== 'action-start') return 'unknown';
  const data = event.data;
  if (data && typeof data.name === 'string' && data.name.trim()) return data.name.trim();
  return 'unknown';
};

const extractUserActionGroups = (events) => {
  const sorted = sortEvents(events);
  const userStarts = sorted.filter(({ event }) => event.type === 'action-start' && event.origin === 'user');
  if (!userStarts.length) return [];
  const nonGlobalUserStarts = userStarts.filter(({ event }) => event?.data?.component !== 'GlobalInteraction');
  const effectiveStarts = nonGlobalUserStarts.length ? nonGlobalUserStarts : userStarts;

  const groups = [];
  for (let i = 0; i < effectiveStarts.length; i += 1) {
    const startEntry = effectiveStarts[i];
    const endIndex = i + 1 < effectiveStarts.length ? effectiveStarts[i + 1].index - 1 : sorted[sorted.length - 1].index;
    const groupEvents = sorted.filter(({ index }) => index >= startEntry.index && index <= endIndex);
    const restRequests = [];
    const ftpOps = [];
    const restIndices = [];
    const ftpIndices = [];
    let actionEndIndex = null;

    groupEvents.forEach(({ event, index }) => {
      if (event.type === 'action-end' && event.correlationId === startEntry.event.correlationId) {
        actionEndIndex = index;
      }
      if (event.type === 'rest-request') {
        const data = normalizeEventData(event.data ?? {});
        const method = typeof data?.method === 'string' ? data.method.toUpperCase() : 'GET';
        const url = typeof data?.normalizedUrl === 'string'
          ? data.normalizedUrl
          : typeof data?.url === 'string'
            ? data.url
            : '';
        const request = {
          method,
          url,
          body: normalizePayload(data?.body),
          target: typeof data?.target === 'string' ? data.target : undefined,
        };
        if (!isNoisyRestCall(request)) {
          restRequests.push(request);
          restIndices.push(index);
        }
      }
      if (event.type === 'rest-response') {
        // user-origin grouping only considers requests; responses are ignored
      }
      if (event.type === 'ftp-operation') {
        const data = normalizeEventData(event.data ?? {});
        ftpOps.push({
          operation: typeof data?.operation === 'string' ? data.operation : 'unknown',
          path: typeof data?.path === 'string' ? data.path : '',
          result: typeof data?.result === 'string' ? data.result : 'unknown',
          error: data?.error ?? null,
        });
        ftpIndices.push(index);
      }
    });

    groups.push({
      correlationId: startEntry.event.correlationId ?? 'unknown',
      name: extractActionName(startEntry.event),
      restCalls: restRequests.map((request) => ({
        method: request.method,
        url: request.url || 'unknown-url',
        status: undefined,
        requestBody: request.body,
        responseBody: undefined,
        target: request.target,
      })),
      ftpOps,
      origin: 'user',
      actionStartIndex: startEntry.index,
      actionEndIndex,
      restIndices,
      ftpIndices,
    });
  }

  return groups;
};

const buildRestCalls = (requests, responses) => {
  const total = Math.max(requests.length, responses.length);
  const calls = [];
  for (let i = 0; i < total; i += 1) {
    const request = requests[i];
    const response = responses[i];
    calls.push({
      method: request?.method ?? 'UNKNOWN',
      url: request?.url ?? 'unknown-url',
      status: response?.status,
      requestBody: request?.body,
      responseBody: response?.body,
      target: request?.target,
    });
  }
  return calls;
};

const extractActions = (events) => {
  const actions = new Map();
  const order = [];

  sortEvents(events).forEach(({ event, index }) => {
    const correlationId = typeof event.correlationId === 'string' ? event.correlationId : 'unknown';
    if (!actions.has(correlationId)) {
      actions.set(correlationId, {
        correlationId,
        name: 'unknown',
        origin: 'system',
        actionStartIndex: null,
        actionEndIndex: null,
        restRequests: [],
        restResponses: [],
        ftpOps: [],
        restIndices: [],
        ftpIndices: [],
      });
      order.push(correlationId);
    }
    const entry = actions.get(correlationId);

    if (event.type === 'action-start' && entry.name === 'unknown') {
      entry.name = extractActionName(event);
      entry.actionStartIndex = index;
      if (typeof event.origin === 'string') {
        entry.origin = event.origin;
      }
    }

    if (event.type === 'action-end') {
      entry.actionEndIndex = index;
    }

    if (event.type === 'rest-request') {
      const data = normalizeEventData(event.data ?? {});
      const method = typeof data?.method === 'string' ? data.method.toUpperCase() : 'GET';
      const url = typeof data?.normalizedUrl === 'string'
        ? data.normalizedUrl
        : typeof data?.url === 'string'
          ? data.url
          : '';
      entry.restRequests.push({
        method,
        url,
        body: normalizePayload(data?.body),
        target: typeof data?.target === 'string' ? data.target : undefined,
      });
      entry.restIndices.push(index);
    }

    if (event.type === 'rest-response') {
      const data = normalizeEventData(event.data ?? {});
      const status = typeof data?.status === 'number' ? data.status : undefined;
      const responseBody = normalizePayload(data?.body);
      entry.restResponses.push({ status, body: responseBody });
      entry.restIndices.push(index);
    }

    if (event.type === 'ftp-operation') {
      const data = normalizeEventData(event.data ?? {});
      entry.ftpOps.push({
        operation: typeof data?.operation === 'string' ? data.operation : 'unknown',
        path: typeof data?.path === 'string' ? data.path : '',
        result: typeof data?.result === 'string' ? data.result : 'unknown',
        error: data?.error ?? null,
      });
      entry.ftpIndices.push(index);
    }
  });

  return order.map((correlationId) => {
    const entry = actions.get(correlationId);
    return {
      correlationId,
      name: entry.name,
      restCalls: buildRestCalls(entry.restRequests, entry.restResponses),
      ftpOps: entry.ftpOps,
      origin: entry.origin,
      actionStartIndex: entry.actionStartIndex,
      actionEndIndex: entry.actionEndIndex,
      restIndices: entry.restIndices,
      ftpIndices: entry.ftpIndices,
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
  if (isNoisyRestCall(expected) && isNoisyRestCall(actual)) return true;
  if (expected.status !== undefined && actual.status !== undefined && expected.status !== actual.status) return false;
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
      || call.url === '/v1/configs'
    ));
};

const isNoisyRestCall = (call) =>
  call.method === 'GET'
  && typeof call.url === 'string'
  && (
    call.url.startsWith('/v1/info')
    || call.url.startsWith('/v1/drives')
    || call.url.startsWith('/v1/configs')
  );

const isNoisyOnlyAction = (action) =>
  action.restCalls.length > 0
  && action.ftpOps.length === 0
  && action.restCalls.every((call) => isNoisyRestCall(call));

const filterEssentialActions = (actions) =>
  actions.filter((action) =>
    (action.restCalls.length > 0 || action.ftpOps.length > 0) && !isNoisyOnlyAction(action));

const normalizeNoisyRestCall = (call) => ({
  method: call.method,
  url: call.url,
});

const getActionCallsSignature = (action) =>
  JSON.stringify({
    restCalls: action.restCalls,
    ftpOps: action.ftpOps,
  });

const getActionRequestSignature = (action) =>
  JSON.stringify({
    restCalls: action.restCalls.map(({ status, responseBody, ...call }) => call),
    ftpOps: action.ftpOps,
  });

const dropSystemDuplicatesForUserCalls = (actions) => {
  const userSignatures = new Set();
  actions.forEach((action) => {
    if (action.origin === 'user') {
      userSignatures.add(getActionRequestSignature(action));
    }
  });
  if (!userSignatures.size) return actions;
  return actions.filter(
    (action) => !(action.origin !== 'user' && userSignatures.has(getActionRequestSignature(action))));
};

const getActionSignature = (action, options = {}) => {
  const restCallsBase = options.ignoreTarget
    ? action.restCalls.map(({ target, ...call }) => call)
    : action.restCalls;
  const restCalls = isNoisyGetAction(action)
    ? restCallsBase.map((call) => (isNoisyRestCall(call) ? normalizeNoisyRestCall(call) : call))
    : restCallsBase;
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

const formatActionSummary = (action) => {
  const restSummary = action.restCalls.map(formatRestCall).join(', ');
  const ftpSummary = action.ftpOps.map((op) => `${op.operation} ${op.path} ${op.result}`).join(', ');
  const details = [restSummary, ftpSummary].filter(Boolean).join(', ');
  return `${action.name}${details ? ` (${details})` : ''}`;
};

const buildExcerpt = (list, index, radius = 2) => {
  const start = Math.max(0, index - radius);
  const end = Math.min(list.length, index + radius + 1);
  return list.slice(start, end);
};

const checkOrderingConstraints = (actions) => {
  const violations = [];
  actions.forEach((action) => {
    const { actionStartIndex, actionEndIndex, restIndices, ftpIndices, name, origin } = action;
    const allIndices = [...restIndices, ...ftpIndices];
    if (actionStartIndex === null || actionEndIndex === null) return;
    const earliest = allIndices.length ? Math.min(...allIndices) : null;
    const latest = allIndices.length ? Math.max(...allIndices) : null;
    if (earliest !== null && actionStartIndex > earliest) {
      violations.push(`Ordering violation: ${name} action-start after downstream event.`);
    }
    if (origin !== 'user') {
      if (latest !== null && actionEndIndex < latest) {
        violations.push(`Ordering violation: ${name} action-end before downstream event.`);
      }
      if (actionStartIndex > actionEndIndex) {
        violations.push(`Ordering violation: ${name} action-start after action-end.`);
      }
    }
  });
  return violations;
};

const areActionNamesCompatible = (expected, actual) => {
  if (expected.name === actual.name) return true;
  if (expected.name === 'unknown' || actual.name === 'unknown') return true;
  if (expected.name.startsWith('rest.') && actual.name.startsWith('rest.')) return true;
  return false;
};

const shouldAllowNameMismatch = (expected, actual) => {
  if (expected.name === 'unknown' || actual.name === 'unknown') return true;
  if (expected.name.startsWith('rest.') || actual.name.startsWith('rest.')) return true;
  if (expected.origin === 'user' || actual.origin === 'user') return true;
  return false;
};

const getRestCallSignature = (call) => JSON.stringify({
  method: call.method,
  url: call.url,
  requestBody: call.requestBody,
  target: call.target,
});

const dedupeRestCalls = (calls) => {
  const seen = new Set();
  return calls.filter((call) => {
    const signature = getRestCallSignature(call);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

const compareActionSets = (expectedActions, actualActions) => {
  const errors = [];
  const used = new Array(actualActions.length).fill(false);
  const missing = [];
  const unexpected = [];
  const expectedSummaries = expectedActions.map(formatActionSummary);
  const actualSummaries = actualActions.map(formatActionSummary);

  const isActionEquivalent = (expectedAction, candidate) => {
    const remainingRest = dedupeRestCalls(candidate.restCalls).slice();
    const remainingFtp = [...candidate.ftpOps];

    const restOk = dedupeRestCalls(expectedAction.restCalls).every((call) => {
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
    if (!ftpOk) return false;

    if (areActionNamesCompatible(expectedAction, candidate)) return true;
    return shouldAllowNameMismatch(expectedAction, candidate);
  };

  expectedActions.forEach((expectedAction, expectedIndex) => {
    const index = actualActions.findIndex((candidate, idx) => {
      if (used[idx]) return false;
      return isActionEquivalent(expectedAction, candidate);
    });

    if (index === -1) {
      const reusedIndex = actualActions.findIndex((candidate, idx) =>
        used[idx] && isActionEquivalent(expectedAction, candidate));
      if (reusedIndex !== -1) {
        return;
      }
      const restSummary = expectedAction.restCalls.map(formatRestCall).join(', ');
      const message = `Missing matching action: ${expectedAction.name}${restSummary ? ` (${restSummary})` : ''}`;
      errors.push(message);
      missing.push({
        action: formatActionSummary(expectedAction),
        expectedIndex,
        expectedExcerpt: buildExcerpt(expectedSummaries, expectedIndex),
        actualExcerpt: buildExcerpt(actualSummaries, Math.max(0, actualSummaries.indexOf(expectedAction.name))),
      });
      return;
    }
    used[index] = true;
  });

  actualActions.forEach((actualAction, idx) => {
    if (used[idx]) return;
    unexpected.push({
      action: formatActionSummary(actualAction),
      actualIndex: idx,
      actualExcerpt: buildExcerpt(actualSummaries, idx),
    });
  });

  return {
    errors,
    missing,
    unexpected,
    expectedSummaries,
    actualSummaries,
  };
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
  // Keep comparison/promote aligned with recording output overrides.
  if (process.env.TRACE_OUTPUT_DIR) {
    return path.resolve(process.env.TRACE_OUTPUT_DIR);
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
  const diff = {
    missingActions: [],
    unexpectedActions: [],
    orderingViolations: [],
    expectedActions: [],
    actualActions: [],
  };

  if (!Array.isArray(expectedEvents) || !Array.isArray(actualEvents)) {
    errors.push('Trace payload is not a valid array.');
    return { errors, diff };
  }

  errors.push(...validateTraceIds(actualEvents));

  const expectedActions = collapseNoisyActions(filterEssentialActions(extractActions(expectedEvents)));
  const actualActions = collapseNoisyActions(filterEssentialActions(extractActions(actualEvents)));
  const expectedUserActions = collapseNoisyActions(filterEssentialActions(extractUserActionGroups(expectedEvents)));
  const actualUserActions = collapseNoisyActions(filterEssentialActions(extractUserActionGroups(actualEvents)));
  const useUserActions = expectedUserActions.length > 0 && actualUserActions.length > 0;

  const expectedActionsFinal = dropSystemDuplicatesForUserCalls(
    useUserActions ? expectedUserActions : expectedActions,
  );
  const actualActionsFinal = dropSystemDuplicatesForUserCalls(
    useUserActions ? actualUserActions : actualActions,
  );

  const orderingViolations = checkOrderingConstraints(actualActionsFinal);
  if (orderingViolations.length) {
    errors.push(...orderingViolations);
    diff.orderingViolations = orderingViolations;
  }

  const comparison = compareActionSets(expectedActionsFinal, actualActionsFinal);
  errors.push(...comparison.errors);
  diff.missingActions = comparison.missing;
  diff.unexpectedActions = comparison.unexpected;
  diff.expectedActions = comparison.expectedSummaries;
  diff.actualActions = comparison.actualSummaries;

  return { errors, diff };
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

export const compareOrPromoteTraceFiles = async (goldenDir, evidenceDir) => {
  const goldenPath = path.join(goldenDir, 'trace.json');
  const evidencePath = path.join(evidenceDir, 'trace.json');

  const goldenStat = await fsp.stat(goldenPath).catch(() => null);
  if (!goldenStat || !goldenStat.isFile()) {
    await fsp.mkdir(goldenDir, { recursive: true });
    await fsp.copyFile(evidencePath, goldenPath);
    return { promoted: true, errors: [], diff: null };
  }

  const result = await compareTraceFiles(goldenDir, evidenceDir);
  return { promoted: false, errors: result.errors, diff: result.diff };
};

export const formatTraceErrors = (errors, context, diff = null) => {
  if (!errors.length) return '';
  const header = context ? `Trace comparison failed for ${context}` : 'Trace comparison failed';
  const summary = [];
  if (diff?.missingActions?.length) summary.push(`Missing actions: ${diff.missingActions.length}`);
  if (diff?.unexpectedActions?.length) summary.push(`Unexpected actions: ${diff.unexpectedActions.length}`);
  if (diff?.orderingViolations?.length) summary.push(`Ordering violations: ${diff.orderingViolations.length}`);
  const summaryLine = summary.length ? `\nSummary: ${summary.join(', ')}` : '';
  const diffHint = diff ? '\nSee trace.diff.json for normalized excerpts.' : '';
  return `${header}:\n${errors.join('\n')}${summaryLine}${diffHint}`;
};
