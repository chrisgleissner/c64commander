import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const toFiniteNumbers = (values) => values.filter((value) => Number.isFinite(value));

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
    return JSON.parse(readFileSync(filePath, 'utf8'));
};

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
                const downloadSamples = entries.map((entry) => sumScenarioScopes(entry, (scope) => scope === 'download'));
                if (downloadSamples.some((value) => value > 0)) {
                    derivedMetrics.downloadMs = summarizeMetric(downloadSamples);
                }
                const ingestSamples = entries.map((entry) => sumScenarioScopes(entry, (scope) => scope.startsWith('ingest:')));
                if (ingestSamples.some((value) => value > 0)) {
                    derivedMetrics.ingestMs = summarizeMetric(ingestSamples);
                }
                return [
                    scenario,
                    {
                        sampleCount: entries.length,
                        scopeMetrics: summarizeTimingScopes(entries),
                        derivedMetrics,
                        latestMetadata: entries[entries.length - 1]?.metadata ?? null,
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
    const headers = lines[0].split(',');
    const rows = lines.slice(1).map((line) => {
        const values = line.split(',');
        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
    const numericFields = ['cpu_percent', 'rss_kb', 'threads', 'pss_kb', 'dalvik_pss_kb', 'native_pss_kb', 'total_pss_kb'];
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
    const logLines = perfettoLogPath && existsSync(perfettoLogPath)
        ? readFileSync(perfettoLogPath, 'utf8').split(/\r?\n/).filter(Boolean)
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
            mode: 'telemetry-plus-artifact-metadata',
            traceProcessorAvailable: false,
            jankMetricsAvailable: false,
        },
    };
};

const buildTargetEvidence = (scenarioSummaries) => {
    const install = scenarioSummaries.install ?? null;
    const browse = scenarioSummaries['browse-query'] ?? null;
    const playback = scenarioSummaries['playback-start'] ?? null;
    const asBudgetResult = (actualMs, budgetMs, source) => ({
        source,
        budgetMs,
        actualMs,
        status: Number.isFinite(actualMs) ? (actualMs <= budgetMs ? 'pass' : 'fail') : 'unmeasured',
    });

    return {
        T1: asBudgetResult(install?.derivedMetrics?.downloadMs?.p95 ?? null, 20_000, 'install.derivedMetrics.downloadMs.p95'),
        T2: asBudgetResult(install?.derivedMetrics?.ingestMs?.p95 ?? null, 25_000, 'install.derivedMetrics.ingestMs.p95'),
        T3: asBudgetResult(browse?.derivedMetrics?.windowMs?.p95 ?? browse?.scopeMetrics?.['browse:query']?.p95 ?? null, 2_000, 'browse-query.windowMs.p95'),
        T4: asBudgetResult(null, 2_000, 'android-filter-scenarios-not-captured'),
        T5: asBudgetResult(
            playback?.scopeMetrics?.['playback:first-audio']?.p95 ?? playback?.scopeMetrics?.['playback:load-sid']?.p95 ?? null,
            1_000,
            'playback-start.scopeMetrics.playback:first-audio.p95',
        ),
    };
};

export const summarizeAndroidBenchmarkArtifacts = ({ smokeDir, telemetryCsvPath, telemetryMetaPath, perfettoPath, perfettoLogPath }) => {
    const smokeSnapshots = (Array.isArray(smokeDir) ? smokeDir : [])
        .map((entry) => (typeof entry === 'string' ? readJsonIfExists(entry) : entry))
        .filter(Boolean);
    const telemetrySummary = telemetryCsvPath && existsSync(telemetryCsvPath)
        ? parseTelemetryCsv(readFileSync(telemetryCsvPath, 'utf8'))
        : {};
    const scenarioSummaries = summarizeSmokeSnapshots(smokeSnapshots);

    return {
        smokeSnapshotCount: smokeSnapshots.length,
        scenarioSummaries,
        targetEvidence: buildTargetEvidence(scenarioSummaries),
        telemetry: {
            metadata: readJsonIfExists(telemetryMetaPath),
            processes: telemetrySummary,
        },
        perfetto: summarizePerfettoArtifacts({ perfettoPath, perfettoLogPath }),
    };
};
