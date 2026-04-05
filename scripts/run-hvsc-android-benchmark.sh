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

  local candidate
  for candidate in u64 c64u; do
    if curl -fsS --max-time 3 "http://${candidate}/v1/info" >/dev/null; then
      C64U_HOST="$candidate"
      log "Using real C64U host: $C64U_HOST"
      return 0
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

log "Running Maestro HVSC perf flow"
RUN_MAESTRO_ARGS=(
  --mode tags
  --tags "$MAESTRO_TAGS"
  --device-id "$DEVICE_ID"
  --apk-path "$APK_PATH"
  --output-dir "$MAESTRO_DIR"
  --c64u-target "$C64U_TARGET"
  --c64u-host "$C64U_HOST"
  --benchmark-run-id "$BENCHMARK_RUN_ID"
)
if [[ -n "$HVSC_BASE_URL" ]]; then
  RUN_MAESTRO_ARGS+=(--hvsc-base-url "$HVSC_BASE_URL")
fi

set +e
"$ROOT_DIR/scripts/run-maestro.sh" "${RUN_MAESTRO_ARGS[@]}"
MAESTRO_STATUS=$?
set -e

log "Waiting for Perfetto capture to finish"
wait "$PERFETTO_PID"
unset PERFETTO_PID

log "Stopping Android telemetry capture"
kill "$TELEMETRY_PID" >/dev/null 2>&1 || true
wait "$TELEMETRY_PID" >/dev/null 2>&1 || true
unset TELEMETRY_PID

log "Pulling Perfetto trace"
adb -s "$DEVICE_ID" pull "$PERFETTO_REMOTE_PATH" "$PERFETTO_LOCAL_PATH" >/dev/null

log "Pulling smoke benchmark artifacts"
if adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'test -f files/c64u-smoke-status.json'" >/dev/null 2>&1; then
  pull_app_file "c64u-smoke-status.json" "$SMOKE_DIR/c64u-smoke-status.json"
fi

mapfile -t benchmark_files < <(
  adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'cd files && ls c64u-smoke-benchmark-*.json 2>/dev/null || true'" | tr -d '\r'
)

if [[ ${#benchmark_files[@]} -eq 0 ]]; then
  echo "No smoke benchmark files were produced by the HVSC perf flow." >&2
  exit 1
fi

for file_name in "${benchmark_files[@]}"; do
  [[ -z "$file_name" ]] && continue
  pull_app_file "$file_name" "$SMOKE_DIR/$file_name"
done

for required_snapshot in c64u-smoke-benchmark-install.json c64u-smoke-benchmark-browse-query.json c64u-smoke-benchmark-playback-start.json; do
  if [[ ! -f "$SMOKE_DIR/$required_snapshot" ]]; then
    echo "Missing required smoke benchmark artifact: $required_snapshot" >&2
    exit 1
  fi
done

node - "$SUMMARY_PATH" "$BENCHMARK_RUN_ID" "$DEVICE_ID" "$C64U_TARGET" "$C64U_HOST" "$HVSC_BASE_URL" "$MAESTRO_STATUS" "$PERFETTO_LOCAL_PATH" "$SMOKE_DIR" <<'EOF'
const fs = require('fs');
const path = require('path');

const [summaryPath, runId, deviceId, target, host, hvscBaseUrl, maestroStatus, perfettoPath, smokeDir] = process.argv.slice(2);
const smokeFiles = fs.readdirSync(smokeDir).filter((file) => file.endsWith('.json')).sort();

const summary = {
  runId,
  deviceId,
  target,
  host: host || null,
  hvscBaseUrl: hvscBaseUrl || null,
  maestroStatus: Number(maestroStatus),
  perfettoTrace: path.relative(path.dirname(summaryPath), perfettoPath),
  smokeArtifacts: smokeFiles.map((file) => path.relative(path.dirname(summaryPath), path.join(smokeDir, file))),
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
EOF

log "HVSC Android benchmark artifacts written to $RUN_DIR"
exit "$MAESTRO_STATUS"
