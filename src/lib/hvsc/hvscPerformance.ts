export type HvscPerfMetadata = Record<string, unknown>;

export type HvscPerfScopeToken = {
  scope: string;
  name: string;
  measureName: string;
  startMarkName: string;
  startedAt: string;
  startedAtMs: number;
  metadata: HvscPerfMetadata | null;
};

export type HvscPerfTiming = {
  id: string;
  scope: string;
  name: string;
  startMarkName: string;
  endMarkName: string;
  startedAt: string;
  endedAt: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  metadata: HvscPerfMetadata | null;
};

const MAX_HVSC_PERF_TIMINGS = 1000;

let scopeSequence = 0;
let timingSequence = 0;
const timings: HvscPerfTiming[] = [];
const warnedPerformanceFailures = new Set<string>();

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const addTiming = (timing: HvscPerfTiming) => {
  timings.push(timing);
  if (timings.length > MAX_HVSC_PERF_TIMINGS) {
    timings.splice(0, timings.length - MAX_HVSC_PERF_TIMINGS);
  }
  return timing;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const warnPerformanceApiFailure = (
  operation: "mark" | "measure",
  scopeName: string,
  targetName: string,
  error: unknown,
) => {
  const errorMessage = getErrorMessage(error);
  const key = `${operation}:${scopeName}:${errorMessage}`;
  if (warnedPerformanceFailures.has(key)) return;
  warnedPerformanceFailures.add(key);
  console.warn("HVSC performance API call failed; falling back to wall clock timing", {
    operation,
    scopeName,
    targetName,
    error: errorMessage,
  });
};

const markPerformance = (name: string, scopeName: string) => {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(name);
  } catch (error) {
    warnPerformanceApiFailure("mark", scopeName, name, error);
  }
};

const measurePerformance = (measureName: string, startMarkName: string, endMarkName: string, scopeName: string) => {
  if (
    typeof performance === "undefined" ||
    typeof performance.measure !== "function" ||
    typeof performance.getEntriesByName !== "function"
  ) {
    return null;
  }

  try {
    performance.measure(measureName, startMarkName, endMarkName);
    const entries = performance.getEntriesByName(measureName, "measure");
    const latest = entries[entries.length - 1];
    return latest?.duration ?? null;
  } catch (error) {
    warnPerformanceApiFailure("measure", scopeName, measureName, error);
    return null;
  } finally {
    if (typeof performance.clearMarks === "function") {
      performance.clearMarks(startMarkName);
      performance.clearMarks(endMarkName);
    }
    if (typeof performance.clearMeasures === "function") {
      performance.clearMeasures(measureName);
    }
  }
};

export const beginHvscPerfScope = (scope: string, metadata?: HvscPerfMetadata): HvscPerfScopeToken => {
  const name = `hvsc:perf:${scope}`;
  const measureName = `${name}:${String((scopeSequence += 1)).padStart(6, "0")}`;
  const startMarkName = `${measureName}:start`;
  const token: HvscPerfScopeToken = {
    scope,
    name,
    measureName,
    startMarkName,
    startedAt: new Date().toISOString(),
    startedAtMs: getNow(),
    metadata: metadata ?? null,
  };

  markPerformance(startMarkName, name);
  return token;
};

export const endHvscPerfScope = (token: HvscPerfScopeToken, metadata?: HvscPerfMetadata) => {
  const endMarkName = `${token.measureName}:end`;
  const endedAt = new Date().toISOString();
  const endedAtMs = getNow();

  markPerformance(endMarkName, token.name);
  const measuredDurationMs = measurePerformance(token.measureName, token.startMarkName, endMarkName, token.name);

  return addTiming({
    id: `hvsc-perf-${String((timingSequence += 1)).padStart(6, "0")}`,
    scope: token.scope,
    name: token.name,
    startMarkName: token.startMarkName,
    endMarkName,
    startedAt: token.startedAt,
    endedAt,
    startedAtMs: token.startedAtMs,
    endedAtMs,
    durationMs: Number((measuredDurationMs ?? endedAtMs - token.startedAtMs).toFixed(3)),
    metadata: {
      ...(token.metadata ?? {}),
      ...(metadata ?? {}),
    },
  });
};

export const runWithHvscPerfScope = async <T>(
  scope: string,
  run: () => Promise<T> | T,
  metadata?: HvscPerfMetadata,
): Promise<T> => {
  const token = beginHvscPerfScope(scope, metadata);
  try {
    const result = await run();
    endHvscPerfScope(token, { outcome: "success" });
    return result;
  } catch (error) {
    const err = error as Error;
    endHvscPerfScope(token, {
      outcome: "error",
      errorName: err.name,
      errorMessage: err.message,
    });
    throw error;
  }
};

export const collectHvscPerfTimings = () => timings.map((timing) => ({ ...timing }));

export const resetHvscPerfTimings = () => {
  timings.splice(0, timings.length);
  scopeSequence = 0;
  timingSequence = 0;
  warnedPerformanceFailures.clear();
};
