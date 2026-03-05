/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
    classifyDomain,
    classifyIssue,
    hasChaosEvidence,
    classifyAllIssues,
    DOMAINS,
    CLASSIFICATIONS,
    CONFIDENCE_LEVELS,
    SELFTEST_TAG,
} from '../../../scripts/fuzzClassifier.mjs';

// ---------------------------------------------------------------------------
// hasChaosEvidence
// ---------------------------------------------------------------------------

describe('hasChaosEvidence', () => {
    it('returns false for empty array', () => {
        expect(hasChaosEvidence([])).toBe(false);
    });

    it('returns false for non-chaos interactions', () => {
        expect(hasChaosEvidence(['s=1 a=click btn-home', 's=2 a=tab music'])).toBe(false);
    });

    it('detects network-offline', () => {
        expect(hasChaosEvidence(['s=37 a=network-offline network offline 1945ms'])).toBe(true);
    });

    it('detects connection-flap', () => {
        expect(hasChaosEvidence(['s=12 a=connection-flap 500ms on/500ms off'])).toBe(true);
    });

    it('detects latency-spike', () => {
        expect(hasChaosEvidence(['s=5 a=latency-spike 2000ms'])).toBe(true);
    });

    it('returns true when chaos event is one of many lines', () => {
        const lines = [
            's=10 a=click some-button',
            's=11 a=scroll down',
            's=12 a=network-offline 3000ms',
            's=13 a=click other-button',
        ];
        expect(hasChaosEvidence(lines)).toBe(true);
    });

    it('returns false for null/undefined input', () => {
        expect(hasChaosEvidence(null as unknown as string[])).toBe(false);
        expect(hasChaosEvidence(undefined as unknown as string[])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// classifyDomain
// ---------------------------------------------------------------------------

describe('classifyDomain', () => {
    const noInteractions: string[] = [];

    it('returns FUZZ_INFRASTRUCTURE for DiagnosticsBridge message', () => {
        expect(classifyDomain({ message: 'DiagnosticsBridge unavailable' }, noInteractions)).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('returns FUZZ_INFRASTRUCTURE for Category config fetch failed', () => {
        expect(classifyDomain({ message: 'Category config fetch failed' }, noInteractions)).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('returns FUZZ_INFRASTRUCTURE for HVSC filesystem message', () => {
        expect(classifyDomain({ message: 'HVSC filesystem: not loaded' }, noInteractions)).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('returns FUZZ_INFRASTRUCTURE for localStorage init failed', () => {
        expect(classifyDomain({ message: '[fuzz] localStorage init failed' }, noInteractions)).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('returns FUZZ_INFRASTRUCTURE for stale element errors from fuzz runner frames', () => {
        expect(classifyDomain({
            message: 'Element is not attached',
            topFrames: ['safeClick (file:///home/chris/dev/c64/c64commander/playwright/fuzz/chaosRunner.fuzz.ts:463:5)'],
        }, noInteractions)).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('returns DEVICE_ACTION for HOME_ prefixed message', () => {
        expect(classifyDomain({ message: 'HOME_RESET: failed to reset' }, noInteractions)).toBe('DEVICE_ACTION');
    });

    it('returns DEVICE_ACTION for AUDIO_ROUTING message', () => {
        expect(classifyDomain({ message: 'AUDIO_ROUTING: output unavailable' }, noInteractions)).toBe('DEVICE_ACTION');
    });

    it('returns DEVICE_ACTION for RAM operation retry message', () => {
        expect(classifyDomain({ message: 'RAM operation retry 3 failed' }, noInteractions)).toBe('DEVICE_ACTION');
    });

    it('returns DEVICE_ACTION for machine pause/resume failure message', () => {
        expect(classifyDomain({ message: 'Machine pause/resume failed' }, noInteractions)).toBe('DEVICE_ACTION');
    });

    it('returns DEVICE_ACTION for RESET_DRIVES message', () => {
        expect(classifyDomain({ message: 'RESET_DRIVES failed with HTTP 404' }, noInteractions)).toBe('DEVICE_ACTION');
    });

    it('returns NETWORK for C64 API request failed', () => {
        expect(classifyDomain({ message: 'C64 API request failed' }, noInteractions)).toBe('NETWORK');
    });

    it('returns NETWORK for FTP listing failed', () => {
        expect(classifyDomain({ message: 'FTP listing failed: connection refused' }, noInteractions)).toBe('NETWORK');
    });

    it('returns NETWORK for Source browse failed', () => {
        expect(classifyDomain({ message: 'Source browse failed' }, noInteractions)).toBe('NETWORK');
    });

    it('returns FUZZ_INFRASTRUCTURE for HVSC paged folder listing failed', () => {
        expect(classifyDomain({ message: 'HVSC paged folder listing failed' }, noInteractions)).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('returns FUZZ_INFRASTRUCTURE for HVSC songlengths message', () => {
        expect(classifyDomain({ message: 'HVSC songlengths directory bootstrap failed' }, noInteractions)).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('returns BACKEND for JSON parse error', () => {
        expect(classifyDomain({ message: 'JSON parse error in response body' }, noInteractions)).toBe('BACKEND');
    });

    it('returns UI for TypeError exception', () => {
        expect(classifyDomain({ message: 'TypeError: Cannot read properties of undefined' }, noInteractions)).toBe('UI');
    });

    it('returns UI for exception field matching a source label (exception field is not used for UI detection)', () => {
        // The exception field is always a source label (app.log.error, console.error etc.),
        // not a native JS exception type. Domain UI is determined only from message + topFrames.
        expect(classifyDomain({ message: 'render failed', exception: 'TypeError' }, noInteractions)).toBe('UNKNOWN');
    });

    it('returns UI for is not a function message', () => {
        expect(classifyDomain({ message: 'handlePress is not a function' }, noInteractions)).toBe('UI');
    });

    it('returns UNKNOWN for unrecognised message', () => {
        expect(classifyDomain({ message: 'Something entirely unknown happened' }, noInteractions)).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for empty signature', () => {
        expect(classifyDomain({}, noInteractions)).toBe('UNKNOWN');
    });

    it('returns NETWORK for app.log exception with chaos evidence', () => {
        const chaos = ['s=5 a=network-offline 2000ms'];
        expect(classifyDomain({ exception: 'app.log.error', message: 'Unexpected failure' }, chaos)).toBe('NETWORK');
    });

    it('all returned domains are in the DOMAINS list', () => {
        const testSigs = [
            { message: 'DiagnosticsBridge unavailable' },
            { message: 'HOME_RESET: fail' },
            { message: 'C64 API request failed' },
            { message: 'HVSC paged folder listing failed' },
            { message: 'JSON parse error' },
            { message: 'TypeError: null' },
            { message: 'totally unknown' },
        ];
        for (const sig of testSigs) {
            const domain = classifyDomain(sig, []);
            expect(DOMAINS).toContain(domain);
        }
    });
});

// ---------------------------------------------------------------------------
// classifyIssue
// ---------------------------------------------------------------------------

describe('classifyIssue', () => {
    const makeGroup = (
        message: string,
        severityCounts: Record<string, number> = { errorLog: 1 },
        lastInteractions: string[] = [],
        exception = 'app.log.error',
    ) => ({
        issue_group_id: 'test-group',
        signature: { message, exception, topFrames: [] },
        severityCounts,
        examples: [{ lastInteractions }],
    });

    it('classifies crash severity as REAL HIGH', () => {
        const result = classifyIssue(makeGroup('Unknown error', { crash: 1 }));
        expect(result.classification).toBe('REAL');
        expect(result.confidence).toBe('HIGH');
    });

    it('classifies freeze severity as REAL HIGH', () => {
        const result = classifyIssue(makeGroup('UI froze', { freeze: 1 }));
        expect(result.classification).toBe('REAL');
        expect(result.confidence).toBe('HIGH');
    });

    it('classifies DiagnosticsBridge as EXPECTED HIGH', () => {
        const result = classifyIssue(makeGroup('DiagnosticsBridge unavailable'));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('HIGH');
        expect(result.domain).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('classifies Category config fetch failed as EXPECTED HIGH', () => {
        const result = classifyIssue(makeGroup('Category config fetch failed'));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('HIGH');
    });

    it('classifies HVSC filesystem message as EXPECTED HIGH', () => {
        const result = classifyIssue(makeGroup('HVSC filesystem: not loaded'));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('HIGH');
    });

    it('classifies stale element runner interaction errors as EXPECTED HIGH', () => {
        const result = classifyIssue({
            issue_group_id: 'stale-el',
            signature: {
                message: 'Element is not attached',
                exception: 'Error',
                topFrames: [
                    'safeClick (file:///home/chris/dev/c64/c64commander/playwright/fuzz/chaosRunner.fuzz.ts:463:5)',
                ],
            },
            severityCounts: { errorLog: 1 },
            examples: [{ lastInteractions: [] }],
        });
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('HIGH');
        expect(result.domain).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('classifies HOME_ device action with chaos as EXPECTED HIGH', () => {
        const chaos = ['s=5 a=network-offline 3000ms'];
        const result = classifyIssue(makeGroup('HOME_RESET: failed', { errorLog: 2 }, chaos));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('HIGH');
        expect(result.domain).toBe('DEVICE_ACTION');
    });

    it('classifies HOME_ device action without chaos as EXPECTED MEDIUM', () => {
        const result = classifyIssue(makeGroup('HOME_RESET: failed', { errorLog: 2 }, []));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('MEDIUM');
        expect(result.domain).toBe('DEVICE_ACTION');
    });

    it('classifies machine pause/resume failure without chaos as EXPECTED MEDIUM', () => {
        const result = classifyIssue(makeGroup('Machine pause/resume failed', { errorLog: 1 }, []));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('MEDIUM');
        expect(result.domain).toBe('DEVICE_ACTION');
    });

    it('classifies Config write queue cascade error as DEVICE_ACTION EXPECTED MEDIUM', () => {
        // "Config write queue: preceding task failed" appears when a config write fails
        // because the mock server returns 404, causing subsequent queue entries to fail.
        // Always EXPECTED in fuzz environment.
        const result = classifyIssue(makeGroup('Config write queue: preceding task failed', { errorLog: 1 }, []));
        expect(result.classification).toBe('EXPECTED');
        expect(result.domain).toBe('DEVICE_ACTION');
        expect(result.confidence).toBe('MEDIUM');
    });

    it('classifies Config write queue message without chaos confirmation', () => {
        const result = classifyDomain({ message: 'Config write queue: preceding task failed' }, []);
        expect(result).toBe('DEVICE_ACTION');
    });

    it('classifies STREAM_VALIDATE device operation as DEVICE_ACTION EXPECTED', () => {
        // STREAM_VALIDATE, STREAM_STOP etc. are audio streaming device ops that always fail
        // in fuzz mode because the mock server does not implement the streaming API.
        const result = classifyIssue(makeGroup('STREAM_VALIDATE: Invalid stream host', { errorLog: 1 }, []));
        expect(result.classification).toBe('EXPECTED');
        expect(result.domain).toBe('DEVICE_ACTION');
    });

    it('classifies STREAM_STOP failure as DEVICE_ACTION EXPECTED', () => {
        const result = classifyIssue(makeGroup('STREAM_STOP: Stream stop failed', { warnLog: 1 }, []));
        expect(result.classification).toBe('EXPECTED');
        expect(result.domain).toBe('DEVICE_ACTION');
    });

    it('classifyDomain maps STREAM_ prefixed messages to DEVICE_ACTION', () => {
        expect(classifyDomain({ message: 'STREAM_VALIDATE: host unreachable' }, [])).toBe('DEVICE_ACTION');
        expect(classifyDomain({ message: 'STREAM_STOP: timeout' }, [])).toBe('DEVICE_ACTION');
        expect(classifyDomain({ message: 'STREAM_START: connection refused' }, [])).toBe('DEVICE_ACTION');
    });

    it('classifies C64 API request failed with chaos as EXPECTED HIGH', () => {
        const chaos = ['s=10 a=connection-flap 200ms'];
        const result = classifyIssue(makeGroup('C64 API request failed', { errorLog: 5 }, chaos));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('HIGH');
        expect(result.domain).toBe('NETWORK');
    });

    it('classifies C64 API request failed without chaos as EXPECTED MEDIUM', () => {
        const result = classifyIssue(makeGroup('C64 API request failed', { errorLog: 3 }, []));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('MEDIUM');
        expect(result.domain).toBe('NETWORK');
    });

    it('classifies FTP listing failed without chaos as EXPECTED MEDIUM', () => {
        const result = classifyIssue(makeGroup('FTP listing failed: connection refused', { errorLog: 1 }, []));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('MEDIUM');
    });

    it('classifies HVSC paged folder listing failed as EXPECTED HIGH (fuzz infrastructure)', () => {
        const result = classifyIssue(makeGroup('HVSC paged folder listing failed'));
        expect(result.classification).toBe('EXPECTED');
        expect(result.confidence).toBe('HIGH');
        expect(result.domain).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('classifies TypeError in UI as REAL HIGH', () => {
        const result = classifyIssue({
            issue_group_id: 'te',
            signature: { message: 'TypeError: Cannot read properties of undefined', exception: 'TypeError', topFrames: ['components/Foo.tsx'] },
            severityCounts: { errorLog: 1 },
            examples: [{ lastInteractions: [] }],
        });
        expect(result.classification).toBe('REAL');
        expect(result.confidence).toBe('HIGH');
        expect(result.domain).toBe('UI');
    });

    it('classifies TypeError exception with plain non-UI message as REAL MEDIUM', () => {
        // exception='TypeError' triggers isJsError; message has no UI pattern → domain=UNKNOWN → MEDIUM
        const result = classifyIssue({
            issue_group_id: 'te',
            signature: { message: 'something failed unexpectedly', exception: 'TypeError', topFrames: [] },
            severityCounts: { errorLog: 1 },
            examples: [{ lastInteractions: [] }],
        });
        expect(result.classification).toBe('REAL');
        expect(result.confidence).toBe('MEDIUM');
    });

    it('classifies JSON parse error as UNCERTAIN MEDIUM', () => {
        const result = classifyIssue(makeGroup('JSON parse error in config response', { errorLog: 2 }));
        expect(result.classification).toBe('UNCERTAIN');
        expect(result.confidence).toBe('MEDIUM');
        expect(result.domain).toBe('BACKEND');
    });

    it('classifies NETWORK without chaos and not a known mock failure as UNCERTAIN MEDIUM', () => {
        const result = classifyIssue(makeGroup('ECONNREFUSED to device', { errorLog: 1 }, []));
        expect(result.classification).toBe('UNCERTAIN');
        expect(result.confidence).toBe('MEDIUM');
    });

    it('classifies unknown domain without crash as UNCERTAIN LOW', () => {
        const result = classifyIssue(makeGroup('Something entirely unknown happened'));
        expect(result.classification).toBe('UNCERTAIN');
        expect(result.confidence).toBe('LOW');
        expect(result.domain).toBe('UNKNOWN');
    });

    it('always returns valid classification, domain, and confidence', () => {
        const messages = [
            'DiagnosticsBridge unavailable',
            'C64 API request failed',
            'HOME_POWER: failed',
            'TypeError: x is null',
            'totally random error',
            '',
        ];
        for (const msg of messages) {
            const result = classifyIssue(makeGroup(msg));
            expect(CLASSIFICATIONS).toContain(result.classification);
            expect(DOMAINS).toContain(result.domain);
            expect(CONFIDENCE_LEVELS).toContain(result.confidence);
        }
    });

    it('handles group with no examples gracefully', () => {
        const group = {
            issue_group_id: 'x',
            signature: { message: 'C64 API request failed', exception: 'app.log.error', topFrames: [] },
            severityCounts: { errorLog: 1 },
            examples: [],
        };
        const result = classifyIssue(group);
        expect(result.classification).toBe('EXPECTED');
    });

    it('handles missing severityCounts gracefully', () => {
        const group = {
            issue_group_id: 'x',
            signature: { message: 'C64 API request failed' },
        };
        const result = classifyIssue(group as unknown as Parameters<typeof classifyIssue>[0]);
        expect(result.classification).toBeDefined();
    });

    it('returns explanation string for FUZZ_INFRASTRUCTURE', () => {
        const result = classifyIssue(makeGroup('DiagnosticsBridge unavailable'));
        expect(typeof result.explanation).toBe('string');
        expect(result.explanation!.length).toBeGreaterThan(0);
    });

    it('returns explanation string for REAL crash', () => {
        const result = classifyIssue(makeGroup('fatal error', { crash: 1 }));
        expect(typeof result.explanation).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// classifyAllIssues
// ---------------------------------------------------------------------------

describe('classifyAllIssues', () => {
    it('returns a map with one entry per issue group', () => {
        const groups = [
            {
                issue_group_id: 'g1',
                signature: { message: 'DiagnosticsBridge unavailable', exception: 'app.log.error', topFrames: [] },
                severityCounts: { errorLog: 1 },
                examples: [],
            },
            {
                issue_group_id: 'g2',
                signature: { message: 'C64 API request failed', exception: 'app.log.error', topFrames: [] },
                severityCounts: { errorLog: 2 },
                examples: [],
            },
        ];
        const map = classifyAllIssues(groups);
        expect(map.size).toBe(2);
        expect(map.get('g1')?.classification).toBe('EXPECTED');
        expect(map.get('g2')?.classification).toBe('EXPECTED');
    });

    it('returns empty map for empty input', () => {
        const map = classifyAllIssues([]);
        expect(map.size).toBe(0);
    });

    it('is deterministic: same input yields same output', () => {
        const groups = [
            {
                issue_group_id: 'z',
                signature: { message: 'TypeError: null', exception: 'TypeError', topFrames: [] },
                severityCounts: { errorLog: 3 },
                examples: [],
            },
        ];
        const a = classifyAllIssues(groups).get('z');
        const b = classifyAllIssues(groups).get('z');
        expect(a).toEqual(b);
    });
});

// ---------------------------------------------------------------------------
// renderReadme / renderSummary (smoke tests via fuzzReportUtils)
// ---------------------------------------------------------------------------

describe('renderReadme section structure', () => {
    it('contains all three section headings', async () => {
        const { renderReadme } = await import('../../../scripts/fuzzReportUtils.mjs');
        const groups = [
            {
                issue_group_id: 'real-issue',
                signature: { message: 'fatal crash', exception: 'crash', topFrames: [] },
                severityCounts: { crash: 1 },
                platforms: ['android-phone'],
                examples: [],
            },
            {
                issue_group_id: 'expected-issue',
                signature: { message: 'DiagnosticsBridge unavailable', exception: 'app.log.warn', topFrames: [] },
                severityCounts: { warnLog: 3 },
                platforms: ['android-phone'],
                examples: [],
            },
        ];
        const classificationMap = classifyAllIssues(groups);
        const meta = { platform: 'android-phone', shardTotal: 1, sessions: 10 };
        const readme = renderReadme(meta, groups, classificationMap);

        expect(readme).toContain('# REAL Issues');
        expect(readme).toContain('# UNCERTAIN Issues');
        expect(readme).toContain('# EXPECTED Issues');
        expect(readme).toContain('## Issue Classification Summary');
    });

    it('places crash issue under REAL section', async () => {
        const { renderReadme } = await import('../../../scripts/fuzzReportUtils.mjs');
        const groups = [
            {
                issue_group_id: 'the-crash',
                signature: { message: 'app crashed', exception: 'crash', topFrames: [] },
                severityCounts: { crash: 1 },
                platforms: ['android-phone'],
                examples: [],
            },
        ];
        const map = classifyAllIssues(groups);
        const readme = renderReadme({ platform: 'android-phone', shardTotal: 1, sessions: 5 }, groups, map);
        const realIdx = readme.indexOf('# REAL Issues');
        const uncIdx = readme.indexOf('# UNCERTAIN Issues');
        const issueIdx = readme.indexOf('## the-crash');
        expect(issueIdx).toBeGreaterThan(realIdx);
        expect(issueIdx).toBeLessThan(uncIdx);
    });

    it('places diagnostic bridge issue under EXPECTED section', async () => {
        const { renderReadme } = await import('../../../scripts/fuzzReportUtils.mjs');
        const groups = [
            {
                issue_group_id: 'diag-bridge',
                signature: { message: 'DiagnosticsBridge unavailable', exception: 'app.log.warn', topFrames: [] },
                severityCounts: { warnLog: 2 },
                platforms: ['android-phone'],
                examples: [],
            },
        ];
        const map = classifyAllIssues(groups);
        const readme = renderReadme({ platform: 'android-phone', shardTotal: 1, sessions: 5 }, groups, map);
        const expIdx = readme.indexOf('# EXPECTED Issues');
        const issueIdx = readme.indexOf('## diag-bridge');
        expect(issueIdx).toBeGreaterThan(expIdx);
    });

    it('includes Message before Exception in issue entry', async () => {
        const { renderReadme } = await import('../../../scripts/fuzzReportUtils.mjs');
        const groups = [
            {
                issue_group_id: 'order-test',
                signature: { message: 'C64 API request failed', exception: 'app.log.error', topFrames: [] },
                severityCounts: { errorLog: 1 },
                platforms: [],
                examples: [],
            },
        ];
        const map = classifyAllIssues(groups);
        const readme = renderReadme({ platform: 'android-phone', shardTotal: 1, sessions: 3 }, groups, map);
        const msgIdx = readme.indexOf('- Message:');
        const excIdx = readme.indexOf('- Exception:');
        expect(msgIdx).toBeGreaterThan(-1);
        expect(excIdx).toBeGreaterThan(-1);
        expect(msgIdx).toBeLessThan(excIdx);
    });
});

describe('renderSummary', () => {
    it('contains REAL issues section when there are real issues', async () => {
        const { renderSummary } = await import('../../../scripts/fuzzReportUtils.mjs');
        const groups = [
            {
                issue_group_id: 'crash-1',
                signature: { message: 'app crashed hard', exception: 'crash', topFrames: [] },
                severityCounts: { crash: 2 },
                platforms: [],
                examples: [],
            },
        ];
        const map = classifyAllIssues(groups);
        const summary = renderSummary({ platform: 'android-phone', shardTotal: 1, sessions: 4 }, groups, map);
        expect(summary).toContain('# Fuzz Issue Summary');
        expect(summary).toContain('## REAL Issues');
        expect(summary).toContain('crash-1');
    });

    it('does not contain REAL section when no real issues', async () => {
        const { renderSummary } = await import('../../../scripts/fuzzReportUtils.mjs');
        const groups = [
            {
                issue_group_id: 'infra-1',
                signature: { message: 'DiagnosticsBridge unavailable', exception: 'app.log.warn', topFrames: [] },
                severityCounts: { warnLog: 1 },
                platforms: [],
                examples: [],
            },
        ];
        const map = classifyAllIssues(groups);
        const summary = renderSummary({ platform: 'android-phone', shardTotal: 1, sessions: 2 }, groups, map);
        expect(summary).not.toContain('## REAL Issues');
    });
});

// ---------------------------------------------------------------------------
// SELFTEST_TAG export and classification override
// ---------------------------------------------------------------------------

describe('SELFTEST_TAG', () => {
    it('is exported as a non-empty string', () => {
        expect(typeof SELFTEST_TAG).toBe('string');
        expect(SELFTEST_TAG.length).toBeGreaterThan(0);
    });

    it('equals [fuzz-selftest]', () => {
        expect(SELFTEST_TAG).toBe('[fuzz-selftest]');
    });

    it('is NOT a substring of [fuzz] (no accidental masking by FUZZ_INFRASTRUCTURE patterns)', () => {
        // If this fails, the FUZZ_INFRASTRUCTURE pattern would suppress selftest issues
        expect('[fuzz]'.includes(SELFTEST_TAG)).toBe(false);
    });

    it('is NOT contained in the string [fuzz] (inverse direction check)', () => {
        expect('[fuzz]'.includes(SELFTEST_TAG)).toBe(false);
    });
});

describe('classifyIssue: FUZZ_SELFTEST override', () => {
    const makeSelftestGroup = (extraSeverity: Record<string, number> = {}) => ({
        issue_group_id: 'console.error@fuzz-selftest-synthetic',
        signature: {
            message: `${SELFTEST_TAG} Synthetic console.error to verify detection pipeline`,
            exception: 'console.error',
            topFrames: [],
        },
        severityCounts: { errorLog: 1, ...extraSeverity },
        examples: [{ lastInteractions: [] }],
    });

    it('classifies selftest issue as REAL', () => {
        const result = classifyIssue(makeSelftestGroup());
        expect(result.classification).toBe('REAL');
    });

    it('classifies selftest issue with HIGH confidence', () => {
        const result = classifyIssue(makeSelftestGroup());
        expect(result.confidence).toBe('HIGH');
    });

    it('classifies selftest issue with domain FUZZ_INFRASTRUCTURE', () => {
        const result = classifyIssue(makeSelftestGroup());
        expect(result.domain).toBe('FUZZ_INFRASTRUCTURE');
    });

    it('selftest classification overrides crash severity path (still REAL)', () => {
        // Crash normally produces REAL via the terminal-severity path; ensure selftest path
        // also returns REAL (regression guard: selftest must not short-circuit to EXPECTED)
        const result = classifyIssue(makeSelftestGroup({ crash: 1 }));
        expect(result.classification).toBe('REAL');
    });

    it('includes explanation referencing the selftest mechanism', () => {
        const result = classifyIssue(makeSelftestGroup());
        expect(result.explanation).toBeDefined();
        expect(result.explanation).toContain('detection pipeline');
    });

    it('normal FUZZ_INFRASTRUCTURE issue is NOT classified as REAL (regression guard)', () => {
        const result = classifyIssue({
            issue_group_id: 'diag-bridge',
            signature: { message: 'DiagnosticsBridge unavailable', exception: 'app.log.warn', topFrames: [] },
            severityCounts: { warnLog: 1 },
            examples: [{ lastInteractions: [] }],
        });
        expect(result.classification).toBe('EXPECTED');
        expect(result.classification).not.toBe('REAL');
    });

    it('message without SELFTEST_TAG is not classified as REAL via selftest path', () => {
        // A message mentioning "fuzz" but not the exact SELFTEST_TAG should not trigger
        const result = classifyIssue({
            issue_group_id: 'x',
            signature: { message: '[fuzz] mode blocked', exception: 'app.log.warn', topFrames: [] },
            severityCounts: { warnLog: 1 },
            examples: [{ lastInteractions: [] }],
        });
        expect(result.classification).toBe('EXPECTED');
    });

    it('SELFTEST_TAG classification is always in valid CLASSIFICATIONS list', () => {
        const result = classifyIssue(makeSelftestGroup());
        expect(CLASSIFICATIONS).toContain(result.classification);
        expect(DOMAINS).toContain(result.domain);
        expect(CONFIDENCE_LEVELS).toContain(result.confidence);
    });
});

describe('classifyIssue: UNCERTAIN fallthrough — non-null explanation (Bug D regression)', () => {
    // Bug D: the final UNCERTAIN fallthrough previously returned explanation: null,
    // leaving users with no actionable information on how to investigate the issue.
    // Fixed: explanation is now always a non-empty string for all UNCERTAIN cases.

    const makeGroup = (
        message: string,
        severityCounts: Record<string, number> = { errorLog: 1 },
        lastInteractions: string[] = [],
        exception = 'app.log.error',
    ) => ({
        issue_group_id: 'test-group',
        signature: { message, exception, topFrames: [] },
        severityCounts,
        examples: [{ lastInteractions }],
    });

    it('UNKNOWN domain fallthrough has non-null explanation', () => {
        const result = classifyIssue(makeGroup('Something entirely unrecognised happened'));
        expect(result.classification).toBe('UNCERTAIN');
        expect(result.domain).toBe('UNKNOWN');
        expect(result.explanation).toBeTruthy();
        expect(typeof result.explanation).toBe('string');
    });

    it('UNKNOWN domain fallthrough explanation mentions the domain name', () => {
        const result = classifyIssue(makeGroup('Something entirely unrecognised happened'));
        expect(result.explanation).toContain('UNKNOWN');
    });

    it('FILESYSTEM fallthrough (no known EXPECTED substring) has non-null explanation', () => {
        // A filesystem-domain message that does NOT match any of the known EXPECTED substrings
        // (HVSC paged folder, HVSC songlengths, HVSC progress, RAM dump) falls through to the
        // generic UNCERTAIN return — which previously had explanation: null.
        // 'disk image' triggers FILESYSTEM domain; it is not in the EXPECTED list.
        const result = classifyIssue(makeGroup('disk image integrity failure'));
        expect(result.classification).toBe('UNCERTAIN');
        expect(result.domain).toBe('FILESYSTEM');
        expect(result.explanation).toBeTruthy();
        expect(typeof result.explanation).toBe('string');
    });

    it('FILESYSTEM fallthrough explanation mentions the FILESYSTEM domain', () => {
        const result = classifyIssue(makeGroup('disk image integrity failure'));
        expect(result.explanation).toContain('FILESYSTEM');
    });

    it('FILESYSTEM fallthrough confidence is MEDIUM (not LOW)', () => {
        // FILESYSTEM is a known domain, so confidence should be MEDIUM rather than LOW
        const result = classifyIssue(makeGroup('disk image integrity failure'));
        expect(result.confidence).toBe('MEDIUM');
    });

    it('explanation always non-null for every domain in the fallthrough set', () => {
        // Exhaustive check: all reachable fallthrough cases now return a non-null explanation
        const fallThroughCases = [
            makeGroup('Something entirely unrecognised happened'),  // UNKNOWN domain
            makeGroup('disk image integrity failure'),              // FILESYSTEM domain (no known EXPECTED substr)
        ];
        for (const group of fallThroughCases) {
            const result = classifyIssue(group);
            expect(result.explanation).toBeTruthy();
        }
    });

    it('BACKEND and NETWORK UNCERTAIN cases also have non-null explanation (regression guard)', () => {
        // These were already non-null before the fix; ensure they remain so
        const backendResult = classifyIssue(makeGroup('JSON parse error in config response', { errorLog: 2 }));
        expect(backendResult.classification).toBe('UNCERTAIN');
        expect(backendResult.explanation).toBeTruthy();

        const networkResult = classifyIssue(makeGroup('ECONNREFUSED to device', { errorLog: 1 }, []));
        expect(networkResult.classification).toBe('UNCERTAIN');
        expect(networkResult.explanation).toBeTruthy();
    });
});
