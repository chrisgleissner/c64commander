-- App-level trace sections emitted via android.os.Trace (atrace).
-- Requires: linux.ftrace with atrace_apps including the target package.
-- Output columns: section_name, count, total_dur_ms, avg_dur_ms, max_dur_ms
SELECT
  slice.name AS section_name,
  COUNT(*) AS count,
  ROUND(SUM(slice.dur) / 1000000.0, 2) AS total_dur_ms,
  ROUND(AVG(slice.dur) / 1000000.0, 2) AS avg_dur_ms,
  ROUND(MAX(slice.dur) / 1000000.0, 2) AS max_dur_ms
FROM slice
JOIN thread_track ON slice.track_id = thread_track.id
JOIN thread USING (utid)
JOIN process USING (upid)
WHERE
  process.name LIKE '%c64commander%'
  AND slice.name LIKE 'hvsc:%'
GROUP BY slice.name
ORDER BY total_dur_ms DESC;
