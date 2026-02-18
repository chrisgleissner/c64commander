import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), '.github/workflows', name), 'utf8');

describe('telemetry release gate workflow rules', () => {
    it('hard-fails Android telemetry on monitor exit code 3 for release/tag flows', () => {
        const workflow = readWorkflow('android.yaml');
        expect(workflow).toContain('if [[ "$code" == "3" ]]; then');
        expect(workflow).toContain('if [[ "${GITHUB_REF_TYPE}" == "tag" || "${GITHUB_REF_NAME}" == release/* ]]; then');
        expect(workflow).toContain('telemetry gate failed: main process disappearance/restart detected on release flow');
        expect(workflow).toContain('telemetry gate warning: main process disappearance/restart detected (non-release flow)');
    });

    it('hard-fails iOS telemetry on monitor exit code 3 for release/tag flows', () => {
        const workflow = readWorkflow('ios.yaml');
        expect(workflow).toContain('if [[ "$code" == "3" ]]; then');
        expect(workflow).toContain('if [[ "${GITHUB_REF_TYPE}" == "tag" || "${GITHUB_REF_NAME}" == release/* ]]; then');
        expect(workflow).toContain('telemetry gate failed: app process disappearance/restart detected on release flow');
        expect(workflow).toContain('telemetry gate warning: app process disappearance/restart detected (non-release flow)');
    });
});
