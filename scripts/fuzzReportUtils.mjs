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
