#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "telemetry(docker): required command not found: $1" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd awk

SAMPLING_INTERVAL_SEC="${TELEMETRY_INTERVAL_SEC:-1}"
CONTAINER_NAME="${TELEMETRY_DOCKER_CONTAINER_NAME:-c64commander-smoke}"
DEVICE_NAME="${TELEMETRY_DEVICE_NAME:-docker-host}"
OUT_DIR="${TELEMETRY_OUTPUT_DIR:-ci-artifacts/telemetry/docker}"
CSV_PATH="${TELEMETRY_CSV_PATH:-$OUT_DIR/metrics.csv}"
EVENTS_PATH="${TELEMETRY_EVENTS_PATH:-$OUT_DIR/events.log}"
META_PATH="${TELEMETRY_METADATA_PATH:-$OUT_DIR/metadata.json}"
LOG_PATH="${TELEMETRY_MONITOR_LOG_PATH:-$OUT_DIR/monitor.log}"
EXPECT_CONTAINER_UP="${TELEMETRY_EXPECT_CONTAINER_UP:-1}"
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

container_pid() {
  docker inspect --format '{{.State.Pid}}' "$CONTAINER_NAME" 2>/dev/null || true
}

container_running() {
  docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true
}

container_stats_line() {
  docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$CONTAINER_NAME" 2>/dev/null | head -n 1
}

to_kb() {
  local value="$1"
  python3 - "$value" <<'PY'
import re
import sys
raw = (sys.argv[1] if len(sys.argv) > 1 else '').strip()
if not raw:
    print('')
    raise SystemExit(0)
match = re.match(r'^([0-9]+(?:\.[0-9]+)?)\s*([KMG]i?B)$', raw)
if not match:
    print('')
    raise SystemExit(0)
num = float(match.group(1))
unit = match.group(2)
factor = {
    'KiB': 1,
    'MiB': 1024,
    'GiB': 1024 * 1024,
    'KB': 1000 / 1024,
    'MB': (1000 * 1000) / 1024,
    'GB': (1000 * 1000 * 1000) / 1024,
}.get(unit, 1)
print(int(num * factor))
PY
}

running=1
seen_once=0
disappeared=0
run_start_ts="$(date -u +%s)"

trap 'running=0' INT TERM

log "telemetry(docker): started container=$CONTAINER_NAME interval=${SAMPLING_INTERVAL_SEC}s"
log_event "monitor_started" "$CONTAINER_NAME" "" "interval=${SAMPLING_INTERVAL_SEC}s"

while (( running == 1 )); do
  ts="$(date -u +%s)"
  is_running="$(container_running)"
  pid="$(container_pid)"

  if [[ "$is_running" != "true" || -z "$pid" || "$pid" == "0" ]]; then
    if [[ "$seen_once" == "1" ]]; then
      disappeared=1
      log_event "container_disappeared" "$CONTAINER_NAME:event" "$pid" "container stopped or missing"
      seen_once=0
    fi
    sleep "$SAMPLING_INTERVAL_SEC"
    continue
  fi

  if [[ "$seen_once" == "0" ]]; then
    log_event "container_appeared" "$CONTAINER_NAME:event" "$pid" "container running"
  fi
  seen_once=1

  stats="$(container_stats_line || true)"
  cpu_percent="0.0"
  rss_kb=""
  if [[ -n "$stats" ]]; then
    cpu_raw="$(printf '%s' "$stats" | awk -F',' '{print $1}' | tr -d '%[:space:]')"
    mem_raw="$(printf '%s' "$stats" | awk -F',' '{print $2}' | awk -F'/' '{print $1}' | xargs)"
    if [[ -n "$cpu_raw" ]]; then
      cpu_percent="$(awk -v c="$cpu_raw" 'BEGIN{printf "%.1f", c+0.0}')"
    fi
    rss_kb="$(to_kb "$mem_raw")"
  fi

  printf '%s,docker,%s,%s,%s,%s,%s,,,,\n' \
    "$ts" "$DEVICE_NAME" "$CONTAINER_NAME" "$pid" "$cpu_percent" "${rss_kb:-}" >> "$CSV_PATH"

  log "telemetry(docker): sample ts=$ts"

  slept=0
  while (( running == 1 && slept < SAMPLING_INTERVAL_SEC )); do
    sleep 1
    slept=$((slept + 1))
  done
done

run_end_ts="$(date -u +%s)"
log_event "monitor_stopped" "$CONTAINER_NAME" "" "seen_once=$seen_once disappeared=$disappeared"

cat > "$META_PATH" <<EOF
{
  "platform": "docker",
  "device": "${DEVICE_NAME}",
  "container_name": "${CONTAINER_NAME}",
  "job_name": "${CI_JOB_NAME}",
  "run_id": "${CI_RUN_ID}",
  "commit_sha": "${CI_SHA}",
  "sampling_interval_sec": ${SAMPLING_INTERVAL_SEC},
  "start_timestamp": ${run_start_ts},
  "end_timestamp": ${run_end_ts},
  "container_seen_once": ${seen_once},
  "container_disappeared": ${disappeared}
}
EOF

if [[ "$EXPECT_CONTAINER_UP" == "1" && "$disappeared" == "1" ]]; then
  echo "telemetry(docker): container disappeared unexpectedly" >&2
  exit 3
fi

exit 0
