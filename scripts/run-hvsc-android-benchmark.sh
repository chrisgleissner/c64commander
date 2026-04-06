#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="uk.gleissner.c64commander"
DEFAULT_OUTPUT_ROOT="$ROOT_DIR/ci-artifacts/hvsc-performance/android"
OUTPUT_ROOT="${OUTPUT_ROOT:-$DEFAULT_OUTPUT_ROOT}"
APK_PATH="${APK_PATH:-$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk}"
C64U_TARGET="${C64U_TARGET:-real}"
C64U_HOST="${C64U_HOST:-auto}"
HVSC_BASE_URL="${HVSC_BASE_URL:-}"
BENCHMARK_RUN_ID="${BENCHMARK_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-hvsc-android}"
PERFETTO_DURATION_SEC="${PERFETTO_DURATION_SEC:-180}"
MAESTRO_TAGS="${MAESTRO_TAGS:-hvsc-perf}"
DEVICE_ID="${DEVICE_ID:-}"
LOOPS="${LOOPS:-3}"
WARMUP="${WARMUP:-1}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --device-id <serial>            adb device id; defaults to first 9B0* device, then first online device
  --apk-path <path>               APK path to install
  --output-root <path>            Root output directory (default: $DEFAULT_OUTPUT_ROOT)
  --c64u-target <mock|real>       Smoke target (default: $C64U_TARGET)
  --c64u-host <host|auto>         Real-device host; probes u64 then c64u when set to auto
  --hvsc-base-url <url>           Override HVSC release base URL
  --benchmark-run-id <id>         Artifact run id (default: $BENCHMARK_RUN_ID)
  --perfetto-duration-sec <sec>   Perfetto trace duration (default: $PERFETTO_DURATION_SEC)
  --maestro-tags <tags>           Maestro tag filter list (default: $MAESTRO_TAGS)
  --loops <n>                     Number of measured loops (default: $LOOPS)
  --warmup <n>                    Number of warm-up loops to discard (default: $WARMUP)
  -h, --help                      Show this help
EOF
}

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

pick_device() {
  if [[ -n "$DEVICE_ID" ]]; then
    return 0
  fi

  DEVICE_ID=$(adb devices | awk 'NR>1 && $2=="device" && $1 ~ /^9B0/ {print $1; exit}')
  if [[ -z "$DEVICE_ID" ]]; then
    DEVICE_ID=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
  fi
  if [[ -z "$DEVICE_ID" ]]; then
    echo "No adb devices found. Connect a device or pass --device-id." >&2
    exit 1
  fi
}

probe_real_host() {
  if [[ "$C64U_TARGET" != "real" || "$C64U_HOST" != "auto" ]]; then
    return 0
  fi

  local candidate ip_addr
  for candidate in u64 c64u; do
    if curl -fsS --max-time 3 "http://${candidate}/v1/info" >/dev/null 2>&1; then
      # Resolve hostname to IP so the Android device can reach it
      # (the phone may not have the same mDNS/DNS as the dev machine)
      ip_addr=$(getent hosts "$candidate" 2>/dev/null | awk '{print $1; exit}')
      if [[ -n "$ip_addr" ]]; then
        # Verify the phone can actually reach this IP
        if adb -s "$DEVICE_ID" shell "curl -fsS --max-time 3 http://${ip_addr}/v1/info" >/dev/null 2>&1; then
          C64U_HOST="$ip_addr"
          log "Using real C64U host: $C64U_HOST (resolved from $candidate)"
          return 0
        fi
        log "Phone cannot reach $candidate at $ip_addr, trying next candidate"
      else
        # Fallback: use hostname directly if getent fails
        C64U_HOST="$candidate"
        log "Using real C64U host: $C64U_HOST (unresolved)"
        return 0
      fi
    fi
  done

  echo "Unable to reach a real C64U host at http://u64/v1/info or http://c64u/v1/info" >&2
  exit 1
}

pull_app_file() {
  local remote_name="$1"
  local destination="$2"
  adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'cat files/$remote_name'" > "$destination"
}

cleanup() {
  local exit_code=$?

  if [[ -n "${TELEMETRY_PID:-}" ]]; then
    kill "$TELEMETRY_PID" >/dev/null 2>&1 || true
    wait "$TELEMETRY_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "${PERFETTO_PID:-}" ]]; then
    wait "$PERFETTO_PID" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-id)
      DEVICE_ID="$2"
      shift 2
      ;;
    --apk-path)
      APK_PATH="$2"
      shift 2
      ;;
    --output-root)
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --c64u-target)
      C64U_TARGET="$2"
      shift 2
      ;;
    --c64u-host)
      C64U_HOST="$2"
      shift 2
      ;;
    --hvsc-base-url)
      HVSC_BASE_URL="$2"
      shift 2
      ;;
    --benchmark-run-id)
      BENCHMARK_RUN_ID="$2"
      shift 2
      ;;
    --perfetto-duration-sec)
      PERFETTO_DURATION_SEC="$2"
      shift 2
      ;;
    --maestro-tags)
      MAESTRO_TAGS="$2"
      shift 2
      ;;
    --loops)
      LOOPS="$2"
      shift 2
      ;;
    --warmup)
      WARMUP="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd adb
require_cmd curl
require_cmd node
require_cmd sed

pick_device
probe_real_host

RUN_DIR="$OUTPUT_ROOT/$BENCHMARK_RUN_ID"
MAESTRO_DIR="$RUN_DIR/maestro"
TELEMETRY_DIR="$RUN_DIR/telemetry"
PERFETTO_DIR="$RUN_DIR/perfetto"
SMOKE_DIR="$RUN_DIR/smoke"
SUMMARY_PATH="$RUN_DIR/summary.json"
mkdir -p "$MAESTRO_DIR" "$TELEMETRY_DIR" "$PERFETTO_DIR" "$SMOKE_DIR"

PERFETTO_REMOTE_PATH="/data/local/tmp/${BENCHMARK_RUN_ID}.pftrace"
PERFETTO_LOCAL_PATH="$PERFETTO_DIR/hvsc-baseline.pftrace"
PERFETTO_LOG_PATH="$PERFETTO_DIR/perfetto.log"
PERFETTO_CONFIG_PATH="$PERFETTO_DIR/perfetto-hvsc.cfg"
sed "s/__DURATION_MS__/$((${PERFETTO_DURATION_SEC} * 1000))/" \
  "$ROOT_DIR/ci/telemetry/android/perfetto-hvsc.cfg" > "$PERFETTO_CONFIG_PATH"

trap cleanup EXIT INT TERM

log "Starting Android telemetry capture"
ANDROID_SERIAL="$DEVICE_ID" \
TELEMETRY_DEVICE_NAME="$DEVICE_ID" \
TELEMETRY_OUTPUT_DIR="$TELEMETRY_DIR" \
"$ROOT_DIR/ci/telemetry/android/monitor_android.sh" &
TELEMETRY_PID=$!

log "Starting Perfetto capture"
adb -s "$DEVICE_ID" shell "rm -f '$PERFETTO_REMOTE_PATH'" >/dev/null 2>&1 || true
adb -s "$DEVICE_ID" shell "perfetto --txt -o '$PERFETTO_REMOTE_PATH' -c -" < "$PERFETTO_CONFIG_PATH" > "$PERFETTO_LOG_PATH" 2>&1 &
PERFETTO_PID=$!

TOTAL_LOOPS=$((WARMUP + LOOPS))
MAESTRO_STATUS=0

build_maestro_args() {
  local loop_output_dir="$1"
  local run_id="$2"
  local tag_override="${3:-$MAESTRO_TAGS}"
  local skip_reset="${4:-false}"
  local args=(
    --mode tags
    --tags "$tag_override"
    --device-id "$DEVICE_ID"
    --apk-path "$APK_PATH"
    --output-dir "$loop_output_dir"
    --c64u-target "$C64U_TARGET"
    --c64u-host "$C64U_HOST"
    --benchmark-run-id "$run_id"
  )
  if [[ -n "$HVSC_BASE_URL" ]]; then
    args+=(--hvsc-base-url "$HVSC_BASE_URL")
  fi
  if [[ "$skip_reset" == "true" ]]; then
    args+=(--skip-app-reset)
  fi
  echo "${args[@]}"
}

pull_smoke_snapshots() {
  local dest_dir="$1"
  mkdir -p "$dest_dir"

  if adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'test -f files/c64u-smoke-status.json'" >/dev/null 2>&1; then
    pull_app_file "c64u-smoke-status.json" "$dest_dir/c64u-smoke-status.json"
  fi

  mapfile -t benchmark_files < <(
    adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'cd files && ls c64u-smoke-benchmark-*.json 2>/dev/null || true'" | tr -d '\r'
  )
  for file_name in "${benchmark_files[@]}"; do
    [[ -z "$file_name" ]] && continue
    pull_app_file "$file_name" "$dest_dir/$file_name"
  done
}

clear_smoke_snapshots() {
  adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'cd files && rm -f c64u-smoke-benchmark-*.json c64u-smoke-status.json'" >/dev/null 2>&1 || true
}

log "Starting multi-loop HVSC benchmark: $WARMUP warmup + $LOOPS measured loops"

# Detect whether the tag set includes a setup phase.
# When using hvsc-perf tags, we need to run the setup flow (hvsc-perf-setup)
# first to download+ingest HVSC, then remaining flows in a separate pass.
SETUP_TAGS=""
REMAINING_TAGS=""
if [[ "$MAESTRO_TAGS" == *"hvsc-perf"* ]]; then
  SETUP_TAGS="hvsc-perf-setup"
  REMAINING_TAGS="hvsc-perf,-hvsc-perf-setup"
fi

for loop_index in $(seq 1 "$TOTAL_LOOPS"); do
  is_warmup=$([[ $loop_index -le $WARMUP ]] && echo "true" || echo "false")
  loop_label=$([[ "$is_warmup" == "true" ]] && echo "warmup-$loop_index" || echo "loop-$((loop_index - WARMUP))")
  loop_run_id="${BENCHMARK_RUN_ID}-${loop_label}"
  loop_maestro_dir="$MAESTRO_DIR/$loop_label"
  loop_smoke_dir="$SMOKE_DIR/$loop_label"
  mkdir -p "$loop_maestro_dir"

  log "[$loop_label] Clearing previous smoke snapshots"
  clear_smoke_snapshots

  loop_status=0
  if [[ -n "$SETUP_TAGS" ]]; then
    # Phase 1: Run setup flows (with full app reset)
    log "[$loop_label] Phase 1: Running Maestro HVSC setup flow"
    setup_dir="$loop_maestro_dir/setup"
    mkdir -p "$setup_dir"
    read -ra setup_args <<< "$(build_maestro_args "$setup_dir" "$loop_run_id-setup" "$SETUP_TAGS" "false")"
    set +e
    "$ROOT_DIR/scripts/run-maestro.sh" "${setup_args[@]}"
    setup_status=$?
    set -e

    if [[ $setup_status -ne 0 ]]; then
      log "[$loop_label] Setup phase failed with exit code $setup_status — skipping measurement flows"
      loop_status=$setup_status
    else
      # Phase 2: Run remaining flows (skip app reset to preserve HVSC state)
      log "[$loop_label] Phase 2: Running Maestro HVSC measurement flows"
      read -ra remaining_args <<< "$(build_maestro_args "$loop_maestro_dir" "$loop_run_id" "$REMAINING_TAGS" "true")"
      set +e
      "$ROOT_DIR/scripts/run-maestro.sh" "${remaining_args[@]}"
      remaining_status=$?
      set -e

      if [[ $remaining_status -ne 0 ]]; then
        loop_status=$remaining_status
      fi
    fi
  else
    # Single-phase: all flows in one Maestro run
    log "[$loop_label] Running Maestro HVSC perf flow"
    read -ra maestro_args <<< "$(build_maestro_args "$loop_maestro_dir" "$loop_run_id")"
    set +e
    "$ROOT_DIR/scripts/run-maestro.sh" "${maestro_args[@]}"
    loop_status=$?
    set -e
  fi

  log "[$loop_label] Pulling smoke benchmark artifacts"
  pull_smoke_snapshots "$loop_smoke_dir"

  if [[ "$is_warmup" == "true" ]]; then
    log "[$loop_label] Warm-up loop complete (artifacts retained but excluded from summary)"
  else
    if [[ $loop_status -ne 0 ]]; then
      MAESTRO_STATUS=$loop_status
      log "[$loop_label] Maestro flow failed with exit code $loop_status"
    else
      log "[$loop_label] Measured loop complete"
    fi
  fi
done

log "Waiting for Perfetto capture to finish"
wait "$PERFETTO_PID"
unset PERFETTO_PID

log "Stopping Android telemetry capture"
kill "$TELEMETRY_PID" >/dev/null 2>&1 || true
wait "$TELEMETRY_PID" >/dev/null 2>&1 || true
unset TELEMETRY_PID

log "Pulling Perfetto trace"
adb -s "$DEVICE_ID" pull "$PERFETTO_REMOTE_PATH" "$PERFETTO_LOCAL_PATH" >/dev/null

log "Extracting Perfetto metrics"
PERFETTO_METRICS_PATH="$PERFETTO_DIR/extracted-metrics.json"
node "$ROOT_DIR/scripts/hvsc/extract-perfetto-metrics.mjs" \
  --trace="$PERFETTO_LOCAL_PATH" \
  --output="$PERFETTO_METRICS_PATH" \
  --sql-dir="$ROOT_DIR/ci/telemetry/android/perfetto-sql" || true

# Collect only measured (non-warmup) smoke snapshot files for summary
MEASURED_SMOKE_FILES=()
for loop_index in $(seq 1 "$LOOPS"); do
  loop_smoke_dir="$SMOKE_DIR/loop-$loop_index"
  if [[ -d "$loop_smoke_dir" ]]; then
    while IFS= read -r -d '' file; do
      MEASURED_SMOKE_FILES+=("$file")
    done < <(find "$loop_smoke_dir" -name 'c64u-smoke-benchmark-*.json' -print0 | sort -z)
  fi
done

if [[ ${#MEASURED_SMOKE_FILES[@]} -eq 0 ]]; then
  echo "No smoke benchmark files were produced by the measured HVSC perf loops." >&2
  exit 1
fi

# Build --smoke-files argument for the summary writer
SMOKE_FILES_ARG=""
for file in "${MEASURED_SMOKE_FILES[@]}"; do
  SMOKE_FILES_ARG="${SMOKE_FILES_ARG:+$SMOKE_FILES_ARG,}$file"
done

node "$ROOT_DIR/scripts/hvsc/write-android-perf-summary.mjs" \
  --summary="$SUMMARY_PATH" \
  --run-id="$BENCHMARK_RUN_ID" \
  --device-id="$DEVICE_ID" \
  --target="$C64U_TARGET" \
  --host="$C64U_HOST" \
  --hvsc-base-url="$HVSC_BASE_URL" \
  --maestro-status="$MAESTRO_STATUS" \
  --perfetto-trace="$PERFETTO_LOCAL_PATH" \
  --perfetto-log="$PERFETTO_LOG_PATH" \
  --perfetto-metrics="$PERFETTO_METRICS_PATH" \
  --smoke-files="$SMOKE_FILES_ARG" \
  --telemetry-dir="$TELEMETRY_DIR" \
  --loops="$LOOPS" \
  --warmup="$WARMUP"

log "HVSC Android benchmark artifacts written to $RUN_DIR"
log "Summary: $SUMMARY_PATH"
exit "$MAESTRO_STATUS"
