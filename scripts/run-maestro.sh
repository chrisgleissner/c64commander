#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="uk.gleissner.c64commander"
APP_MAIN_ACTIVITY="$APP_ID/.MainActivity"
DEFAULT_APK="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
DEFAULT_OUTPUT_DIR="$ROOT_DIR/test-results/maestro"
OUTPUT_DIR="${OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
DEBUG_DIR=""
REPORT_PATH="${REPORT_PATH:-}"
CONFIG_PATH="$ROOT_DIR/.maestro/config.yaml"
BOOT_TIMEOUT_SECS=${BOOT_TIMEOUT_SECS:-180}
AUTOMATION_READY_TIMEOUT_SECS=${AUTOMATION_READY_TIMEOUT_SECS:-20}
POWER_STAYON_ENABLED=0
DEFAULT_LONG_TIMEOUT_MS=${DEFAULT_LONG_TIMEOUT_MS:-20000}
HVSC_PERF_LONG_TIMEOUT_MS=${HVSC_PERF_LONG_TIMEOUT_MS:-600000}
DEFAULT_TIMEOUT_MS=${DEFAULT_TIMEOUT_MS:-15000}
DEFAULT_SHORT_TIMEOUT_MS=${DEFAULT_SHORT_TIMEOUT_MS:-5000}

MODE=""
TAG_FILTERS=""
DEVICE_ID=""
APK_PATH="$DEFAULT_APK"
C64U_TARGET="${C64U_TARGET:-mock}"
C64U_HOST="${C64U_HOST:-C64U}"
HVSC_BASE_URL="${HVSC_BASE_URL:-}"
BENCHMARK_RUN_ID="${BENCHMARK_RUN_ID:-}"
SKIP_APP_RESET="${SKIP_APP_RESET:-false}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --mode <ci|all|tags>     Run ci-critical, all, or tag-filtered flows
  --tags <list>            Comma-separated tags; supports +include/-exclude
  --device-id <serial>     adb device/emulator id
  --apk-path <path>        APK path to install (default: $DEFAULT_APK)
  --output-dir <path>      Output directory for Maestro artifacts (default: $DEFAULT_OUTPUT_DIR)
  --c64u-target <mock|real> Target for smoke config (default: ${C64U_TARGET})
  --c64u-host <hostname>   Hostname/IP for real target (default: ${C64U_HOST})
  --hvsc-base-url <url>    Override HVSC release base URL for smoke mode
  --benchmark-run-id <id>  Benchmark run id written into smoke snapshots
  --skip-app-reset         Skip APK install, pm clear, config write, and HVSC fixture setup
  -h, --help               Show this help
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

cleanup_maestro_processes() {
  local port="7001"
  local deadline
  local pids
  pids=$(ps -eo pid=,cmd= | awk '/\.maestro\// {print $1}')
  if [[ -n "$pids" ]]; then
    log "Stopping stale Maestro process(es): $pids"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
  fi
  if command -v ss >/dev/null 2>&1; then
    pids=$(ss -ltnp 2>/dev/null | awk -v port=":${port}" '$4 ~ port {print $NF}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)
    if [[ -n "$pids" ]]; then
      log "Stopping process(es) holding port ${port}: $pids"
      for pid in $pids; do
        kill "$pid" >/dev/null 2>&1 || true
      done
    fi
  fi
  deadline=$((SECONDS + 5))
  if command -v ss >/dev/null 2>&1; then
    while [[ $SECONDS -lt $deadline ]]; do
      if ! ss -ltnp 2>/dev/null | grep -q ":${port} "; then
        break
      fi
      sleep 1
    done
  else
    sleep 1
  fi
}

wait_for_boot() {
  local serial="$1"
  local deadline=$(( $(date +%s) + BOOT_TIMEOUT_SECS ))
  log "Waiting for device to finish booting (timeout ${BOOT_TIMEOUT_SECS}s)"
  adb -s "$serial" wait-for-device >/dev/null 2>&1 || true
  while [[ $(date +%s) -lt $deadline ]]; do
    if adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q "1"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

cleanup_device_state() {
  if [[ "$POWER_STAYON_ENABLED" == "1" && -n "$DEVICE_ID" ]]; then
    adb -s "$DEVICE_ID" shell "svc power stayon false" >/dev/null 2>&1 || true
  fi
}

get_current_focus_window() {
  local focus
  focus=$(adb -s "$1" shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'" 2>/dev/null | tr -d '\r' || true)
  printf '%s' "$focus"
}

is_keyguard_showing() {
  local status
  status=$(adb -s "$1" shell "dumpsys window policy | grep -E 'isStatusBarKeyguard|mShowingLockscreen|mDreamingLockscreen'" 2>/dev/null | tr -d '\r' || true)
  [[ "${status,,}" == *"=true"* ]]
}

unlock_device() {
  local serial="$1"
  adb -s "$serial" shell "svc power stayon usb" >/dev/null 2>&1 || true
  POWER_STAYON_ENABLED=1
  adb -s "$serial" shell input keyevent 224 >/dev/null 2>&1 || true
  adb -s "$serial" shell wm dismiss-keyguard >/dev/null 2>&1 || true
  adb -s "$serial" shell input keyevent 82 >/dev/null 2>&1 || true
  adb -s "$serial" shell input keyevent 4 >/dev/null 2>&1 || true
}

ensure_device_ready_for_automation() {
  local serial="$1"
  local deadline=$(( $(date +%s) + AUTOMATION_READY_TIMEOUT_SECS ))
  local focus=""
  while [[ $(date +%s) -lt $deadline ]]; do
    unlock_device "$serial"
    adb -s "$serial" shell am start -W -n "$APP_MAIN_ACTIVITY" >/dev/null 2>&1 || true
    sleep 1
    focus=$(get_current_focus_window "$serial")
    if ! is_keyguard_showing "$serial" && [[ "$focus" == *"$APP_ID"* ]]; then
      return 0
    fi
  done
  echo "Device preflight failed: app not focused or keyguard still active (focus=${focus:-unknown})" >&2
  return 1
}

select_long_timeout_ms() {
  local tag_source="$1"
  if [[ "$tag_source" == *"hvsc-perf"* ]]; then
    printf '%s' "$HVSC_PERF_LONG_TIMEOUT_MS"
    return
  fi
  printf '%s' "$DEFAULT_LONG_TIMEOUT_MS"
}

resolve_apk_path() {
  if [[ -f "$APK_PATH" ]]; then
    return 0
  fi
  local debug_dir="$ROOT_DIR/android/app/build/outputs/apk/debug"
  if [[ -d "$debug_dir" ]]; then
    local candidate
    candidate=$(ls -1 "$debug_dir"/*.apk 2>/dev/null | sort | head -n 1)
    if [[ -n "$candidate" ]]; then
      APK_PATH="$candidate"
      return 0
    fi
  fi
  return 1
}

pick_device() {
  if [[ -n "$DEVICE_ID" ]]; then
    return 0
  fi
  DEVICE_ID=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
  if [[ -z "$DEVICE_ID" ]]; then
    echo "No adb devices found. Start an emulator or connect a device, or pass --device-id." >&2
    exit 1
  fi
}

install_apk() {
  log "Installing APK: $APK_PATH"
  local install_log="$OUTPUT_DIR/adb-install.log"
  if ! adb -s "$DEVICE_ID" install -r "$APK_PATH" >"$install_log" 2>&1; then
    if grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE\|INSTALL_FAILED_VERSION_DOWNGRADE" "$install_log"; then
      log "APK install requires uninstalling existing package $APP_ID"
      adb -s "$DEVICE_ID" uninstall "$APP_ID" >/dev/null 2>&1 || true
      adb -s "$DEVICE_ID" install "$APK_PATH" >>"$install_log" 2>&1 || {
        echo "APK install failed after uninstall" >&2
        exit 1
      }
    else
      echo "APK install failed" >&2
      exit 1
    fi
  fi
}

ensure_hvsc_library() {
  local serial="$1"
  local base="/sdcard/Download/C64Music"
  local track="$base/DEMOS/0-9/35_Years.sid"
  local root_track="$base/35_Years.sid"
  local fixture="$ROOT_DIR/android/app/src/test/fixtures/hvsc/baseline/C64Music/DEMOS/0-9/35_Years.sid"
  log "Resetting C64Music test data at $base"
  if ! adb -s "$serial" shell "rm -rf '$base'" >/dev/null 2>&1; then
    log "Failed to remove C64Music test directory"
    return 1
  fi
  if ! adb -s "$serial" shell "mkdir -p '$base/DEMOS/0-9'" >/dev/null 2>&1; then
    log "Failed to create C64Music test directory"
    return 1
  fi
  if [[ -f "$fixture" ]]; then
    if ! adb -s "$serial" push "$fixture" "$track" >/dev/null 2>&1; then
      log "Failed to push HVSC fixture to device"
      return 1
    fi
    if ! adb -s "$serial" push "$fixture" "$root_track" >/dev/null 2>&1; then
      log "Failed to push HVSC fixture to root"
      return 1
    fi
  else
    if ! adb -s "$serial" shell "echo 'SIDDATA-35' > '$track'" >/dev/null 2>&1; then
      log "Failed to prepare C64Music test data"
      return 1
    fi
    if ! adb -s "$serial" shell "echo 'SIDDATA-35' > '$root_track'" >/dev/null 2>&1; then
      log "Failed to prepare root C64Music test data"
      return 1
    fi
  fi
}

write_smoke_config() {
  local payload
  payload=$(node -e "const target=process.argv[1];const host=process.argv[2];const hvscBaseUrl=process.argv[3];const benchmarkRunId=process.argv[4];const payload={target,readOnly:target==='real',debugLogging:true,featureFlags:{hvsc_enabled:true}};if(target==='real'&&host){payload.host=host;}if(hvscBaseUrl){payload.hvscBaseUrl=hvscBaseUrl;}if(benchmarkRunId){payload.benchmarkRunId=benchmarkRunId;}process.stdout.write(JSON.stringify(payload));" "$C64U_TARGET" "$C64U_HOST" "$HVSC_BASE_URL" "$BENCHMARK_RUN_ID")
  adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'mkdir -p files && cat > files/c64u-smoke.json'" <<<"$payload" || true
}

strip_exclude_tags() {
  local input="$1"
  local output="$2"
  if [[ ! -f "$input" ]]; then
    cat <<EOF >"$output"
testOutputDir: ../test-results/maestro
EOF
    return
  fi
  awk '
    BEGIN { skipping = 0 }
    /^excludeTags:/ { skipping = 1; next }
    skipping == 1 {
      if ($0 ~ /^[[:space:]]+- /) { next }
      if ($0 ~ /^[^[:space:]]/) { skipping = 0 }
    }
    skipping == 0 { print }
  ' "$input" >"$output"
}

parse_tag_filters() {
  local raw="$1"
  local include=()
  local exclude=()
  IFS=',' read -r -a parts <<<"$raw"
  for part in "${parts[@]}"; do
    local tag
    tag="${part// /}"
    if [[ -z "$tag" ]]; then
      continue
    fi
    case "$tag" in
      +*) include+=("${tag:1}") ;;
      -*) exclude+=("${tag:1}") ;;
      *) include+=("$tag") ;;
    esac
  done
  TAG_INCLUDE=$(IFS=','; echo "${include[*]}")
  TAG_EXCLUDE=$(IFS=','; echo "${exclude[*]}")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --tags)
      TAG_FILTERS="$2"
      shift 2
      ;;
    --device-id)
      DEVICE_ID="$2"
      shift 2
      ;;
    --apk-path)
      APK_PATH="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
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
    --skip-app-reset)
      SKIP_APP_RESET="true"
      shift
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

if [[ -z "$MODE" ]]; then
  echo "--mode is required" >&2
  usage
  exit 1
fi

require_cmd adb
require_cmd maestro
require_cmd node

cleanup_maestro_processes

if [[ -d "/usr/lib/jvm/java-17-openjdk-amd64" ]]; then
  if [[ "${JAVA_HOME:-}" != "/usr/lib/jvm/java-17-openjdk-amd64" ]]; then
    log "Using Java 17 for Maestro (JAVA_HOME override)"
    export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
fi

if ! resolve_apk_path; then
  echo "Unable to locate APK at $APK_PATH" >&2
  exit 1
fi

DEBUG_DIR="$OUTPUT_DIR/debug"
if [[ -z "$REPORT_PATH" ]]; then
  REPORT_PATH="$OUTPUT_DIR/maestro-report.xml"
fi

mkdir -p "$OUTPUT_DIR" "$DEBUG_DIR"

pick_device

trap cleanup_device_state EXIT

adb -s "$DEVICE_ID" forward --remove-all >/dev/null 2>&1 || true

if ! wait_for_boot "$DEVICE_ID"; then
  echo "Device $DEVICE_ID did not finish booting within ${BOOT_TIMEOUT_SECS}s" >&2
  exit 1
fi

if [[ "$SKIP_APP_RESET" != "true" ]]; then
  install_apk

  adb -s "$DEVICE_ID" shell "am force-stop '$APP_ID' >/dev/null 2>&1; \
    pm clear '$APP_ID' >/dev/null 2>&1; \
    pm grant '$APP_ID' android.permission.READ_EXTERNAL_STORAGE >/dev/null 2>&1 || true; \
    pm grant '$APP_ID' android.permission.WRITE_EXTERNAL_STORAGE >/dev/null 2>&1 || true; \
    pm grant '$APP_ID' android.permission.READ_MEDIA_AUDIO >/dev/null 2>&1 || true; \
    pm grant '$APP_ID' android.permission.READ_MEDIA_IMAGES >/dev/null 2>&1 || true; \
    pm grant '$APP_ID' android.permission.READ_MEDIA_VIDEO >/dev/null 2>&1 || true; \
    pm grant '$APP_ID' android.permission.MANAGE_EXTERNAL_STORAGE >/dev/null 2>&1 || true; \
    appops set '$APP_ID' MANAGE_EXTERNAL_STORAGE allow >/dev/null 2>&1 || true" || true

  write_smoke_config

  ensure_hvsc_library "$DEVICE_ID"
fi

ensure_device_ready_for_automation "$DEVICE_ID"

MAESTRO_ARGS=("$ROOT_DIR/.maestro" --udid "$DEVICE_ID" --format JUNIT --output "$REPORT_PATH" --test-output-dir "$OUTPUT_DIR" --debug-output "$DEBUG_DIR")

TEMP_CONFIG=""
TAG_INCLUDE=""
TAG_EXCLUDE=""

case "$MODE" in
  ci)
    TAG_INCLUDE="ci-critical"
    ;;
  all)
    TEMP_CONFIG="$OUTPUT_DIR/maestro-config-all.yaml"
    strip_exclude_tags "$CONFIG_PATH" "$TEMP_CONFIG"
    MAESTRO_ARGS+=(--config "$TEMP_CONFIG")
    ;;
  tags)
    if [[ -z "$TAG_FILTERS" ]]; then
      echo "--tags is required when --mode tags" >&2
      exit 1
    fi
    parse_tag_filters "$TAG_FILTERS"
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    exit 1
    ;;
esac

if [[ "$C64U_TARGET" == "mock" ]]; then
  if [[ -n "$TAG_EXCLUDE" ]]; then
    TAG_EXCLUDE="${TAG_EXCLUDE},real-network"
  else
    TAG_EXCLUDE="real-network"
  fi
fi

if [[ -n "$TAG_INCLUDE" ]]; then
  MAESTRO_ARGS+=(--include-tags "$TAG_INCLUDE")
fi
if [[ -n "$TAG_EXCLUDE" ]]; then
  MAESTRO_ARGS+=(--exclude-tags "$TAG_EXCLUDE")
fi

LONG_TIMEOUT_MS=$(select_long_timeout_ms "${TAG_INCLUDE:-$TAG_FILTERS}")
MAESTRO_ARGS+=(-e LONG_TIMEOUT="$LONG_TIMEOUT_MS" -e TIMEOUT="$DEFAULT_TIMEOUT_MS" -e SHORT_TIMEOUT="$DEFAULT_SHORT_TIMEOUT_MS")

log "Running Maestro tests (mode=$MODE, device=$DEVICE_ID)"
set +e
maestro test "${MAESTRO_ARGS[@]}"
MAESTRO_STATUS=$?
set -e

if [[ ! -f "$REPORT_PATH" ]]; then
  echo "Maestro report missing at $REPORT_PATH" >&2
  exit 1
fi

exit "$MAESTRO_STATUS"
