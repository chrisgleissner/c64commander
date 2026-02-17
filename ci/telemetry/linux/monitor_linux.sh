#!/usr/bin/env bash
set -euo pipefail

TELEMETRY_OUTPUT_DIR="${TELEMETRY_OUTPUT_DIR:-ci-artifacts/telemetry/linux}"
TELEMETRY_INTERVAL_SEC="${TELEMETRY_INTERVAL_SEC:-1}"
TELEMETRY_PROCESS_MATCH="${TELEMETRY_PROCESS_MATCH:-}"
TELEMETRY_PLATFORM="${TELEMETRY_PLATFORM:-linux}"

if [[ -z "$TELEMETRY_PROCESS_MATCH" ]]; then
  echo "telemetry-linux: TELEMETRY_PROCESS_MATCH is required" >&2
  exit 2
fi

mkdir -p "$TELEMETRY_OUTPUT_DIR"
METRICS_CSV="$TELEMETRY_OUTPUT_DIR/metrics.csv"
EVENTS_LOG="$TELEMETRY_OUTPUT_DIR/events.log"
META_JSON="$TELEMETRY_OUTPUT_DIR/metadata.json"
EXIT_CODE_FILE="$TELEMETRY_OUTPUT_DIR/monitor_exit_code"

{
  printf '{\n'
  printf '  "platform": "%s",\n' "$TELEMETRY_PLATFORM"
  printf '  "interval_sec": %s,\n' "$TELEMETRY_INTERVAL_SEC"
  printf '  "process_match": "%s",\n' "$TELEMETRY_PROCESS_MATCH"
  printf '  "started_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '}\n'
} >"$META_JSON"

printf 'timestamp,platform,device,process_name,pid,cpu_percent,rss_kb,threads,pss_kb,dalvik_pss_kb,native_pss_kb,total_pss_kb\n' >"$METRICS_CSV"
: >"$EVENTS_LOG"

stop_requested=0
on_term() {
  stop_requested=1
}
trap on_term TERM INT

find_pid() {
  ps -eo pid=,args= | awk -v pat="$TELEMETRY_PROCESS_MATCH" '$0 ~ pat {print $1; exit}'
}

read_proc() {
  local pid="$1"
  if [[ ! -r "/proc/$pid/stat" ]] || [[ ! -r "/proc/$pid/status" ]]; then
    return 1
  fi

  local stat status utime stime rss_pages threads rss_kb
  stat="$(</proc/$pid/stat)"
  status="$(</proc/$pid/status)"

  utime="$(awk '{print $14}' <<<"$stat")"
  stime="$(awk '{print $15}' <<<"$stat")"
  rss_pages="$(awk '{print $24}' <<<"$stat")"
  threads="$(awk '/^Threads:/ {print $2}' <<<"$status")"

  if [[ -z "$utime" || -z "$stime" || -z "$rss_pages" || -z "$threads" ]]; then
    return 1
  fi

  rss_kb="$((rss_pages * 4))"
  printf '%s %s %s %s\n' "$utime" "$stime" "$rss_kb" "$threads"
}

read_total_jiffies() {
  awk '/^cpu / {sum=0; for (i=2; i<=NF; i++) sum+=$i; print sum; exit}' /proc/stat
}

primary_pid=""
seen_pid=0
main_disappeared=0
prev_proc_jiffies=""
prev_total_jiffies=""
start_epoch="$(date +%s)"

while :; do
  now_epoch="$(date +%s)"
  rel_ts="$((now_epoch - start_epoch))"

  pid="$(find_pid || true)"
  if [[ -n "$pid" ]]; then
    if [[ -z "$primary_pid" ]]; then
      primary_pid="$pid"
      seen_pid=1
      printf '%s	pid_start	pid=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pid" >>"$EVENTS_LOG"
      prev_proc_jiffies=""
      prev_total_jiffies=""
    elif [[ "$pid" != "$primary_pid" ]]; then
      printf '%s	pid_replaced	old=%s	new=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$primary_pid" "$pid" >>"$EVENTS_LOG"
      primary_pid="$pid"
      prev_proc_jiffies=""
      prev_total_jiffies=""
    fi

    proc_data="$(read_proc "$pid" || true)"
    if [[ -n "$proc_data" ]]; then
      read -r utime stime rss_kb threads <<<"$proc_data"
      proc_jiffies="$((utime + stime))"
      total_jiffies="$(read_total_jiffies || echo 0)"

      cpu_percent=""
      if [[ -n "$prev_proc_jiffies" && -n "$prev_total_jiffies" && "$total_jiffies" -gt "$prev_total_jiffies" ]]; then
        delta_proc="$((proc_jiffies - prev_proc_jiffies))"
        delta_total="$((total_jiffies - prev_total_jiffies))"
        if [[ "$delta_proc" -lt 0 ]]; then
          delta_proc=0
        fi
        cpu_percent="$(awk -v dp="$delta_proc" -v dt="$delta_total" 'BEGIN { printf "%.2f", (dt > 0 ? (dp * 100.0 / dt) : 0) }')"
      fi

      prev_proc_jiffies="$proc_jiffies"
      prev_total_jiffies="$total_jiffies"

      printf '%s,%s,%s,%s,%s,%s,%s,%s,,,,\n' \
        "$rel_ts" \
        "$TELEMETRY_PLATFORM" \
        "linux-host" \
        "run-fuzz" \
        "$pid" \
        "$cpu_percent" \
        "$rss_kb" \
        "$threads" >>"$METRICS_CSV"
    fi
  else
    if [[ "$seen_pid" -eq 1 && "$main_disappeared" -eq 0 ]]; then
      printf '%s	pid_disappeared	pid=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$primary_pid" >>"$EVENTS_LOG"
      main_disappeared=1
    fi
  fi

  if [[ "$stop_requested" -eq 1 ]]; then
    break
  fi

  sleep "$TELEMETRY_INTERVAL_SEC"
done

exit_code=0
if [[ "$seen_pid" -eq 1 && "$main_disappeared" -eq 1 ]]; then
  exit_code=3
fi
printf '%s\n' "$exit_code" >"$EXIT_CODE_FILE"
exit "$exit_code"
