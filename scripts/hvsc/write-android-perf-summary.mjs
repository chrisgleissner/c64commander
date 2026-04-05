#!/usr/bin/env node
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { summarizeAndroidBenchmarkArtifacts } from './androidPerfSummary.mjs';

const args = new Map(
    process.argv.slice(2).map((arg) => {
        const [key, value] = arg.split('=');
        return [key, value ?? ''];
    }),
);

const summaryPath = args.get('--summary');
const runId = args.get('--run-id');
const deviceId = args.get('--device-id');
const target = args.get('--target');
const host = args.get('--host');
const hvscBaseUrl = args.get('--hvsc-base-url');
const maestroStatus = Number(args.get('--maestro-status') || '1');
const perfettoPath = args.get('--perfetto-trace') || '';
const perfettoLogPath = args.get('--perfetto-log') || '';
const smokeDir = args.get('--smoke-dir') || '';
const telemetryDir = args.get('--telemetry-dir') || '';

if (!summaryPath) {
    process.stderr.write('Missing required argument: --summary=...\n');
    process.exit(1);
}

const smokeFiles = smokeDir
    ? readdirSync(smokeDir)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => path.join(smokeDir, file))
    : [];

const telemetryCsvPath = telemetryDir ? path.join(telemetryDir, 'metrics.csv') : '';
const telemetryMetaPath = telemetryDir ? path.join(telemetryDir, 'metadata.json') : '';

const artifactSummary = summarizeAndroidBenchmarkArtifacts({
    smokeDir: smokeFiles,
    telemetryCsvPath,
    telemetryMetaPath,
    perfettoPath,
    perfettoLogPath,
});

const summary = {
    runId,
    deviceId,
    target,
    host: host || null,
    hvscBaseUrl: hvscBaseUrl || null,
    maestroStatus,
    perfettoTrace: perfettoPath ? path.relative(path.dirname(summaryPath), perfettoPath) : null,
    perfettoLog: perfettoLogPath ? path.relative(path.dirname(summaryPath), perfettoLogPath) : null,
    smokeArtifacts: smokeFiles.map((file) => path.relative(path.dirname(summaryPath), file)),
    telemetryArtifacts: telemetryDir
        ? [telemetryCsvPath, telemetryMetaPath].map((file) => path.relative(path.dirname(summaryPath), file))
        : [],
    createdAt: new Date().toISOString(),
    ...artifactSummary,
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
