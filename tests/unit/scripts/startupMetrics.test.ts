import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStartupMetricsFromFile, parseStartupMetricsFromLines, summarizeTtfsc } from '../../../scripts/startup/startupMetrics.mjs';

describe('startup metrics parser', () => {
    it('computes startup request/config/duplicate/backlog and latency metrics', () => {
        const lines = [
            'CapacitorHttp GET http://c64u/v1/configs/video',
            'CapacitorHttp GET http://c64u/v1/configs/video',
            'CapacitorHttp GET http://c64u/v1/configs/audio',
            'CapacitorHttp POST http://c64u/v1/machine:reboot 529 ms',
            'CapacitorHttp status=200',
            'CapacitorHttp status=200',
            'CapacitorHttp status=200',
            'chromium ConvertJavaStringToUTF8 called with null string.',
        ];

        const metrics = parseStartupMetricsFromLines(lines);
        expect(metrics.StartupRequestCount).toBe(4);
        expect(metrics.StartupConfigCalls).toBe(3);
        expect(metrics.DuplicateStartupConfigKeyRequests).toBe(1);
        expect(metrics.StartupBacklogDepth).toBeGreaterThanOrEqual(1);
        expect(metrics.UserTriggeredCommandLatencyMs.samples).toEqual([529]);
        expect(metrics.NullStringWarningCount).toBe(1);
    });

    it('detects startup HVSC download markers', () => {
        const metrics = parseStartupMetricsFromLines([
            'CapacitorHttp GET https://hvsc.c64.org/hvsc-update-84.7z',
        ]);
        expect(metrics.HvscStartupDownloads).toBeGreaterThan(0);
    });

    it('handles request lines without parseable URL and command lines without latency', () => {
        const metrics = parseStartupMetricsFromLines([
            'CapacitorHttp fetch(request) without absolute url',
            'CapacitorHttp POST http://c64u/v1/machine:reset',
            'CapacitorHttp status=200',
            'CapacitorHttp status=200',
        ]);

        expect(metrics.StartupRequestCount).toBe(1);
        expect(metrics.UserTriggeredCommandLatencyMs.samples).toEqual([]);
        expect(metrics.StartupBacklogDepth).toBeGreaterThanOrEqual(1);
    });

    it('summarizes p50 and p95 for samples', () => {
        const summary = summarizeTtfsc([100, 200, 300, 400, 500]);
        expect(summary.p50).toBe(300);
        expect(summary.p95).toBe(500);
    });

    it('parses startup metrics from file and handles empty quantile samples', () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'startup-metrics-file-'));
        try {
            const filePath = path.join(root, 'logcat.txt');
            writeFileSync(filePath, [
                'CapacitorHttp GET http://c64u/v1/configs/video',
                'CapacitorHttp status=200',
            ].join('\n'), 'utf8');

            const metrics = parseStartupMetricsFromFile(filePath);
            expect(metrics.StartupRequestCount).toBe(1);

            const emptySummary = summarizeTtfsc([]);
            expect(emptySummary.p50).toBeNull();
            expect(emptySummary.p95).toBeNull();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
