/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Format a millisecond session offset as VLC-friendly mm:ss.mmm for README timestamps.
 * @param {number} ms - Offset in milliseconds from session start.
 * @returns {string} Formatted timestamp, e.g. "01:23.456".
 */
export const formatFuzzTimestamp = (ms) => {
    const totalMs = Math.max(0, Math.round(ms));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const millis = totalMs % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

/**
 * Format a video path as a markdown link, appending a timestamp when available.
 * @param {string} video - Relative path to the video file.
 * @param {number|undefined} sessionOffsetMs - Milliseconds from session start, if known.
 * @returns {string} Markdown link with optional timestamp suffix.
 */
export const videoMarkdownLink = (video, sessionOffsetMs) => {
    const link = `[${video}](${video})`;
    return (typeof sessionOffsetMs === 'number' && Number.isFinite(sessionOffsetMs))
        ? `${link} @ ${formatFuzzTimestamp(sessionOffsetMs)}`
        : link;
};

/**
 * Sort issue groups deterministically: total count descending, issue_group_id ascending for ties.
 * Ensures README output is stable given the same input JSON.
 * @param {Array} issueGroups - Array of IssueGroup objects from fuzz-issue-report.json.
 * @returns {Array} New sorted array (original is not mutated).
 */
export const sortIssueGroups = (issueGroups) =>
    [...issueGroups].sort((a, b) => {
        const totalA = Object.values(a.severityCounts || {}).reduce((sum, v) => sum + (v || 0), 0);
        const totalB = Object.values(b.severityCounts || {}).reduce((sum, v) => sum + (v || 0), 0);
        if (totalB !== totalA) return totalB - totalA;
        return (a.issue_group_id || '').localeCompare(b.issue_group_id || '');
    });

/**
 * Render a single issue entry as Markdown bullet lines.
 *
 * Field order: Message → Domain → Confidence → Exception → Total → Severity →
 * Platforms → Top frames → Explanation → Videos → Screenshots → Shards
 *
 * @param {object} group - An IssueGroup from fuzz-issue-report.json.
 * @param {{ domain: string; confidence: string; explanation: string|null }} classification
 * @returns {string[]} Lines for this issue entry (no trailing blank line).
 */
export const renderIssueEntry = (group, classification) => {
    const lines = [];
    const totalCount = Object.values(group.severityCounts || {}).reduce((sum, v) => sum + (v || 0), 0);
    const examples = group.examples || [];
    const exampleVideos = examples.map((e) => e.video).filter(Boolean).slice(0, 3);
    const exampleScreens = examples.map((e) => e.screenshot).filter(Boolean).slice(0, 3);
    const shardIndices = [...new Set(examples.map((e) => e.shardIndex).filter((s) => typeof s === 'number'))].sort((a, b) => a - b);

    lines.push(`## ${group.issue_group_id}`);
    lines.push('');
    lines.push(`- Message: ${group.signature?.message || 'n/a'}`);
    lines.push(`- Domain: ${classification.domain}`);
    if (classification.confidence) {
        lines.push(`- Confidence: ${classification.confidence}`);
    }
    lines.push(`- Exception: ${group.signature?.exception || 'n/a'}`);
    lines.push(`- Total: ${totalCount}`);
    lines.push(
        `- Severity: crash=${group.severityCounts?.crash || 0} freeze=${group.severityCounts?.freeze || 0} error=${group.severityCounts?.errorLog || 0} warn=${group.severityCounts?.warnLog || 0}`,
    );
    lines.push(`- Platforms: ${(group.platforms || []).join(', ') || 'n/a'}`);
    lines.push(`- Top frames: ${(group.signature?.topFrames || []).join(' | ') || 'n/a'}`);
    if (classification.explanation) {
        lines.push(`- Explanation: ${classification.explanation}`);
    }
    if (exampleVideos.length) {
        const videoLinks = exampleVideos.map((video, i) => {
            const example = examples.filter((e) => e.video).at(i);
            return videoMarkdownLink(video, example?.sessionOffsetMs);
        });
        lines.push(`- Videos: ${videoLinks.join(', ')}`);
    }
    if (exampleScreens.length) {
        lines.push(`- Screenshots: ${exampleScreens.map((shot) => `[${shot}](${shot})`).join(', ')}`);
    }
    if (shardIndices.length) {
        lines.push(`- Shards: ${shardIndices.join(', ')}`);
    }

    return lines;
};

/**
 * Render the full README.md with header metadata, classification summary, and
 * three classified sections (REAL / UNCERTAIN / EXPECTED).
 *
 * @param {{
 *   platform: string;
 *   shardTotal: number;
 *   sessions: number;
 *   timeBudgetMs?: number;
 *   durationTotalMs?: number;
 * }} meta - Run metadata from the merged report.
 * @param {Array} sortedGroups - Issue groups sorted by sortIssueGroups.
 * @param {Map<string, { classification: string; domain: string; confidence: string; explanation: string|null }>} classificationMap
 * @returns {string} Full README.md content.
 */
export const renderReadme = (meta, sortedGroups, classificationMap) => {
    const lines = [];

    // Header
    lines.push('# Fuzz Test Summary');
    lines.push('');
    if (meta.durationTotalMs != null && meta.durationTotalMs > 0) {
        const totalSec = Math.round(meta.durationTotalMs / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        lines.push(`Duration: ${minutes}m ${seconds}s`);
    } else if (meta.timeBudgetMs) {
        const budgetSec = Math.round(meta.timeBudgetMs / 1000);
        const minutes = Math.floor(budgetSec / 60);
        const seconds = budgetSec % 60;
        lines.push(`Budget: ${minutes}m ${seconds}s`);
    }
    lines.push(`Platforms: ${meta.platform || 'n/a'}`);
    lines.push(`Shards: ${meta.shardTotal ?? 1}`);
    lines.push('');
    lines.push(`Sessions executed: ${meta.sessions ?? 0}`);
    lines.push(`Unique issue signatures: ${sortedGroups.length}`);
    lines.push('');

    // Classification summary
    const realGroups = sortedGroups.filter((g) => classificationMap.get(g.issue_group_id)?.classification === 'REAL');
    const uncertainGroups = sortedGroups.filter((g) => classificationMap.get(g.issue_group_id)?.classification === 'UNCERTAIN');
    const expectedGroups = sortedGroups.filter((g) => classificationMap.get(g.issue_group_id)?.classification === 'EXPECTED');

    lines.push('## Issue Classification Summary');
    lines.push('');
    lines.push(`- Total issues: ${sortedGroups.length}`);
    lines.push(`- REAL issues: ${realGroups.length}`);
    lines.push(`- UNCERTAIN issues: ${uncertainGroups.length}`);
    lines.push(`- EXPECTED issues: ${expectedGroups.length}`);
    lines.push('');
    lines.push('REAL issues indicate confirmed application defects.');
    lines.push('UNCERTAIN issues require investigation.');
    lines.push('EXPECTED issues are artifacts caused by fuzz-induced instability.');
    lines.push('');
    lines.push('Application log levels are preserved. Classification occurs only during fuzz report analysis.');

    // Helper to append a section
    const appendSection = (heading, groups) => {
        lines.push('');
        lines.push(`# ${heading}`);
        lines.push('');
        if (!groups.length) {
            lines.push('No issues in this category.');
            return;
        }
        for (const group of groups) {
            const cls = classificationMap.get(group.issue_group_id) || { domain: 'UNKNOWN', confidence: 'LOW', explanation: null };
            lines.push(...renderIssueEntry(group, cls));
            lines.push('');
        }
    };

    appendSection('REAL Issues', realGroups);
    appendSection('UNCERTAIN Issues', uncertainGroups);
    appendSection('EXPECTED Issues', expectedGroups);

    return lines.join('\n');
};

/**
 * Render fuzz-issue-summary.md — a compact version of the report for quick review.
 * Contains only the header metadata, classification counts, and REAL issue IDs with totals.
 *
 * @param {{
 *   platform: string;
 *   shardTotal: number;
 *   sessions: number;
 *   timeBudgetMs?: number;
 * }} meta
 * @param {Array} sortedGroups
 * @param {Map<string, { classification: string; domain: string; confidence: string }>} classificationMap
 * @returns {string}
 */
export const renderSummary = (meta, sortedGroups, classificationMap) => {
    const lines = [];
    lines.push('# Fuzz Issue Summary');
    lines.push('');
    lines.push(`Platform: ${meta.platform || 'n/a'}`);
    lines.push(`Shards: ${meta.shardTotal ?? 1}`);
    lines.push(`Sessions: ${meta.sessions ?? 0}`);
    lines.push(`Total unique signatures: ${sortedGroups.length}`);
    lines.push('');

    const realGroups = sortedGroups.filter((g) => classificationMap.get(g.issue_group_id)?.classification === 'REAL');
    const uncertainGroups = sortedGroups.filter((g) => classificationMap.get(g.issue_group_id)?.classification === 'UNCERTAIN');
    const expectedGroups = sortedGroups.filter((g) => classificationMap.get(g.issue_group_id)?.classification === 'EXPECTED');

    lines.push(`REAL: ${realGroups.length} | UNCERTAIN: ${uncertainGroups.length} | EXPECTED: ${expectedGroups.length}`);

    if (realGroups.length) {
        lines.push('');
        lines.push('## REAL Issues');
        lines.push('');
        for (const group of realGroups) {
            const cls = classificationMap.get(group.issue_group_id);
            const total = Object.values(group.severityCounts || {}).reduce((s, v) => s + (v || 0), 0);
            lines.push(`- ${group.issue_group_id} [${cls?.domain || 'UNKNOWN'} ${cls?.confidence || 'LOW'}] total=${total}: ${group.signature?.message || 'n/a'}`);
        }
    }

    if (uncertainGroups.length) {
        lines.push('');
        lines.push('## UNCERTAIN Issues');
        lines.push('');
        for (const group of uncertainGroups) {
            const cls = classificationMap.get(group.issue_group_id);
            const total = Object.values(group.severityCounts || {}).reduce((s, v) => s + (v || 0), 0);
            lines.push(`- ${group.issue_group_id} [${cls?.domain || 'UNKNOWN'} ${cls?.confidence || 'LOW'}] total=${total}: ${group.signature?.message || 'n/a'}`);
        }
    }

    return lines.join('\n');
};

