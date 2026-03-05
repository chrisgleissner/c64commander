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
