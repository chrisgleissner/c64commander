import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseTelemetryCsv, summarizeAndroidBenchmarkArtifacts } from '../../../scripts/hvsc/androidPerfSummary.mjs';

const tempDirs: string[] = [];

const createTempRoot = () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'android-hvsc-summary-'));
    tempDirs.push(root);
    return root;
};

afterEach(() => {
    while (tempDirs.length > 0) {
        rmSync(tempDirs.pop() as string, { recursive: true, force: true });
    }
});

describe('androidPerfSummary', () => {
    it('parses telemetry csv into per-process summaries', () => {
        const telemetry = parseTelemetryCsv([
            'timestamp,platform,device,process_name,pid,cpu_percent,rss_kb,threads,pss_kb,dalvik_pss_kb,native_pss_kb,total_pss_kb',
            '1,android,pixel,uk.gleissner.c64commander,100,12.5,200000,22,180000,80000,50000,180000',
            '2,android,pixel,uk.gleissner.c64commander,100,20.0,210000,23,185000,81000,52000,185000',
            '2,android,pixel,uk.gleissner.c64commander:renderer,200,15.0,99000,12,90000,30000,20000,90000',
        ].join('\n'));

        expect(telemetry['uk.gleissner.c64commander'].sampleCount).toBe(2);
        expect(telemetry['uk.gleissner.c64commander'].metrics.cpu_percent.p95).toBe(20);
        expect(telemetry['uk.gleissner.c64commander:renderer'].metrics.rss_kb.p50).toBe(99000);
    });

    it('summarizes smoke snapshots, telemetry, and perfetto metadata into target evidence', () => {
        const root = createTempRoot();
        const smokeDir = path.join(root, 'smoke');
        const telemetryDir = path.join(root, 'telemetry');
        const perfettoDir = path.join(root, 'perfetto');
        mkdirSync(smokeDir, { recursive: true });
        mkdirSync(telemetryDir, { recursive: true });
        mkdirSync(perfettoDir, { recursive: true });

        writeFileSync(
            path.join(smokeDir, 'c64u-smoke-benchmark-install.json'),
            JSON.stringify({
                scenario: 'install',
                hvscPerfTimings: [
                    { scope: 'download', durationMs: 14000 },
                    { scope: 'ingest:extract', durationMs: 8000 },
                    { scope: 'ingest:index-build', durationMs: 9000 },
                ],
                metadata: { totalSongs: 60582 },
            }),
        );
        writeFileSync(
            path.join(smokeDir, 'c64u-smoke-benchmark-browse-query.json'),
            JSON.stringify({
                scenario: 'browse-query',
                hvscPerfTimings: [{ scope: 'browse:query', durationMs: 320 }],
                metadata: { windowMs: 480 },
            }),
        );
        writeFileSync(
            path.join(smokeDir, 'c64u-smoke-benchmark-playback-start.json'),
            JSON.stringify({
                scenario: 'playback-start',
                hvscPerfTimings: [{ scope: 'playback:first-audio', durationMs: 620 }],
                metadata: { mode: 'single' },
            }),
        );
        writeFileSync(
            path.join(telemetryDir, 'metrics.csv'),
            [
                'timestamp,platform,device,process_name,pid,cpu_percent,rss_kb,threads,pss_kb,dalvik_pss_kb,native_pss_kb,total_pss_kb',
                '1,android,pixel,uk.gleissner.c64commander,100,18.0,205000,22,182000,78000,52000,182000',
                '2,android,pixel,uk.gleissner.c64commander,100,24.0,215000,23,188000,79000,53000,188000',
            ].join('\n'),
        );
        writeFileSync(path.join(telemetryDir, 'metadata.json'), JSON.stringify({ sample_rows: 2 }));
        writeFileSync(path.join(perfettoDir, 'hvsc-baseline.pftrace'), 'trace-bytes');
        writeFileSync(path.join(perfettoDir, 'perfetto.log'), 'trace completed successfully\n');

        const summary = summarizeAndroidBenchmarkArtifacts({
            smokeDir: [
                path.join(smokeDir, 'c64u-smoke-benchmark-install.json'),
                path.join(smokeDir, 'c64u-smoke-benchmark-browse-query.json'),
                path.join(smokeDir, 'c64u-smoke-benchmark-playback-start.json'),
            ],
            telemetryCsvPath: path.join(telemetryDir, 'metrics.csv'),
            telemetryMetaPath: path.join(telemetryDir, 'metadata.json'),
            perfettoPath: path.join(perfettoDir, 'hvsc-baseline.pftrace'),
            perfettoLogPath: path.join(perfettoDir, 'perfetto.log'),
        });

        expect(summary.smokeSnapshotCount).toBe(3);
        expect(summary.scenarioSummaries.install.derivedMetrics.downloadMs.p95).toBe(14000);
        expect(summary.scenarioSummaries.install.derivedMetrics.ingestMs.p95).toBe(17000);
        expect(summary.scenarioSummaries['browse-query'].derivedMetrics.windowMs.p50).toBe(480);
        expect(summary.targetEvidence.T1.status).toBe('pass');
        expect(summary.targetEvidence.T2.status).toBe('pass');
        expect(summary.targetEvidence.T5.actualMs).toBe(620);
        expect(summary.telemetry.processes['uk.gleissner.c64commander'].metrics.cpu_percent.p95).toBe(24);
        expect(summary.perfetto.traceCaptured).toBe(true);
        expect(summary.perfetto.traceSizeBytes).toBeGreaterThan(0);
    });
});
