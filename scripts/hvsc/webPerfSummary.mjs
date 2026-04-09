const toFiniteNumbers = (values) => values.filter((value) => Number.isFinite(value) && value >= 0);

export const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[position];
};

export const summarizeMetric = (values) => {
  const samples = toFiniteNumbers(values);
  return {
    samples,
    min: samples.length ? Math.min(...samples) : null,
    max: samples.length ? Math.max(...samples) : null,
    p50: quantile(samples, 0.5),
    p95: quantile(samples, 0.95),
  };
};

export const summarizeSecondaryIterations = (iterations) => {
  const metricNames = ["browseLoadSnapshotMs", "browseInitialQueryMs", "browseSearchQueryMs", "playbackLoadSidMs"];
  return Object.fromEntries(
    metricNames.map((name) => {
      const samples = iterations.map((iteration) => iteration.metrics?.[name]);
      return [name, summarizeMetric(samples)];
    }),
  );
};

const collectScenarioRuns = (iterations, scenarioName) =>
  iterations.flatMap((iteration) =>
    (iteration.scenarios ?? []).filter((scenario) => scenario.scenario === scenarioName),
  );

const collectScenarioScopeSamples = (scenarioRuns) => {
  const scopes = new Map();
  scenarioRuns.forEach((scenario) => {
    (scenario.timings ?? []).forEach((timing) => {
      if (!Number.isFinite(timing?.durationMs)) return;
      const samples = scopes.get(timing.scope) ?? [];
      samples.push(timing.durationMs);
      scopes.set(timing.scope, samples);
    });
  });
  return Object.fromEntries(
    Array.from(scopes.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scope, samples]) => [scope, summarizeMetric(samples)]),
  );
};

const summarizeScenarioRuns = (scenarioRuns) => ({
  sampleCount: scenarioRuns.length,
  wallClockMs: summarizeMetric(scenarioRuns.map((scenario) => scenario.wallClockMs)),
  scopeMetrics: collectScenarioScopeSamples(scenarioRuns),
});

const maxFinite = (values) => {
  const finite = toFiniteNumbers(values);
  return finite.length ? Math.max(...finite) : null;
};

const buildUnmeasuredBudgetResult = (budgetMs, source, reason) => ({
  source,
  budgetMs,
  actualMs: null,
  status: 'unmeasured',
  reason,
});

const buildTargetEvidence = (scenarioSummaries, options = {}) => {
  const evidenceClass = options.evidenceClass ?? 'full-scale';
  const nonEligibleReason =
    evidenceClass === 'fixture'
      ? 'Fixture web scenario runs are mechanism proof only and are not target-eligible.'
      : evidenceClass === 'hybrid'
        ? 'Hybrid web scenario runs mix real downloads with fixture-backed browse/playback and are not target-eligible.'
        : null;
  const downloadP95 = scenarioSummaries["S1-download"]?.wallClockMs?.p95 ?? null;
  const ingestP95 = scenarioSummaries["S2-ingest"]?.wallClockMs?.p95 ?? null;
  const browseP95 = maxFinite([
    scenarioSummaries["S3-enter-hvsc-root"]?.wallClockMs?.p95,
    scenarioSummaries["S4-traverse-down"]?.wallClockMs?.p95,
    scenarioSummaries["S5-traverse-up"]?.wallClockMs?.p95,
  ]);
  const filterP95 = maxFinite([
    scenarioSummaries["S8-filter-high-match"]?.wallClockMs?.p95,
    scenarioSummaries["S9-filter-zero-match"]?.wallClockMs?.p95,
    scenarioSummaries["S10-filter-low-match"]?.wallClockMs?.p95,
  ]);
  const playbackP95 = scenarioSummaries["S11-playback-start"]?.wallClockMs?.p95 ?? null;

  const asBudgetResult = (actualMs, budgetMs, source) => ({
    source,
    budgetMs,
    actualMs,
    status: Number.isFinite(actualMs) && actualMs >= 0 ? (actualMs <= budgetMs ? "pass" : "fail") : "unmeasured",
  });

  if (nonEligibleReason) {
    return {
      T1: buildUnmeasuredBudgetResult(20_000, 'S1-download.wallClockMs.p95', nonEligibleReason),
      T2: buildUnmeasuredBudgetResult(25_000, 'S2-ingest.wallClockMs.p95', nonEligibleReason),
      T3: buildUnmeasuredBudgetResult(2_000, 'max(S3,S4,S5).wallClockMs.p95', nonEligibleReason),
      T4: buildUnmeasuredBudgetResult(2_000, 'max(S8,S9,S10).wallClockMs.p95', nonEligibleReason),
      T5: buildUnmeasuredBudgetResult(1_000, 'S11-playback-start.wallClockMs.p95', nonEligibleReason),
    };
  }

  return {
    T1: asBudgetResult(downloadP95, 20_000, "S1-download.wallClockMs.p95"),
    T2: asBudgetResult(ingestP95, 25_000, "S2-ingest.wallClockMs.p95"),
    T3: asBudgetResult(browseP95, 2_000, "max(S3,S4,S5).wallClockMs.p95"),
    T4: asBudgetResult(filterP95, 2_000, "max(S8,S9,S10).wallClockMs.p95"),
    T5: asBudgetResult(playbackP95, 1_000, "S11-playback-start.wallClockMs.p95"),
  };
};

export const summarizeScenarioIterations = (iterations, options = {}) => {
  const scenarioNames = Array.from(
    new Set(iterations.flatMap((iteration) => (iteration.scenarios ?? []).map((scenario) => scenario.scenario))),
  ).sort((left, right) => left.localeCompare(right));

  const scenarioSummaries = Object.fromEntries(
    scenarioNames.map((scenarioName) => [
      scenarioName,
      summarizeScenarioRuns(collectScenarioRuns(iterations, scenarioName)),
    ]),
  );

  return {
    evidenceClass: options.evidenceClass ?? 'full-scale',
    scenarioCoverage: scenarioNames.map((scenarioName) => ({
      scenario: scenarioName,
      sampleCount: scenarioSummaries[scenarioName]?.sampleCount ?? 0,
    })),
    scenarioSummaries,
    targetEvidence: buildTargetEvidence(scenarioSummaries, options),
  };
};
