import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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

const readJsonIfExists = (filePath) => {
  if (!filePath || !existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
};

const summarizeNumericMetadata = (entries, key) => {
  const samples = entries
    .map((entry) => entry.metadata?.[key])
    .filter((value) => Number.isFinite(value) && value >= 0);
  return samples.length ? summarizeMetric(samples) : null;
};

const collectStringMetadataValues = (entries, key) =>
  Array.from(
    new Set(
      entries
        .map((entry) => entry.metadata?.[key])
        .filter((value) => typeof value === "string" && value.length > 0),
    ),
  ).sort();

const summarizeTimingScopes = (snapshots) => {
  const scopes = new Map();
  snapshots.forEach((snapshot) => {
    (snapshot.hvscPerfTimings ?? []).forEach((timing) => {
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

const sumScenarioScopes = (snapshot, predicate) =>
  (snapshot.hvscPerfTimings ?? [])
    .filter((timing) => predicate(timing.scope))
    .reduce((total, timing) => total + (Number.isFinite(timing.durationMs) ? timing.durationMs : 0), 0);

const summarizeSmokeSnapshots = (snapshots) => {
  const grouped = new Map();
  snapshots.forEach((snapshot) => {
    const key = snapshot.scenario;
    const entries = grouped.get(key) ?? [];
    entries.push(snapshot);
    grouped.set(key, entries);
  });

  return Object.fromEntries(
    Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scenario, entries]) => {
        const derivedMetrics = {};
        const metadataWindowMs = entries
          .map((entry) => entry.metadata?.windowMs)
          .filter((value) => Number.isFinite(value));
        if (metadataWindowMs.length) {
          derivedMetrics.windowMs = summarizeMetric(metadataWindowMs);
        }
        const downloadSamples = entries.map((entry) => sumScenarioScopes(entry, (scope) => scope === "download"));
        if (downloadSamples.some((value) => value > 0)) {
          derivedMetrics.downloadMs = summarizeMetric(downloadSamples);
        }
        const ingestSamples = entries.map((entry) => sumScenarioScopes(entry, (scope) => scope.startsWith("ingest:")));
        if (ingestSamples.some((value) => value > 0)) {
          derivedMetrics.ingestMs = summarizeMetric(ingestSamples);
        }
        const playlistSize = summarizeNumericMetadata(entries, "playlistSize");
        if (playlistSize) {
          derivedMetrics.playlistSize = playlistSize;
        }
        const feedbackVisibleWithinMs = summarizeNumericMetadata(entries, "feedbackVisibleWithinMs");
        if (feedbackVisibleWithinMs) {
          derivedMetrics.feedbackVisibleWithinMs = feedbackVisibleWithinMs;
        }
        return [
          scenario,
          {
            sampleCount: entries.length,
            scopeMetrics: summarizeTimingScopes(entries),
            derivedMetrics,
            latestMetadata: entries[entries.length - 1]?.metadata ?? null,
            metadataValues: {
              feedbackKinds: collectStringMetadataValues(entries, "feedbackKind"),
              playlistOwnership: collectStringMetadataValues(entries, "playlistOwnership"),
              queryEngines: collectStringMetadataValues(entries, "queryEngine"),
            },
          },
        ];
      }),
  );
};

export const parseTelemetryCsv = (csvText) => {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return {};
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
  const numericFields = [
    "cpu_percent",
    "rss_kb",
    "threads",
    "pss_kb",
    "dalvik_pss_kb",
    "native_pss_kb",
    "total_pss_kb",
  ];
  const grouped = new Map();
  rows.forEach((row) => {
    const processName = row.process_name;
    const entries = grouped.get(processName) ?? [];
    entries.push(row);
    grouped.set(processName, entries);
  });
  return Object.fromEntries(
    Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([processName, entries]) => [
        processName,
        {
          sampleCount: entries.length,
          metrics: Object.fromEntries(
            numericFields.map((field) => [
              field,
              summarizeMetric(entries.map((entry) => Number.parseFloat(entry[field]))),
            ]),
          ),
        },
      ]),
  );
};

const summarizePerfettoArtifacts = ({ perfettoPath, perfettoLogPath }) => {
  const logLines =
    perfettoLogPath && existsSync(perfettoLogPath)
      ? readFileSync(perfettoLogPath, "utf8").split(/\r?\n/).filter(Boolean)
      : [];
  const warningLines = logLines.filter((line) => /warn|error|failed/i.test(line));
  return {
    tracePath: perfettoPath ?? null,
    traceCaptured: Boolean(perfettoPath && existsSync(perfettoPath)),
    traceSizeBytes: perfettoPath && existsSync(perfettoPath) ? statSync(perfettoPath).size : null,
    logPath: perfettoLogPath ?? null,
    warningCount: warningLines.length,
    warnings: warningLines.slice(0, 20),
    extraction: {
      mode: "trace-processor-sql",
      sqlQueriesAvailable: true,
      traceProcessorRequired: true,
      jankMetricsAvailable: true,
    },
  };
};

const maxFiniteFromSummaries = (summaries, accessor) => {
  const values = summaries.map(accessor).filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? Math.max(...values) : null;
};

const getFilterScenarioSummaries = (scenarioSummaries) => {
  const explicit = ["playlist-filter-high", "playlist-filter-zero", "playlist-filter-low"]
    .map((key) => scenarioSummaries[key])
    .filter(Boolean);
  if (explicit.length) {
    return explicit;
  }
  return scenarioSummaries["playlist-filter"] ? [scenarioSummaries["playlist-filter"]] : [];
};

const getSummaryMetadataNumber = (summary, key) => {
  const value = summary?.latestMetadata?.[key];
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const getSummaryMetadataString = (summary, key) => {
  const value = summary?.latestMetadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const buildFeedbackStageResult = ({
  summary,
  fallbackVisibleWithinMs = null,
  source,
  playlistSize = null,
  queryEngines = [],
  playlistOwnership = [],
}) => {
  if (!summary && !Number.isFinite(fallbackVisibleWithinMs)) return null;
  const visibleWithinMs =
    getSummaryMetadataNumber(summary, "feedbackVisibleWithinMs") ??
    (Number.isFinite(fallbackVisibleWithinMs) && fallbackVisibleWithinMs >= 0 ? fallbackVisibleWithinMs : null);
  const kind =
    getSummaryMetadataString(summary, "feedbackKind") ?? (Number.isFinite(visibleWithinMs) ? "result" : null);
  return {
    source,
    kind,
    visibleWithinMs,
    withinBudget: Number.isFinite(visibleWithinMs) ? visibleWithinMs <= 2_000 : false,
    playlistSize,
    queryEngines,
    playlistOwnership,
  };
};

const buildFeedbackEvidence = (scenarioSummaries) => {
  const install = scenarioSummaries.install ?? null;
  const ingest = scenarioSummaries.ingest ?? null;
  const playlistAdd = scenarioSummaries["playlist-add"] ?? null;
  const playback = scenarioSummaries["playback-start"] ?? null;
  const filterSummaries = getFilterScenarioSummaries(scenarioSummaries);

  const filterVisibleWithinMs = maxFiniteFromSummaries(
    filterSummaries,
    (summary) =>
      summary.derivedMetrics?.feedbackVisibleWithinMs?.p95 ??
      summary.derivedMetrics?.windowMs?.p95 ??
      summary.scopeMetrics?.["playlist:filter"]?.p95 ??
      null,
  );
  const filterPlaylistSize = maxFiniteFromSummaries(
    filterSummaries,
    (summary) => summary.derivedMetrics?.playlistSize?.p95 ?? null,
  );
  const filterQueryEngines = Array.from(
    new Set(filterSummaries.flatMap((summary) => summary.metadataValues?.queryEngines ?? [])),
  ).sort();
  const filterPlaylistOwnership = Array.from(
    new Set(filterSummaries.flatMap((summary) => summary.metadataValues?.playlistOwnership ?? [])),
  ).sort();

  const playbackVisibleWithinMs =
    getSummaryMetadataNumber(playback, "feedbackVisibleWithinMs") ??
    playback?.scopeMetrics?.["playback:first-audio"]?.p95 ??
    playback?.scopeMetrics?.["playback:load-sid"]?.p95 ??
    null;

  return {
    download: buildFeedbackStageResult({
      summary: install,
      source: "install.metadata.feedbackVisibleWithinMs",
    }),
    ingest: buildFeedbackStageResult({
      summary: ingest ?? install,
      source: ingest ? "ingest.metadata.feedbackVisibleWithinMs" : "install.metadata.feedbackVisibleWithinMs",
    }),
    addToPlaylist: buildFeedbackStageResult({
      summary: playlistAdd,
      source: "playlist-add.metadata.feedbackVisibleWithinMs",
      playlistSize: getSummaryMetadataNumber(playlistAdd, "playlistSize"),
    }),
    playlistFilter: buildFeedbackStageResult({
      summary: filterSummaries[0] ?? null,
      fallbackVisibleWithinMs: filterVisibleWithinMs,
      source:
        filterSummaries.length > 1
          ? "max(playlist-filter-high,playlist-filter-zero,playlist-filter-low).feedbackVisibleWithinMs"
          : "playlist-filter.feedbackVisibleWithinMs",
      playlistSize: filterPlaylistSize,
      queryEngines: filterQueryEngines,
      playlistOwnership: filterPlaylistOwnership,
    }),
    playbackStart: buildFeedbackStageResult({
      summary: playback,
      fallbackVisibleWithinMs: playbackVisibleWithinMs,
      source: "playback-start.scopeMetrics.playback:first-audio.p95",
      playlistSize: getSummaryMetadataNumber(playback, "playlistSize"),
    }),
  };
};

const buildUx1Evidence = (feedbackEvidence) => {
  const stages = [
    feedbackEvidence.download,
    feedbackEvidence.ingest,
    feedbackEvidence.addToPlaylist,
    feedbackEvidence.playlistFilter,
    feedbackEvidence.playbackStart,
  ].filter(Boolean);
  const measuredStages = stages.filter((stage) => Number.isFinite(stage.visibleWithinMs));
  const actualMs = measuredStages.length
    ? Math.max(...measuredStages.map((stage) => stage.visibleWithinMs))
    : null;
  const hasFailure = stages.some((stage) => stage.withinBudget === false);
  const allMeasured = stages.length === 5 && measuredStages.length === 5;
  return {
    source: "feedbackEvidence",
    budgetMs: 2_000,
    actualMs,
    measuredStageCount: measuredStages.length,
    status: hasFailure ? "fail" : allMeasured ? "pass" : "unmeasured",
    stageResults: feedbackEvidence,
  };
};

const buildT6Evidence = (filterSummaries) => {
  const actualPlaylistSize = maxFiniteFromSummaries(filterSummaries, (summary) => summary.derivedMetrics?.playlistSize?.p95 ?? null);
  const queryEngines = Array.from(
    new Set(filterSummaries.flatMap((summary) => summary.metadataValues?.queryEngines ?? [])),
  ).sort();
  const playlistOwnership = Array.from(
    new Set(filterSummaries.flatMap((summary) => summary.metadataValues?.playlistOwnership ?? [])),
  ).sort();
  if (!Number.isFinite(actualPlaylistSize) || actualPlaylistSize < 100_000) {
    return {
      source: "max(filter.metadata.playlistSize)",
      budgetCount: 100_000,
      actualCount: actualPlaylistSize,
      queryEngines,
      playlistOwnership,
      status: "unmeasured",
    };
  }
  const repositoryBacked = queryEngines.length > 0 && queryEngines.every((value) => value === "repository");
  const offReactState = playlistOwnership.length > 0 && playlistOwnership.every((value) => value !== "react-state");
  return {
    source: "max(filter.metadata.playlistSize)",
    budgetCount: 100_000,
    actualCount: actualPlaylistSize,
    queryEngines,
    playlistOwnership,
    status: repositoryBacked && offReactState ? "pass" : "fail",
  };
};

const buildTargetEvidence = (scenarioSummaries) => {
  const install = scenarioSummaries.install ?? null;
  const browse = scenarioSummaries["browse-query"] ?? null;
  const playback = scenarioSummaries["playback-start"] ?? null;
  const filterSummaries = getFilterScenarioSummaries(scenarioSummaries);
  const feedbackEvidence = buildFeedbackEvidence(scenarioSummaries);
  const asBudgetResult = (actualMs, budgetMs, source) => ({
    source,
    budgetMs,
    actualMs,
    status: Number.isFinite(actualMs) && actualMs >= 0 ? (actualMs <= budgetMs ? "pass" : "fail") : "unmeasured",
  });

  const filterP95 = maxFiniteFromSummaries(
    filterSummaries,
    (s) => s.scopeMetrics?.["playlist:filter"]?.p95 ?? s.derivedMetrics?.windowMs?.p95 ?? null,
  );

  return {
    UX1: buildUx1Evidence(feedbackEvidence),
    T1: asBudgetResult(
      install?.derivedMetrics?.downloadMs?.p95 ?? null,
      20_000,
      "install.derivedMetrics.downloadMs.p95",
    ),
    T2: asBudgetResult(install?.derivedMetrics?.ingestMs?.p95 ?? null, 25_000, "install.derivedMetrics.ingestMs.p95"),
    T3: asBudgetResult(
      browse?.derivedMetrics?.windowMs?.p95 ?? browse?.scopeMetrics?.["browse:query"]?.p95 ?? null,
      2_000,
      "browse-query.windowMs.p95",
    ),
    T4: asBudgetResult(filterP95, 2_000, "max(playlist-filter-high,zero,low).p95"),
    T5: asBudgetResult(
      playback?.scopeMetrics?.["playback:first-audio"]?.p95 ??
      playback?.scopeMetrics?.["playback:load-sid"]?.p95 ??
      null,
      1_000,
      "playback-start.scopeMetrics.playback:first-audio.p95",
    ),
    T6: buildT6Evidence(filterSummaries),
  };
};

export const summarizeAndroidBenchmarkArtifacts = ({
  smokeDir,
  telemetryCsvPath,
  telemetryMetaPath,
  perfettoPath,
  perfettoLogPath,
}) => {
  const smokeSnapshots = (Array.isArray(smokeDir) ? smokeDir : [])
    .map((entry) => (typeof entry === "string" ? readJsonIfExists(entry) : entry))
    .filter(Boolean);
  const telemetrySummary =
    telemetryCsvPath && existsSync(telemetryCsvPath) ? parseTelemetryCsv(readFileSync(telemetryCsvPath, "utf8")) : {};
  const scenarioSummaries = summarizeSmokeSnapshots(smokeSnapshots);

  return {
    smokeSnapshotCount: smokeSnapshots.length,
    scenarioSummaries,
    feedbackEvidence: buildFeedbackEvidence(scenarioSummaries),
    targetEvidence: buildTargetEvidence(scenarioSummaries),
    telemetry: {
      metadata: readJsonIfExists(telemetryMetaPath),
      processes: telemetrySummary,
    },
    perfetto: summarizePerfettoArtifacts({ perfettoPath, perfettoLogPath }),
  };
};
