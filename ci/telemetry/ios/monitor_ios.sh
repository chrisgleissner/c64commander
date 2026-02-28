#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "telemetry(ios): required command not found: $1" >&2
    exit 1
  fi
}

require_cmd xcrun
require_cmd awk
require_cmd ps

SAMPLING_INTERVAL_SEC="${TELEMETRY_INTERVAL_SEC:-1}"
PACKAGE_BUNDLE_ID="${BUNDLE_ID:-${APP_ID:-uk.gleissner.c64commander}}"
APP_PROCESS_NAME="${TELEMETRY_IOS_APP_PROCESS_NAME:-App}"
DEVICE_NAME="${TELEMETRY_DEVICE_NAME:-ios-simulator}"
OUT_DIR="${TELEMETRY_OUTPUT_DIR:-ci-artifacts/telemetry/ios}"
CSV_PATH="${TELEMETRY_CSV_PATH:-$OUT_DIR/metrics.csv}"
EVENTS_PATH="${TELEMETRY_EVENTS_PATH:-$OUT_DIR/events.log}"
META_PATH="${TELEMETRY_METADATA_PATH:-$OUT_DIR/metadata.json}"
SLOW_METRICS_PATH="${TELEMETRY_SLOW_METRICS_PATH:-$OUT_DIR/slow_metrics.csv}"
LOG_PATH="${TELEMETRY_MONITOR_LOG_PATH:-$OUT_DIR/monitor.log}"
ENABLE_VMMAP="${TELEMETRY_ENABLE_VMMAP:-0}"
VMMAP_INTERVAL_SEC="${TELEMETRY_VMMAP_INTERVAL_SEC:-30}"
EXPECT_MAIN_PID="${TELEMETRY_EXPECT_MAIN_PID:-1}"
CI_JOB_NAME="${GITHUB_JOB:-unknown-job}"
CI_RUN_ID="${GITHUB_RUN_ID:-local}"
CI_SHA="${GITHUB_SHA:-unknown}"
FLOW_LIFECYCLE_DIR="${TELEMETRY_FLOW_LIFECYCLE_DIR:-$OUT_DIR}"
FLOW_ACTIVE_FLAG="$FLOW_LIFECYCLE_DIR/flow-active.flag"
FLOW_COMPLETE_FLAG="$FLOW_LIFECYCLE_DIR/flow-complete.flag"

mkdir -p "$OUT_DIR"
mkdir -p "$FLOW_LIFECYCLE_DIR"

echo "timestamp,platform,device,process_name,pid,cpu_percent,rss_kb,threads,pss_kb,dalvik_pss_kb,native_pss_kb,total_pss_kb" > "$CSV_PATH"
printf 'timestamp,platform,device,process_name,pid,physical_footprint_kb\n' > "$SLOW_METRICS_PATH"
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

resolve_udid() {
  if [[ -n "${SIMULATOR_UDID:-}" ]]; then
    printf '%s' "$SIMULATOR_UDID"
    return 0
  fi
  xcrun simctl list devices booted | awk -F '[()]' '/Booted/ {print $2; exit}'
}

spawn_ps() {
  local out=""

  out="$(xcrun simctl spawn "$SIMULATOR_UDID" ps -A -o pid=,ppid=,comm=,args= 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    process_source="simulator"
    printf '%s' "$out"
    return 0
  fi

  out="$(xcrun simctl spawn "$SIMULATOR_UDID" ps -ax -o pid=,ppid=,comm=,args= 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    process_source="simulator"
    printf '%s' "$out"
    return 0
  fi

  if [[ "$logged_host_fallback" == "0" || "$process_source" != "host" ]]; then
    log_event "sample_warning" "$PACKAGE_BUNDLE_ID:event" "" "simctl process listing unavailable; falling back to host ps"
    logged_host_fallback=1
  fi
  process_source="host"
  ps -axo pid=,ppid=,comm=,args= 2>/dev/null
}

find_app_pid_launchctl() {
  xcrun simctl spawn "$SIMULATOR_UDID" launchctl list 2>/dev/null | awk -v bundle="$PACKAGE_BUNDLE_ID" '
    $1 ~ /^[0-9]+$/ && $3 == bundle {
      print $1
      exit
    }
  '
}

find_app_pid() {
  local ps_out="$1"
  local pid

  pid="$(awk -v bundle="$PACKAGE_BUNDLE_ID" '
    index($0, bundle) > 0 {
      if ($1 ~ /^[0-9]+$/) { print $1; exit }
    }
  ' <<< "$ps_out")"
  if [[ -n "$pid" ]]; then
    printf '%s' "$pid"
    return 0
  fi

  pid="$(awk -v comm="$APP_PROCESS_NAME" '
    index($0, "/" comm ".app/" comm) > 0 && $1 ~ /^[0-9]+$/ {
      print $1
      exit
    }
  ' <<< "$ps_out")"
  if [[ -n "$pid" ]]; then
    printf '%s' "$pid"
    return 0
  fi

  if [[ "$process_source" == "simulator" ]]; then
    awk -v comm="$APP_PROCESS_NAME" '
    $3 == comm && $1 ~ /^[0-9]+$/ {
      print $1
      exit
    }
  ' <<< "$ps_out"
  fi
}

find_webkit_children() {
  local ps_out="$1"
  local parent_pid="$2"
  awk -v ppid="$parent_pid" '
    $2 == ppid && ($3 ~ /WebKit\.WebContent/ || $3 ~ /WebKit\.Networking/) {
      print $1 " " $3
    }
  ' <<< "$ps_out"
}

read_ps_metrics() {
  local pid="$1"
  local line
  # CPU/RSS sampling is intentionally host-level on macOS runners.
  line="$(ps -p "$pid" -o %cpu=,rss=,nlwp= 2>/dev/null | awk 'NF{print $1" "$2" "$3; exit}')"
  if [[ -n "$line" ]]; then
    printf '%s' "$line"
    return 0
  fi

  line="$(ps -p "$pid" -o %cpu=,rss= 2>/dev/null | awk 'NF{print $1" "$2; exit}')"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s ' "$line"
}

running=1
main_seen_once=0
main_disappeared=0
main_disappeared_during_flow=0
last_app_pid=""
last_vmmap_ts=0
run_start_ts="$(date -u +%s)"
process_source="simulator"
logged_host_fallback=0

trap 'running=0' INT TERM

SIMULATOR_UDID="$(resolve_udid || true)"
if [[ -z "$SIMULATOR_UDID" ]]; then
  echo "telemetry(ios): no booted simulator UDID found" >&2
  exit 1
fi

log "telemetry(ios): started udid=$SIMULATOR_UDID bundle=$PACKAGE_BUNDLE_ID app_process=$APP_PROCESS_NAME interval=${SAMPLING_INTERVAL_SEC}s"
log_event "monitor_started" "$PACKAGE_BUNDLE_ID" "" "udid=$SIMULATOR_UDID app_process=$APP_PROCESS_NAME interval=${SAMPLING_INTERVAL_SEC}s"

while (( running == 1 )); do
  sample_ts="$(date -u +%s)"
  ps_out="$(spawn_ps || true)"

  if [[ -z "$ps_out" ]]; then
    log_event "sample_warning" "$PACKAGE_BUNDLE_ID:event" "" "failed to collect simulator process list"
    sleep "$SAMPLING_INTERVAL_SEC"
    continue
  fi

  app_pid="$(find_app_pid "$ps_out" || true)"
  if [[ -z "$app_pid" && "$process_source" == "simulator" ]]; then
    app_pid="$(find_app_pid_launchctl || true)"
  fi

  if [[ -z "$app_pid" ]]; then
    if [[ -n "$last_app_pid" ]]; then
      log_event "process_disappeared" "$PACKAGE_BUNDLE_ID:event" "$last_app_pid" "app process no longer visible"
      main_disappeared=1
      if [[ -f "$FLOW_ACTIVE_FLAG" && ! -f "$FLOW_COMPLETE_FLAG" ]]; then
        main_disappeared_during_flow=1
        log_event "process_disappeared_during_flow" "$PACKAGE_BUNDLE_ID:event" "$last_app_pid" "crash during active flow"
      else
        log_event "process_disappeared_after_flow" "$PACKAGE_BUNDLE_ID:event" "$last_app_pid" "expected teardown"
      fi
      last_app_pid=""
    fi
  else
    if [[ -z "$last_app_pid" ]]; then
      log_event "process_appeared" "$PACKAGE_BUNDLE_ID:event" "$app_pid" "app process detected"
    elif [[ "$last_app_pid" != "$app_pid" ]]; then
      log_event "process_restarted" "$PACKAGE_BUNDLE_ID:event" "$app_pid" "previous_pid=$last_app_pid"
    fi
    last_app_pid="$app_pid"
    main_seen_once=1

    if metrics="$(read_ps_metrics "$app_pid" || true)"; then
      read -r cpu_percent rss_kb threads <<< "$metrics"
      cpu_percent="$(awk -v c="${cpu_percent:-0}" 'BEGIN{printf "%.1f", c+0.0}')"
      printf '%s,ios,%s,%s,%s,%s,%s,%s,,,,\n' \
        "$sample_ts" \
        "$DEVICE_NAME" \
        "$PACKAGE_BUNDLE_ID" \
        "$app_pid" \
        "$cpu_percent" \
        "${rss_kb:-}" \
        "${threads:-}" >> "$CSV_PATH"
    else
      log_event "sample_warning" "$PACKAGE_BUNDLE_ID:event" "$app_pid" "failed to read per-pid metrics"
    fi

    while IFS=' ' read -r wk_pid wk_comm; do
      [[ -z "$wk_pid" ]] && continue
      if wk_metrics="$(read_ps_metrics "$wk_pid" || true)"; then
        read -r wk_cpu wk_rss wk_threads <<< "$wk_metrics"
        wk_cpu="$(awk -v c="${wk_cpu:-0}" 'BEGIN{printf "%.1f", c+0.0}')"
        printf '%s,ios,%s,%s,%s,%s,%s,%s,,,,\n' \
          "$sample_ts" \
          "$DEVICE_NAME" \
          "$wk_comm" \
          "$wk_pid" \
          "$wk_cpu" \
          "${wk_rss:-}" \
          "${wk_threads:-}" >> "$CSV_PATH"
      fi
    done < <(find_webkit_children "$ps_out" "$app_pid" || true)

    if [[ "$ENABLE_VMMAP" == "1" && $((sample_ts - last_vmmap_ts)) -ge "$VMMAP_INTERVAL_SEC" ]]; then
      if command -v vmmap >/dev/null 2>&1; then
        footprint_kb="$(vmmap -summary "$app_pid" 2>/dev/null | awk '
          /Physical footprint/ {
            for (i=1; i<=NF; i++) {
              if ($i ~ /^[0-9][0-9,]*([.][0-9]+)?$/) {
                gsub(/,/, "", $i)
                val=$i+0
                unit=$(i+1)
                if (unit ~ /^GB$/) val*=1024*1024
                else if (unit ~ /^MB$/) val*=1024
                else if (unit ~ /^KB$/) val*=1
                else if (unit ~ /^B$/) val/=1024
                printf "%.0f", val
                exit
              }
            }
          }
        ' || true)"
        if [[ -n "$footprint_kb" ]]; then
          printf '%s,ios,%s,%s,%s,%s\n' \
            "$sample_ts" "$DEVICE_NAME" "$PACKAGE_BUNDLE_ID" "$app_pid" "$footprint_kb" >> "$SLOW_METRICS_PATH"
        else
          log_event "slow_metric_warning" "$PACKAGE_BUNDLE_ID:event" "$app_pid" "vmmap footprint parse failed"
        fi
      else
        log_event "slow_metric_warning" "$PACKAGE_BUNDLE_ID:event" "$app_pid" "vmmap not available"
      fi
      last_vmmap_ts="$sample_ts"
    fi
  fi

  log "telemetry(ios): sample ts=$sample_ts"

  slept=0
  while (( running == 1 && slept < SAMPLING_INTERVAL_SEC )); do
    sleep 1
    slept=$((slept + 1))
  done
done

run_end_ts="$(date -u +%s)"
log_event "monitor_stopped" "$PACKAGE_BUNDLE_ID" "" "main_seen_once=$main_seen_once main_disappeared=$main_disappeared"

cat > "$META_PATH" <<EOF
{
  "platform": "ios",
  "device": "${DEVICE_NAME}",
  "simulator_udid": "${SIMULATOR_UDID}",
  "bundle_id": "${PACKAGE_BUNDLE_ID}",
  "job_name": "${CI_JOB_NAME}",
  "run_id": "${CI_RUN_ID}",
  "commit_sha": "${CI_SHA}",
  "sampling_interval_sec": ${SAMPLING_INTERVAL_SEC},
  "start_timestamp": ${run_start_ts},
  "end_timestamp": ${run_end_ts},
  "main_seen_once": ${main_seen_once},
  "main_disappeared": ${main_disappeared},
  "main_disappeared_during_flow": ${main_disappeared_during_flow}
}
EOF

if [[ "$EXPECT_MAIN_PID" == "1" && "$main_seen_once" == "1" && "$main_disappeared_during_flow" == "1" ]]; then
  echo "telemetry(ios): app process disappeared during active flow" >&2
  exit 3
fi

exit 0
