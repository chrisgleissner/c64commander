#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "telemetry(android): required command not found: $1" >&2
    exit 1
  fi
}

require_cmd adb
require_cmd awk

SAMPLING_INTERVAL_SEC="${TELEMETRY_INTERVAL_SEC:-1}"
PSS_INTERVAL_SEC="${TELEMETRY_ANDROID_PSS_INTERVAL_SEC:-3}"
STARTUP_TIMEOUT_SEC="${TELEMETRY_STARTUP_TIMEOUT_SEC:-120}"
PACKAGE_NAME="${ANDROID_PACKAGE_NAME:-${APP_ID:-uk.gleissner.c64commander}}"
EXPECT_MAIN_PID="${TELEMETRY_EXPECT_MAIN_PID:-1}"
DEVICE_NAME="${TELEMETRY_DEVICE_NAME:-android-emulator}"
OUT_DIR="${TELEMETRY_OUTPUT_DIR:-ci-artifacts/telemetry/android}"
CSV_PATH="${TELEMETRY_CSV_PATH:-$OUT_DIR/metrics.csv}"
EVENTS_PATH="${TELEMETRY_EVENTS_PATH:-$OUT_DIR/events.log}"
META_PATH="${TELEMETRY_METADATA_PATH:-$OUT_DIR/metadata.json}"
SLOW_METRICS_PATH="${TELEMETRY_SLOW_METRICS_PATH:-$OUT_DIR/slow_metrics.csv}"
LOG_PATH="${TELEMETRY_MONITOR_LOG_PATH:-$OUT_DIR/monitor.log}"
CI_JOB_NAME="${GITHUB_JOB:-unknown-job}"
CI_RUN_ID="${GITHUB_RUN_ID:-local}"
CI_SHA="${GITHUB_SHA:-unknown}"

mkdir -p "$OUT_DIR"

echo "timestamp,platform,device,process_name,pid,cpu_percent,rss_kb,threads,pss_kb,dalvik_pss_kb,native_pss_kb,total_pss_kb" > "$CSV_PATH"
: > "$EVENTS_PATH"
: > "$LOG_PATH"

log() {
  printf '%s %s\n' "$(date -u +%s)" "$*" | tee -a "$LOG_PATH" >/dev/null
}

log_event() {
  local kind="$1"
  local process_name="$2"
  local pid="$3"
  local detail="$4"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%s)" "$kind" "$process_name" "$pid" "$detail" >> "$EVENTS_PATH"
}

adb_shell() {
  local cmd="$1"
  adb -s "$ADB_SERIAL" shell "$cmd" 2>/dev/null | tr -d '\r'
}

adb_shell_retry_nonempty() {
  local cmd="$1"
  local attempts="${2:-3}"
  local out=""
  local i
  for (( i=1; i<=attempts; i++ )); do
    out="$(adb_shell "$cmd" || true)"
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      return 0
    fi
    if (( i < attempts )); then
      sleep 0.2
    fi
  done
  printf '%s' "$out"
  return 0
}

resolve_serial() {
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    printf '%s' "$ANDROID_SERIAL"
    return 0
  fi
  adb devices | awk '/emulator-|[[:space:]]device$/{print $1; exit}'
}

wait_for_serial() {
  local start_ts
  start_ts="$(date -u +%s)"
  while true; do
    ADB_SERIAL="$(resolve_serial || true)"
    if [[ -n "$ADB_SERIAL" ]]; then
      export ADB_SERIAL
      return 0
    fi
    if (( $(date -u +%s) - start_ts >= STARTUP_TIMEOUT_SEC )); then
      echo "telemetry(android): no adb serial available within ${STARTUP_TIMEOUT_SEC}s" >&2
      exit 1
    fi
    sleep 1
  done
}

read_cpu_count() {
  local count
  count="$(adb_shell "getconf _NPROCESSORS_ONLN" | awk 'NF{print $1; exit}')"
  if [[ ! "$count" =~ ^[0-9]+$ || "$count" -lt 1 ]]; then
    count="$(adb_shell "grep -c '^processor' /proc/cpuinfo" | awk 'NF{print $1; exit}')"
  fi
  if [[ ! "$count" =~ ^[0-9]+$ || "$count" -lt 1 ]]; then
    count=1
  fi
  printf '%s' "$count"
}

read_total_jiffies() {
  adb_shell_retry_nonempty "awk '/^cpu / {s=0; for(i=2;i<=NF;i++) s+=\$i; print s; exit}' /proc/stat" 3 | awk 'NF{print $1; exit}'
}

read_proc_jiffies() {
  local pid="$1"
  adb_shell_retry_nonempty "awk '{print \$14+\$15}' /proc/$pid/stat" 2 | awk 'NF{print $1; exit}'
}

read_rss_threads() {
  local pid="$1"
  adb_shell "awk '/^VmRSS:/ {rss=\$2} /^Threads:/ {thr=\$2} END {print (rss==\"\"?\"\":rss) \" \" (thr==\"\"?\"\":thr)}' /proc/$pid/status"
}

read_pss_breakdown() {
  local pid="$1"
  local dump
  dump="$(adb_shell_retry_nonempty "dumpsys meminfo $pid" 2 || true)"
  if [[ -z "$dump" ]]; then
    printf '   '
    return 0
  fi

  local dalvik native total_row total_pss
  dalvik="$(printf '%s\n' "$dump" | awk '$1=="Dalvik" && $2=="Heap" {print $3; exit}')"
  native="$(printf '%s\n' "$dump" | awk '$1=="Native" && $2=="Heap" {print $3; exit}')"
  total_row="$(printf '%s\n' "$dump" | awk '$1=="TOTAL" && $2 ~ /^[0-9]+$/ {print $2; exit}')"
  total_pss="$(printf '%s\n' "$dump" | awk '$1=="TOTAL" && $2=="PSS:" {print $3; exit}')"

  if [[ -z "$total_pss" ]]; then
    total_pss="$total_row"
  fi

  printf '%s %s %s %s' "${total_pss:-}" "${dalvik:-}" "${native:-}" "${total_pss:-}"
}

resolve_process_pid() {
  local process_name="$1"
  local pid=""

  pid="$(adb_shell "pidof $process_name" | awk '{print $1; exit}' || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    printf '%s' "$pid"
    return 0
  fi

  pid="$(adb_shell "for f in /proc/[0-9]*/cmdline; do p=\${f#/proc/}; p=\${p%/cmdline}; c=\$(tr '\000' '\n' < \"\$f\" 2>/dev/null | awk 'NR==1{print; exit}'); if [ \"\$c\" = \"$process_name\" ]; then echo \"\$p\"; break; fi; done" | awk 'NF{print $1; exit}' || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    printf '%s' "$pid"
    return 0
  fi

  return 1
}

main_seen_once=0
main_disappeared=0
running=1
run_start_ts="$(date -u +%s)"
sample_rows=0

trap 'running=0' INT TERM

wait_for_serial
NUM_CPUS="$(read_cpu_count)"

log "telemetry(android): started serial=$ADB_SERIAL package=$PACKAGE_NAME interval=${SAMPLING_INTERVAL_SEC}s cpus=$NUM_CPUS"
log_event "monitor_started" "$PACKAGE_NAME" "" "serial=$ADB_SERIAL interval=${SAMPLING_INTERVAL_SEC}s cpus=$NUM_CPUS"

prev_total_jiffies=""
declare -A prev_proc_jiffies

declare -A prev_pid
declare -A missing_streak
declare -A cached_pss
declare -A last_pss_ts

while (( running == 1 )); do
  sample_ts="$(date -u +%s)"
  total_jiffies="$(read_total_jiffies || true)"
  if [[ ! "$total_jiffies" =~ ^[0-9]+$ ]]; then
    log_event "sample_warning" "$PACKAGE_NAME:event" "" "failed to read /proc/stat"
    sleep "$SAMPLING_INTERVAL_SEC"
    continue
  fi

  for process_name in "$PACKAGE_NAME" "$PACKAGE_NAME:renderer"; do
    role="renderer"
    if [[ "$process_name" == "$PACKAGE_NAME" ]]; then
      role="main"
    fi

    pid="$(resolve_process_pid "$process_name" || true)"

    if [[ -z "$pid" ]]; then
      missing_streak[$role]=$(( ${missing_streak[$role]:-0} + 1 ))
      if (( ${missing_streak[$role]} >= 2 )); then
        if [[ -n "${prev_pid[$role]:-}" ]]; then
          log_event "process_disappeared" "$process_name:event" "${prev_pid[$role]}" "process no longer visible"
          if [[ "$role" == "main" ]]; then
            main_disappeared=1
          fi
        fi
        unset "prev_pid[$role]"
        unset "prev_proc_jiffies[$role]"
      fi
      continue
    fi

    missing_streak[$role]=0

    if [[ -z "${prev_pid[$role]:-}" ]]; then
      log_event "process_appeared" "$process_name:event" "$pid" "process detected"
    elif [[ "${prev_pid[$role]}" != "$pid" ]]; then
      log_event "process_restarted" "$process_name:event" "$pid" "previous_pid=${prev_pid[$role]}"
      unset "prev_proc_jiffies[$role]"
    fi

    prev_pid[$role]="$pid"
    if [[ "$role" == "main" ]]; then
      main_seen_once=1
    fi

    proc_jiffies="$(read_proc_jiffies "$pid" || true)"
    if [[ ! "$proc_jiffies" =~ ^[0-9]+$ ]]; then
      log_event "sample_warning" "$process_name:event" "$pid" "failed to read /proc/$pid/stat"
      continue
    fi

    cpu_percent="0.0"
    if [[ -n "$prev_total_jiffies" && -n "${prev_proc_jiffies[$role]:-}" ]]; then
      delta_total=$((total_jiffies - prev_total_jiffies))
      delta_proc=$((proc_jiffies - prev_proc_jiffies[$role]))
      if (( delta_total > 0 && delta_proc >= 0 )); then
        cpu_percent="$(awk -v dp="$delta_proc" -v dt="$delta_total" -v c="$NUM_CPUS" 'BEGIN{printf "%.1f", (100.0*dp/dt)*c}')"
      fi
    fi

    read -r rss_kb threads <<< "$(read_rss_threads "$pid" || true)"
    use_cached_pss=0
    if [[ -n "${last_pss_ts[$role]:-}" ]]; then
      elapsed=$((sample_ts - last_pss_ts[$role]))
      if (( elapsed < PSS_INTERVAL_SEC )); then
        use_cached_pss=1
      fi
    fi

    if (( use_cached_pss == 1 )) && [[ -n "${cached_pss[$role]:-}" ]]; then
      read -r pss_kb dalvik_pss_kb native_pss_kb total_pss_kb <<< "${cached_pss[$role]}"
    else
      pss_payload="$(read_pss_breakdown "$pid" || true)"
      read -r pss_kb dalvik_pss_kb native_pss_kb total_pss_kb <<< "$pss_payload"
      cached_pss[$role]="$pss_payload"
      last_pss_ts[$role]="$sample_ts"
    fi

    printf '%s,android,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
      "$sample_ts" \
      "$DEVICE_NAME" \
      "$process_name" \
      "$pid" \
      "$cpu_percent" \
      "${rss_kb:-}" \
      "${threads:-}" \
      "${pss_kb:-}" \
      "${dalvik_pss_kb:-}" \
      "${native_pss_kb:-}" \
      "${total_pss_kb:-}" >> "$CSV_PATH"
    sample_rows=$((sample_rows + 1))

    prev_proc_jiffies[$role]="$proc_jiffies"
  done

  prev_total_jiffies="$total_jiffies"
  log "telemetry(android): sample ts=$sample_ts"

  slept=0
  while (( running == 1 && slept < SAMPLING_INTERVAL_SEC )); do
    sleep 1
    slept=$((slept + 1))
  done
done

run_end_ts="$(date -u +%s)"
log_event "monitor_stopped" "$PACKAGE_NAME" "" "main_seen_once=$main_seen_once main_disappeared=$main_disappeared"

cat > "$META_PATH" <<EOF
{
  "platform": "android",
  "device": "${DEVICE_NAME}",
  "adb_serial": "${ADB_SERIAL}",
  "package_name": "${PACKAGE_NAME}",
  "job_name": "${CI_JOB_NAME}",
  "run_id": "${CI_RUN_ID}",
  "commit_sha": "${CI_SHA}",
  "sampling_interval_sec": ${SAMPLING_INTERVAL_SEC},
  "sample_rows": ${sample_rows},
  "telemetry_samples_present": $([[ "$sample_rows" -gt 0 ]] && echo true || echo false),
  "start_timestamp": ${run_start_ts},
  "end_timestamp": ${run_end_ts},
  "main_seen_once": ${main_seen_once},
  "main_disappeared": ${main_disappeared}
}
EOF

if [[ "$EXPECT_MAIN_PID" == "1" && "$main_seen_once" == "1" && "$main_disappeared" == "1" ]]; then
  echo "telemetry(android): main process disappeared unexpectedly" >&2
  exit 3
fi

exit 0
