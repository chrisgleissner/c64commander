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

    it('uploads iOS telemetry and diagnostics artifacts on failure', () => {
        const workflow = readWorkflow('ios.yaml');
        expect(workflow).toContain('- name: Upload iOS failure diagnostics (${{ matrix.group.name }})');
        expect(workflow).toContain('if: failure()');
        expect(workflow).toContain('artifacts/ios/_infra/telemetry/events.log');
        expect(workflow).toContain('artifacts/ios/_infra/simulator/**');
        expect(workflow).toContain('artifacts/ios/_infra/xcodebuild/**');
    });

    it('creates flow-active.flag before Maestro execution in iOS workflow', () => {
        const workflow = readWorkflow('ios.yaml');
        expect(workflow).toContain('touch artifacts/ios/_infra/telemetry/flow-active.flag');
    });

    it('transitions lifecycle flags after Maestro execution in iOS workflow', () => {
        const workflow = readWorkflow('ios.yaml');
        expect(workflow).toContain('rm -f artifacts/ios/_infra/telemetry/flow-active.flag');
        expect(workflow).toContain('touch artifacts/ios/_infra/telemetry/flow-complete.flag');
    });

    it('hardens fuzz monitor lifecycle to always persist exit codes', () => {
        const workflow = readWorkflow('fuzz.yaml');
        const trapMatches = workflow.match(/trap 'write_code_file "\$status"' EXIT/g) ?? [];
        const fallbackMatches = workflow.match(/synthesized monitor\.exitcode=1 because wrapper exited before writing status/g) ?? [];
        expect(trapMatches.length).toBeGreaterThanOrEqual(2);
        expect(fallbackMatches.length).toBeGreaterThanOrEqual(2);
    });
});
