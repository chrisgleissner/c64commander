export type HvscPerfMetadata = Record<string, unknown>;

export type HvscPerfScopeToken = {
  scope: string;
  name: string;
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

let sequence = 0;
const timings: HvscPerfTiming[] = [];

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const addTiming = (timing: HvscPerfTiming) => {
  timings.push(timing);
  if (timings.length > MAX_HVSC_PERF_TIMINGS) {
    timings.splice(0, timings.length - MAX_HVSC_PERF_TIMINGS);
  }
  return timing;
};

const markPerformance = (name: string) => {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(name);
  } catch {
    // Ignore environments that do not fully support the performance mark API.
  }
};

const measurePerformance = (name: string, startMarkName: string, endMarkName: string) => {
  if (
    typeof performance === "undefined" ||
    typeof performance.measure !== "function" ||
    typeof performance.getEntriesByName !== "function"
  ) {
    return null;
  }

  try {
    performance.measure(name, startMarkName, endMarkName);
    const entries = performance.getEntriesByName(name, "measure");
    const latest = entries[entries.length - 1];
    return latest?.duration ?? null;
  } catch {
    return null;
  } finally {
    if (typeof performance.clearMarks === "function") {
      performance.clearMarks(startMarkName);
      performance.clearMarks(endMarkName);
    }
    if (typeof performance.clearMeasures === "function") {
      performance.clearMeasures(name);
    }
  }
};

export const beginHvscPerfScope = (scope: string, metadata?: HvscPerfMetadata): HvscPerfScopeToken => {
  const name = `hvsc:perf:${scope}`;
  const startMarkName = `${name}:start`;
  const token: HvscPerfScopeToken = {
    scope,
    name,
    startMarkName,
    startedAt: new Date().toISOString(),
    startedAtMs: getNow(),
    metadata: metadata ?? null,
  };

  markPerformance(startMarkName);
  return token;
};

export const endHvscPerfScope = (token: HvscPerfScopeToken, metadata?: HvscPerfMetadata) => {
  const endMarkName = `${token.name}:end`;
  const endedAt = new Date().toISOString();
  const endedAtMs = getNow();

  markPerformance(endMarkName);
  const measuredDurationMs = measurePerformance(token.name, token.startMarkName, endMarkName);

  return addTiming({
    id: `hvsc-perf-${String((sequence += 1)).padStart(6, "0")}`,
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
  sequence = 0;
};
