import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const scriptPath = path.resolve(process.cwd(), 'scripts/check-coverage-threshold.mjs');

const runScript = (cwd: string, env: Record<string, string> = {}) => {
    return spawnSync(process.execPath, [scriptPath], {
        cwd,
        env: {
            ...process.env,
            ...env,
        },
        encoding: 'utf8',
    });
};

describe('check-coverage-threshold', () => {
    it('passes when line and branch coverage satisfy thresholds', () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'coverage-pass-'));
        try {
            const coverageDir = path.join(root, 'coverage');
            mkdirSync(coverageDir, { recursive: true });
            writeFileSync(path.join(root, 'coverage/lcov.info'), [
                'TN:',
                'SF:src/file.ts',
                'DA:1,1',
                'DA:2,1',
                'LF:2',
                'LH:2',
                'BRDA:1,0,0,1',
                'BRDA:1,0,1,1',
                'BRF:2',
                'BRH:2',
                'end_of_record',
            ].join('\n'), 'utf8');

            const result = runScript(root, {
                COVERAGE_FILE: 'coverage/lcov.info',
                COVERAGE_MIN: '80',
                COVERAGE_MIN_BRANCH: '82',
            });

            expect(result.status).toBe(0);
            expect(result.stdout).toContain('Line coverage: 100.00%');
            expect(result.stdout).toContain('Branch coverage: 100.00%');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails when branch coverage is below threshold even when line coverage passes', () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'coverage-branch-fail-'));
        try {
            mkdirSync(path.join(root, 'coverage'), { recursive: true });
            writeFileSync(path.join(root, 'coverage/lcov.info'), [
                'TN:',
                'SF:src/file.ts',
                'DA:1,1',
                'DA:2,1',
                'LF:2',
                'LH:2',
                'BRDA:1,0,0,1',
                'BRDA:1,0,1,0',
                'BRF:2',
                'BRH:1',
                'end_of_record',
            ].join('\n'), 'utf8');

            const result = runScript(root, {
                COVERAGE_FILE: 'coverage/lcov.info',
                COVERAGE_MIN: '80',
                COVERAGE_MIN_BRANCH: '82',
            });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain('Branch coverage below minimum threshold');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('prefers DA/BRDA detail records over inconsistent summary counters', () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'coverage-detail-preferred-'));
        try {
            mkdirSync(path.join(root, 'coverage'), { recursive: true });
            writeFileSync(path.join(root, 'coverage/lcov.info'), [
                'TN:',
                'SF:src/file.ts',
                'DA:1,1',
                'DA:2,1',
                'LF:2',
                'LH:1',
                'BRDA:1,0,0,1',
                'BRDA:1,0,1,1',
                'BRF:2',
                'BRH:0',
                'end_of_record',
            ].join('\n'), 'utf8');

            const result = runScript(root, {
                COVERAGE_FILE: 'coverage/lcov.info',
                COVERAGE_MIN: '80',
                COVERAGE_MIN_BRANCH: '82',
            });

            expect(result.status).toBe(0);
            expect(result.stdout).toContain('Line coverage: 100.00%');
            expect(result.stdout).toContain('Branch coverage: 100.00%');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
