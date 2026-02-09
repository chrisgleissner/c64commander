#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="uk.gleissner.c64commander"
DEFAULT_APK="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
OUTPUT_DIR="$ROOT_DIR/test-results/maestro"
DEBUG_DIR="$OUTPUT_DIR/debug"
REPORT_PATH="$OUTPUT_DIR/maestro-report.xml"
CONFIG_PATH="$ROOT_DIR/.maestro/config.yaml"
BOOT_TIMEOUT_SECS=${BOOT_TIMEOUT_SECS:-180}

MODE=""
TAG_FILTERS=""
DEVICE_ID=""
APK_PATH="$DEFAULT_APK"
C64U_TARGET="${C64U_TARGET:-mock}"
C64U_HOST="${C64U_HOST:-C64U}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --mode <ci|all|tags>     Run ci-critical, all, or tag-filtered flows
  --tags <list>            Comma-separated tags; supports +include/-exclude
  --device-id <serial>     adb device/emulator id
  --apk-path <path>        APK path to install (default: $DEFAULT_APK)
  --c64u-target <mock|real> Target for smoke config (default: ${C64U_TARGET})
  --c64u-host <hostname>   Hostname/IP for real target (default: ${C64U_HOST})
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
    if grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE" "$install_log"; then
      log "APK signature mismatch; uninstalling existing package $APP_ID"
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
  if ! adb -s "$serial" shell "mkdir -p '$base/DEMOS/0-9' && if [ ! -f '$track' ]; then echo 'SIDDATA-35' > '$track'; fi" >/dev/null 2>&1; then
    log "Failed to prepare C64Music test data"
    return 1
  fi
}

write_smoke_config() {
  local payload
  payload=$(node -e "const target=process.argv[1];const host=process.argv[2];const payload={target,readOnly:target==='real',debugLogging:true};if(target==='real'&&host){payload.host=host;}process.stdout.write(JSON.stringify(payload));" "$C64U_TARGET" "$C64U_HOST")
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
    --c64u-target)
      C64U_TARGET="$2"
      shift 2
      ;;
    --c64u-host)
      C64U_HOST="$2"
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

if [[ -z "$MODE" ]]; then
  echo "--mode is required" >&2
  usage
  exit 1
fi

require_cmd adb
require_cmd maestro
require_cmd node

if ! resolve_apk_path; then
  echo "Unable to locate APK at $APK_PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$DEBUG_DIR"

pick_device

if ! wait_for_boot "$DEVICE_ID"; then
  echo "Device $DEVICE_ID did not finish booting within ${BOOT_TIMEOUT_SECS}s" >&2
  exit 1
fi

install_apk

adb -s "$DEVICE_ID" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
adb -s "$DEVICE_ID" shell pm clear "$APP_ID" >/dev/null 2>&1 || true

write_smoke_config

ensure_hvsc_library "$DEVICE_ID"

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
