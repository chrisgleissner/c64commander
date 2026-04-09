-- CPU usage (percentage) for the target process over time.
-- Requires: linux.ftrace with sched/sched_switch events.
-- Output columns: ts_sec, cpu_percent
SELECT
  CAST(ts / 1000000000 AS INTEGER) AS ts_sec,
  ROUND(SUM(dur) * 100.0 / 1000000000, 2) AS cpu_percent
FROM sched_slice
WHERE
  utid IN (SELECT utid FROM thread WHERE upid IN (
    SELECT upid FROM process WHERE name LIKE '%c64commander%'
  ))
GROUP BY ts_sec
ORDER BY ts_sec;
