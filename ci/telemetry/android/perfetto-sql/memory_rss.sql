-- RSS memory (bytes) for the target process over time.
-- Requires: linux.process_stats data source.
-- Output columns: ts_sec, rss_bytes
SELECT
  CAST(ts / 1000000000 AS INTEGER) AS ts_sec,
  CAST(value AS INTEGER) AS rss_bytes
FROM counter
JOIN process_counter_track ON counter.track_id = process_counter_track.id
JOIN process USING (upid)
WHERE
  process.name LIKE '%c64commander%'
  AND process_counter_track.name = 'mem.rss'
ORDER BY ts_sec;
