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

describe('fuzz-issue-summary.md no longer generated', () => {
  it('run-fuzz.mjs does not reference fuzz-issue-summary.md as an output', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { resolve, dirname } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(dir, '../../../scripts/run-fuzz.mjs'), 'utf8');
    // The file must not write 'fuzz-issue-summary.md'
    const writePattern = /writeFileSync[^)]*fuzz-issue-summary\.md/;
    expect(writePattern.test(src)).toBe(false);
  });
});
