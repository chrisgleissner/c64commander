-- Frame jank metrics from FrameTimeline (requires atrace_categories: gfx, view).
-- Falls back gracefully when FrameTimeline data is unavailable.
-- Output columns: jank_type, frame_count, total_jank_dur_ms
SELECT
  jank_type,
  COUNT(*) AS frame_count,
  ROUND(SUM(dur) / 1000000.0, 2) AS total_jank_dur_ms
FROM actual_frame_timeline_slice
WHERE
  upid IN (SELECT upid FROM process WHERE name LIKE '%c64commander%')
  AND jank_type != 'None'
GROUP BY jank_type
ORDER BY total_jank_dur_ms DESC;
