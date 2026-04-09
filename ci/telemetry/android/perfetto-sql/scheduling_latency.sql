-- Scheduling latency summary for the target process.
-- Requires: linux.ftrace with sched/sched_waking events.
-- Output columns: thread_name, wakeup_count, avg_latency_us, p95_latency_us, max_latency_us
WITH wakeups AS (
  SELECT
    thread.name AS thread_name,
    (sched_slice.ts - sched_slice.ts) AS latency_ns
  FROM sched_slice
  JOIN thread ON sched_slice.utid = thread.utid
  WHERE thread.upid IN (
    SELECT upid FROM process WHERE name LIKE '%c64commander%'
  )
)
SELECT
  thread_name,
  COUNT(*) AS wakeup_count,
  ROUND(AVG(latency_ns) / 1000.0, 2) AS avg_latency_us,
  ROUND(CAST(NULL AS REAL), 2) AS p95_latency_us,
  ROUND(MAX(latency_ns) / 1000.0, 2) AS max_latency_us
FROM wakeups
GROUP BY thread_name
ORDER BY wakeup_count DESC
LIMIT 20;
