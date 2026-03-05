/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
    formatFuzzTimestamp,
    videoMarkdownLink,
    sortIssueGroups,
    renderIssueEntry,
    sanitizeMarkdownText,
} from '../../../scripts/fuzzReportUtils.mjs';

describe('formatFuzzTimestamp', () => {
    it('formats zero as 00:00.000', () => {
        expect(formatFuzzTimestamp(0)).toBe('00:00.000');
    });

    it('formats 90123 ms as 01:30.123', () => {
        expect(formatFuzzTimestamp(90123)).toBe('01:30.123');
    });

    it('clamps negative values to 00:00.000', () => {
        expect(formatFuzzTimestamp(-500)).toBe('00:00.000');
    });

    it('formats large value near 60 minutes', () => {
        expect(formatFuzzTimestamp(3599999)).toBe('59:59.999');
    });

    it('formats exactly one minute', () => {
        expect(formatFuzzTimestamp(60000)).toBe('01:00.000');
    });

    it('pads single-digit minutes and seconds', () => {
        expect(formatFuzzTimestamp(5001)).toBe('00:05.001');
    });
});

describe('videoMarkdownLink', () => {
    it('returns bare markdown link when sessionOffsetMs is undefined', () => {
        expect(videoMarkdownLink('video.mp4', undefined)).toBe('[video.mp4](video.mp4)');
    });

    it('appends timestamp when sessionOffsetMs is a finite number', () => {
        expect(videoMarkdownLink('clip.mp4', 90123)).toBe('[clip.mp4](clip.mp4) @ 01:30.123');
    });

    it('returns bare link when sessionOffsetMs is NaN', () => {
        expect(videoMarkdownLink('clip.mp4', NaN)).toBe('[clip.mp4](clip.mp4)');
    });

    it('returns bare link when sessionOffsetMs is Infinity', () => {
        expect(videoMarkdownLink('clip.mp4', Infinity)).toBe('[clip.mp4](clip.mp4)');
    });

    it('returns bare link when sessionOffsetMs is null', () => {
        expect(videoMarkdownLink('clip.mp4', null)).toBe('[clip.mp4](clip.mp4)');
    });

    it('appends 00:00.000 for zero offset', () => {
        expect(videoMarkdownLink('clip.mp4', 0)).toBe('[clip.mp4](clip.mp4) @ 00:00.000');
    });
});

describe('sortIssueGroups', () => {
    const makeGroup = (id: string, counts: Record<string, number>) => ({
        issue_group_id: id,
        severityCounts: counts,
    });

    it('sorts by total count descending', () => {
        const groups = [
            makeGroup('b', { error: 1 }),
            makeGroup('a', { error: 5, warn: 3 }),
        ];
        const sorted = sortIssueGroups(groups);
        expect(sorted[0].issue_group_id).toBe('a');
        expect(sorted[1].issue_group_id).toBe('b');
    });

    it('breaks ties by issue_group_id ascending', () => {
        const groups = [
            makeGroup('z-group', { error: 2 }),
            makeGroup('a-group', { error: 2 }),
        ];
        const sorted = sortIssueGroups(groups);
        expect(sorted[0].issue_group_id).toBe('a-group');
        expect(sorted[1].issue_group_id).toBe('z-group');
    });

    it('does not mutate the original array', () => {
        const groups = [makeGroup('b', { error: 3 }), makeGroup('a', { error: 5 })];
        const original = [...groups];
        sortIssueGroups(groups);
        expect(groups[0].issue_group_id).toBe(original[0].issue_group_id);
        expect(groups[1].issue_group_id).toBe(original[1].issue_group_id);
    });

    it('is stable: same input produces same output on repeated calls', () => {
        const groups = [
            makeGroup('c', { error: 4 }),
            makeGroup('a', { warn: 4 }),
            makeGroup('b', { error: 2, warn: 2 }),
        ];
        const first = sortIssueGroups(groups).map((g: { issue_group_id: string }) => g.issue_group_id);
        const second = sortIssueGroups(groups).map((g: { issue_group_id: string }) => g.issue_group_id);
        expect(first).toEqual(second);
    });

    it('handles empty severityCounts gracefully', () => {
        const groups = [makeGroup('x', {}), makeGroup('y', {})];
        const sorted = sortIssueGroups(groups);
        expect(sorted[0].issue_group_id).toBe('x');
        expect(sorted[1].issue_group_id).toBe('y');
    });

    it('handles groups without severityCounts gracefully', () => {
        const groups = [
            { issue_group_id: 'no-counts' },
            makeGroup('with-counts', { error: 1 }),
        ];
        const sorted = sortIssueGroups(groups);
        expect(sorted[0].issue_group_id).toBe('with-counts');
        expect(sorted[1].issue_group_id).toBe('no-counts');
    });
});

describe('fuzz-issue-summary.md is generated as compact summary', () => {
    it('run-fuzz.mjs references fuzz-issue-summary.md as an output', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { resolve, dirname } = await import('node:path');
        const dir = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(dir, '../../../scripts/run-fuzz.mjs'), 'utf8');
        // The file must write 'fuzz-issue-summary.md'
        expect(src).toContain('fuzz-issue-summary.md');
    });
});

describe('renderIssueEntry', () => {
    const baseGroup = {
        issue_group_id: 'app.log.error@test-abc123',
        signature: { exception: 'app.log.error', message: 'C64 API request failed', topFrames: ['src/lib/c64api.ts:42'] },
        severityCounts: { crash: 0, freeze: 0, errorLog: 7, warnLog: 0 },
        platforms: ['android-phone'],
        examples: [],
    };
    const baseCls = { domain: 'NETWORK', confidence: 'HIGH', explanation: 'Network disruption.' };

    it('starts with issue_group_id as h2 heading', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        expect(lines[0]).toBe('## app.log.error@test-abc123');
    });

    it('Message appears before Exception', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        const msgIdx = lines.findIndex((l: string) => l.startsWith('- Message:'));
        const excIdx = lines.findIndex((l: string) => l.startsWith('- Exception:'));
        expect(msgIdx).toBeGreaterThan(-1);
        expect(excIdx).toBeGreaterThan(-1);
        expect(msgIdx).toBeLessThan(excIdx);
    });

    it('Domain appears before Exception', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        const domIdx = lines.findIndex((l: string) => l.startsWith('- Domain:'));
        const excIdx = lines.findIndex((l: string) => l.startsWith('- Exception:'));
        expect(domIdx).toBeLessThan(excIdx);
    });

    it('Confidence appears when provided', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        expect(lines.some((l: string) => l.startsWith('- Confidence: HIGH'))).toBe(true);
    });

    it('Explanation appears when provided', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        expect(lines.some((l: string) => l.startsWith('- Explanation:'))).toBe(true);
    });

    it('Explanation is omitted when null', () => {
        const lines = renderIssueEntry(baseGroup, { domain: 'UNKNOWN', confidence: 'LOW', explanation: null });
        expect(lines.some((l: string) => l.startsWith('- Explanation:'))).toBe(false);
    });

    it('Videos line is omitted when no examples have videos', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        expect(lines.some((l: string) => l.startsWith('- Videos:'))).toBe(false);
    });

    it('Videos line is included when example has video', () => {
        const group = {
            ...baseGroup,
            examples: [{ video: 'videos/session-1.webm', screenshot: undefined, sessionOffsetMs: 5000 }],
        };
        const lines = renderIssueEntry(group, baseCls);
        expect(lines.some((l: string) => l.startsWith('- Videos:'))).toBe(true);
        expect(lines.some((l: string) => l.includes('01:23') || l.includes('00:05'))).toBe(true);
    });

    it('Screenshots line is included when example has screenshot', () => {
        const group = {
            ...baseGroup,
            examples: [{ screenshot: 'screenshots/s1.png' }],
        };
        const lines = renderIssueEntry(group, baseCls);
        expect(lines.some((l: string) => l.startsWith('- Screenshots:'))).toBe(true);
    });

    it('Shards line is included when example has shardIndex', () => {
        const group = {
            ...baseGroup,
            examples: [{ shardIndex: 2 }],
        };
        const lines = renderIssueEntry(group, baseCls);
        expect(lines.some((l: string) => l.startsWith('- Shards:'))).toBe(true);
        expect(lines.some((l: string) => l.includes('2'))).toBe(true);
    });

    it('Shards line is omitted when no shardIndex present', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        expect(lines.some((l: string) => l.startsWith('- Shards:'))).toBe(false);
    });

    it('total count is sum of severityCounts', () => {
        const lines = renderIssueEntry(baseGroup, baseCls);
        const totalLine = lines.find((l: string) => l.startsWith('- Total:'));
        expect(totalLine).toBe('- Total: 7');
    });
});

// ---------------------------------------------------------------------------
// sanitizeMarkdownText
// ---------------------------------------------------------------------------

describe('sanitizeMarkdownText', () => {
    it('returns empty string for null', () => {
        expect(sanitizeMarkdownText(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(sanitizeMarkdownText(undefined)).toBe('');
    });

    it('returns empty string for empty string input', () => {
        expect(sanitizeMarkdownText('')).toBe('');
    });

    it('passes through plain ASCII unchanged', () => {
        expect(sanitizeMarkdownText('C64 API request failed')).toBe('C64 API request failed');
    });

    it('passes through markdown brackets and parentheses unchanged', () => {
        // Only newlines and ANSI codes are sanitised; brackets are valid inside list items
        expect(sanitizeMarkdownText('[link](url) and backtick `code`')).toBe('[link](url) and backtick `code`');
    });

    it('strips ANSI CSI colour reset code', () => {
        expect(sanitizeMarkdownText('\x1b[0mHello\x1b[0m')).toBe('Hello');
    });

    it('strips ANSI CSI bold + colour codes', () => {
        expect(sanitizeMarkdownText('\x1b[1;31mERROR\x1b[0m: bad thing')).toBe('ERROR: bad thing');
    });

    it('strips ANSI CSI erase-line code', () => {
        expect(sanitizeMarkdownText('\x1b[2Ktext')).toBe('text');
    });

    it('strips bare ESC character left over after stripping CSI', () => {
        expect(sanitizeMarkdownText('\x1btext')).toBe('text');
    });

    it('collapses Unix newline to a space', () => {
        expect(sanitizeMarkdownText('line1\nline2')).toBe('line1 line2');
    });

    it('collapses Windows CRLF to a space', () => {
        expect(sanitizeMarkdownText('line1\r\nline2')).toBe('line1 line2');
    });

    it('collapses bare CR to a space', () => {
        expect(sanitizeMarkdownText('line1\rline2')).toBe('line1 line2');
    });

    it('collapses multiple newlines to multiple spaces', () => {
        const result = sanitizeMarkdownText('a\nb\nc');
        expect(result).toBe('a b c');
        expect(result.split('\n')).toHaveLength(1);
    });

    it('handles combined ANSI codes and newlines', () => {
        expect(sanitizeMarkdownText('\x1b[31mError\x1b[0m:\ndetails here')).toBe('Error: details here');
    });

    it('handles very long message without truncation', () => {
        const long = 'x'.repeat(5000);
        const result = sanitizeMarkdownText(long);
        expect(result).toBe(long);
        expect(result).toHaveLength(5000);
    });

    it('coerces non-string values to string', () => {
        expect(sanitizeMarkdownText(42 as unknown as string)).toBe('42');
    });

    it('output never contains bare ESC character', () => {
        const inputs = [
            '\x1b[0m',
            '\x1b[1;32mGreen\x1b[0m',
            '\x1bM',
            'clean text',
            'line\nbreak',
        ];
        for (const input of inputs) {
            expect(sanitizeMarkdownText(input)).not.toContain('\x1b');
        }
    });

    it('output never contains newline character', () => {
        const inputs = [
            'a\nb',
            'a\r\nb',
            'a\rb',
            '\n',
            '\r\n',
        ];
        for (const input of inputs) {
            const result = sanitizeMarkdownText(input);
            expect(result).not.toContain('\n');
            expect(result).not.toContain('\r');
        }
    });
});

// ---------------------------------------------------------------------------
// renderIssueEntry: pathological message inputs (F matrix)
// ---------------------------------------------------------------------------

describe('renderIssueEntry: pathological message inputs', () => {
    const baseCls = { domain: 'NETWORK', confidence: 'HIGH', explanation: null };

    const makeGroupWithMessage = (message: string) => ({
        issue_group_id: 'test-group',
        signature: { exception: 'app.log.error', message, topFrames: [] },
        severityCounts: { errorLog: 1 },
        platforms: ['android-phone'],
        examples: [],
    });

    it('extremely long message renders without truncation and produces valid single-line Message field', () => {
        const longMsg = 'A'.repeat(4096);
        const lines = renderIssueEntry(makeGroupWithMessage(longMsg), baseCls);
        const msgLine = lines.find((l: string) => l.startsWith('- Message:'));
        expect(msgLine).toBeDefined();
        // The Message line itself must be a single line (no embedded newlines)
        expect(msgLine).not.toContain('\n');
        expect(msgLine).toContain('A'.repeat(200)); // spot-check content preserved
    });

    it('message with markdown brackets and parentheses keeps Message field on one line', () => {
        const msg = '[WARNING] click (Tab [music]) failed (retry=3)';
        const lines = renderIssueEntry(makeGroupWithMessage(msg), baseCls);
        const msgLine = lines.find((l: string) => l.startsWith('- Message:'));
        expect(msgLine).toBeDefined();
        expect(msgLine).not.toContain('\n');
        expect(msgLine).toContain('[WARNING]');
    });

    it('message with backticks renders without breaking surrounding structure', () => {
        const msg = 'Error in `handlePress`: `null` is not an object';
        const lines = renderIssueEntry(makeGroupWithMessage(msg), baseCls);
        const msgLine = lines.find((l: string) => l.startsWith('- Message:'));
        expect(msgLine).toBeDefined();
        expect(msgLine).not.toContain('\n');
    });

    it('message with embedded newline is collapsed to a single line', () => {
        const msg = 'First line\nSecond line\nThird line';
        const lines = renderIssueEntry(makeGroupWithMessage(msg), baseCls);
        const msgLine = lines.find((l: string) => l.startsWith('- Message:'));
        expect(msgLine).toBeDefined();
        // After sanitisation, the Message line must not contain any newline
        expect(msgLine).not.toContain('\n');
        // Content is preserved, just separated by spaces
        expect(msgLine).toContain('First line');
        expect(msgLine).toContain('Second line');
    });

    it('message with ANSI escape codes produces clean output without ESC chars', () => {
        const msg = '\x1b[31mERROR\x1b[0m: API call failed with status 503';
        const lines = renderIssueEntry(makeGroupWithMessage(msg), baseCls);
        const msgLine = lines.find((l: string) => l.startsWith('- Message:'));
        expect(msgLine).toBeDefined();
        expect(msgLine).not.toContain('\x1b');
        expect(msgLine).toContain('ERROR');
        expect(msgLine).toContain('API call failed with status 503');
    });

    it('explanation with newlines is sanitised to single line', () => {
        const cls = { domain: 'NETWORK', confidence: 'HIGH', explanation: 'Line one.\nLine two.\nLine three.' };
        const lines = renderIssueEntry(makeGroupWithMessage('some message'), cls);
        const expLine = lines.find((l: string) => l.startsWith('- Explanation:'));
        expect(expLine).toBeDefined();
        expect(expLine).not.toContain('\n');
        expect(expLine).toContain('Line one.');
    });

    it('issue_group_id with ANSI codes in heading is sanitised', () => {
        const group = {
            issue_group_id: '\x1b[1mgroup-id\x1b[0m',
            signature: { exception: 'app.log.error', message: 'test', topFrames: [] },
            severityCounts: { errorLog: 1 },
            platforms: [],
            examples: [],
        };
        const lines = renderIssueEntry(group, baseCls);
        expect(lines[0]).not.toContain('\x1b');
        expect(lines[0]).toContain('group-id');
    });
});

// ---------------------------------------------------------------------------
// README count parity (R4 regression: README counts must match JSON counts)
// ---------------------------------------------------------------------------

describe('renderReadme count parity', () => {
    it('classification counts in README header match actual group counts', async () => {
        const { renderReadme } = await import('../../../scripts/fuzzReportUtils.mjs');
        const { classifyAllIssues } = await import('../../../scripts/fuzzClassifier.mjs');

        const groups = [
            // Should become REAL (crash)
            {
                issue_group_id: 'crash-1',
                signature: { message: 'fatal crash', exception: 'crash', topFrames: [] },
                severityCounts: { crash: 1 },
                platforms: ['android-phone'],
                examples: [],
            },
            // Should become EXPECTED (fuzz infrastructure)
            {
                issue_group_id: 'infra-1',
                signature: { message: 'DiagnosticsBridge unavailable', exception: 'app.log.warn', topFrames: [] },
                severityCounts: { warnLog: 2 },
                platforms: ['android-phone'],
                examples: [],
            },
            {
                issue_group_id: 'infra-2',
                signature: { message: 'C64 API request failed', exception: 'app.log.error', topFrames: [] },
                severityCounts: { errorLog: 5 },
                platforms: ['android-phone'],
                examples: [{ lastInteractions: ['s=5 a=network-offline 1000ms'] }],
            },
            // Should become UNCERTAIN (backend)
            {
                issue_group_id: 'backend-1',
                signature: { message: 'JSON parse error in response', exception: 'app.log.error', topFrames: [] },
                severityCounts: { errorLog: 1 },
                platforms: ['android-phone'],
                examples: [],
            },
        ];

        const classificationMap = classifyAllIssues(groups);
        const meta = { platform: 'android-phone', shardTotal: 1, sessions: 10 };
        const readme = renderReadme(meta, groups, classificationMap);

        // Parse counts from the Classification Summary section
        const totalMatch = readme.match(/Total issues:\s*(\d+)/);
        const realMatch = readme.match(/REAL issues:\s*(\d+)/);
        const uncertainMatch = readme.match(/UNCERTAIN issues:\s*(\d+)/);
        const expectedMatch = readme.match(/EXPECTED issues:\s*(\d+)/);

        expect(totalMatch).not.toBeNull();
        expect(realMatch).not.toBeNull();
        expect(uncertainMatch).not.toBeNull();
        expect(expectedMatch).not.toBeNull();

        const totalInReadme = parseInt(totalMatch![1], 10);
        const realInReadme = parseInt(realMatch![1], 10);
        const uncertainInReadme = parseInt(uncertainMatch![1], 10);
        const expectedInReadme = parseInt(expectedMatch![1], 10);

        // Count actual classifications
        let actualReal = 0, actualUncertain = 0, actualExpected = 0;
        for (const group of groups) {
            const cls = classificationMap.get(group.issue_group_id);
            if (cls?.classification === 'REAL') actualReal++;
            else if (cls?.classification === 'UNCERTAIN') actualUncertain++;
            else if (cls?.classification === 'EXPECTED') actualExpected++;
        }

        // Parity checks
        expect(totalInReadme).toBe(groups.length);
        expect(realInReadme).toBe(actualReal);
        expect(uncertainInReadme).toBe(actualUncertain);
        expect(expectedInReadme).toBe(actualExpected);
        expect(realInReadme + uncertainInReadme + expectedInReadme).toBe(totalInReadme);
    });

    it('zero-issue run produces correct zero counts in README', async () => {
        const { renderReadme } = await import('../../../scripts/fuzzReportUtils.mjs');
        const { classifyAllIssues } = await import('../../../scripts/fuzzClassifier.mjs');

        const groups: unknown[] = [];
        const classificationMap = classifyAllIssues(groups as Parameters<typeof classifyAllIssues>[0]);
        const meta = { platform: 'android-phone', shardTotal: 1, sessions: 5 };
        const readme = renderReadme(meta, groups as Parameters<typeof renderReadme>[1], classificationMap);

        expect(readme).toContain('Total issues: 0');
        expect(readme).toContain('REAL issues: 0');
        expect(readme).toContain('UNCERTAIN issues: 0');
        expect(readme).toContain('EXPECTED issues: 0');
    });
});
