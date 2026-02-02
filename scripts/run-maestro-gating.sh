#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="uk.gleissner.c64commander"
DEFAULT_APK="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
RAW_OUTPUT_DIR="$ROOT_DIR/test-results/maestro"
EVIDENCE_DIR="$ROOT_DIR/test-results/evidence/maestro"
C64U_TARGET="${C64U_TARGET:-mock}"
C64U_HOST="${C64U_HOST:-C64U}"

APK_PATH="$DEFAULT_APK"
AVD_NAME="${ANDROID_AVD_NAME:-c64-ci}"
API_LEVEL="${ANDROID_API_LEVEL:-34}"
SYSTEM_IMAGE="${ANDROID_SYSTEM_IMAGE:-system-images;android-34;google_apis;x86_64}"
DEVICE_PROFILE="${ANDROID_DEVICE_PROFILE:-pixel_6}"
EMULATOR_HEADLESS="${EMULATOR_HEADLESS:-1}"
SKIP_BUILD=0
SKIP_EMULATOR_START=0
DEVICE_ID=""

BOOT_TIMEOUT_SECS=${BOOT_TIMEOUT_SECS:-180}
BOOT_POLL_SECS=${BOOT_POLL_SECS:-3}
INSTALL_TIMEOUT_SECS=${INSTALL_TIMEOUT_SECS:-90}
MAESTRO_TIMEOUT_SECS=${MAESTRO_TIMEOUT_SECS:-300}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --apk-path <path>           Path to debug APK
  --avd-name <name>           AVD name (default: $AVD_NAME)
  --api-level <level>         Android API level (default: $API_LEVEL)
  --system-image <id>         SDK system image (default: $SYSTEM_IMAGE)
  --device-profile <name>     AVD device profile (default: $DEVICE_PROFILE)
  --device-id <serial>        Use existing device/emulator ID (skip AVD start)
  --skip-build                Skip cap:build and android:apk
  --skip-emulator-start       Assume emulator is already running
  --headful                   Launch emulator with UI window
  -h, --help                  Show this help
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

run_with_timeout() {
  local timeout_secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_secs" "$@"
    return $?
  fi
  "$@"
}

resolve_sdk_dir() {
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    echo "$ANDROID_SDK_ROOT"
    return
  fi
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    echo "$ANDROID_HOME"
    return
  fi
  if [[ -d "$HOME/Android/Sdk" ]]; then
    echo "$HOME/Android/Sdk"
    return
  fi
  local props="$ROOT_DIR/android/local.properties"
  if [[ -f "$props" ]]; then
    local sdk_dir
    sdk_dir=$(grep -E '^sdk.dir=' "$props" | head -n 1 | cut -d= -f2-)
    if [[ -n "$sdk_dir" ]]; then
      sdk_dir="${sdk_dir//\\/:}"
      echo "$sdk_dir"
      return
    fi
  fi
  echo "$HOME/Android/Sdk"
}

configure_sdk_env() {
  local sdk_dir="$1"
  export ANDROID_SDK_ROOT="$sdk_dir"
  export ANDROID_HOME="$sdk_dir"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
}

configure_java_env() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    local current_version
    current_version=$("${JAVA_HOME}/bin/java" -version 2>&1 | awk -F'"' '/version/{print $2}')
    local major=${current_version%%.*}
    if [[ "$major" =~ ^[0-9]+$ && "$major" -le 17 ]]; then
      export PATH="$JAVA_HOME/bin:$PATH"
      return
    fi
  fi
  local candidates=(
    "/usr/lib/jvm/java-17-openjdk-amd64"
    "/usr/lib/jvm/java-1.17.0-openjdk-amd64"
    "/usr/lib/jvm/openjdk-17"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -x "${candidate}/bin/java" ]]; then
      export JAVA_HOME="$candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      return
    fi
  done
}

wait_for_boot() {
  local serial="$1"
  local deadline=$(( $(date +%s) + BOOT_TIMEOUT_SECS ))
  log "Waiting for emulator to boot (timeout ${BOOT_TIMEOUT_SECS}s)..."
  while [[ $(date +%s) -lt $deadline ]]; do
    if adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q "1"; then
      if adb -s "$serial" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r' | grep -q "stopped"; then
        return 0
      fi
    fi
    sleep "$BOOT_POLL_SECS"
  done
  return 1
}

wait_for_device() {
  local deadline=$(( $(date +%s) + BOOT_TIMEOUT_SECS ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if adb devices | awk 'NR>1 && $2=="device" {print $1; exit}' | grep -q .; then
      return 0
    fi
    sleep 2
  done
  return 1
}

ensure_avd() {
  if avdmanager list avd | grep -q "Name: $AVD_NAME"; then
    return 0
  fi
  log "Creating AVD $AVD_NAME"
  sdkmanager "platform-tools" "emulator" "platforms;android-${API_LEVEL}" "$SYSTEM_IMAGE"
  echo "no" | avdmanager create avd -n "$AVD_NAME" -k "$SYSTEM_IMAGE" -d "$DEVICE_PROFILE"
}

start_emulator() {
  log "Starting emulator $AVD_NAME"
  local args=("-avd" "$AVD_NAME" "-no-snapshot" "-no-boot-anim" "-gpu" "swiftshader_indirect" "-noaudio" "-netdelay" "none" "-netspeed" "full")
  if [[ "$EMULATOR_HEADLESS" == "1" ]]; then
    args+=("-no-window")
  fi
  nohup emulator "${args[@]}" > "$RAW_OUTPUT_DIR/emulator.log" 2>&1 &
  echo $!
}

prepare_diagnostics() {
  local serial="$1"
  mkdir -p "$RAW_OUTPUT_DIR" "$EVIDENCE_DIR"
  adb devices -l > "$RAW_OUTPUT_DIR/adb-devices.txt" 2>&1 || true
  adb -s "$serial" shell getprop > "$RAW_OUTPUT_DIR/device-props.txt" 2>&1 || true
  adb -s "$serial" shell settings get global window_animation_scale > "$RAW_OUTPUT_DIR/anim-window.txt" 2>&1 || true
  adb -s "$serial" shell settings get global transition_animation_scale > "$RAW_OUTPUT_DIR/anim-transition.txt" 2>&1 || true
  adb -s "$serial" shell settings get global animator_duration_scale > "$RAW_OUTPUT_DIR/anim-duration.txt" 2>&1 || true
}

capture_failure_artifacts() {
  local serial="$1"
  adb -s "$serial" logcat -d > "$RAW_OUTPUT_DIR/logcat.txt" 2>&1 || true
  adb -s "$serial" exec-out screencap -p > "$RAW_OUTPUT_DIR/last-screen.png" 2>/dev/null || true
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apk-path)
      APK_PATH="$2"
      shift 2
      ;;
    --avd-name)
      AVD_NAME="$2"
      shift 2
      ;;
    --api-level)
      API_LEVEL="$2"
      shift 2
      ;;
    --system-image)
      SYSTEM_IMAGE="$2"
      shift 2
      ;;
    --device-profile)
      DEVICE_PROFILE="$2"
      shift 2
      ;;
    --device-id)
      DEVICE_ID="$2"
      SKIP_EMULATOR_START=1
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-emulator-start)
      SKIP_EMULATOR_START=1
      shift
      ;;
    --headful)
      EMULATOR_HEADLESS=0
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

require_cmd adb
require_cmd maestro
require_cmd node

sdk_dir=$(resolve_sdk_dir)
configure_sdk_env "$sdk_dir"
configure_java_env

if [[ "$SKIP_BUILD" == "0" ]]; then
  log "Building web + Android debug APK"
  (cd "$ROOT_DIR" && npm run cap:build)
  (cd "$ROOT_DIR" && npm run android:apk)
fi

mkdir -p "$RAW_OUTPUT_DIR" "$EVIDENCE_DIR"

EMULATOR_PID=""
if [[ "$SKIP_EMULATOR_START" == "0" ]]; then
  require_cmd sdkmanager
  require_cmd avdmanager
  require_cmd emulator
  ensure_avd
  EMULATOR_PID=$(start_emulator)
fi

if [[ -z "$DEVICE_ID" ]]; then
  if ! wait_for_device; then
    log "No adb devices available within ${BOOT_TIMEOUT_SECS}s"
    exit 1
  fi
  DEVICE_ID=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
fi

if [[ -z "$DEVICE_ID" ]]; then
  log "No emulator/device detected via adb"
  exit 1
fi

if ! wait_for_boot "$DEVICE_ID"; then
  log "Emulator failed to boot within ${BOOT_TIMEOUT_SECS}s"
  capture_failure_artifacts "$DEVICE_ID"
  exit 1
fi

adb -s "$DEVICE_ID" shell settings put global window_animation_scale 0 || true
adb -s "$DEVICE_ID" shell settings put global transition_animation_scale 0 || true
adb -s "$DEVICE_ID" shell settings put global animator_duration_scale 0 || true

prepare_diagnostics "$DEVICE_ID"

log "Installing APK: $APK_PATH"
if ! resolve_apk_path; then
  log "Unable to locate APK at $APK_PATH"
  exit 1
fi
log "Installing APK: $APK_PATH"
if ! run_with_timeout "$INSTALL_TIMEOUT_SECS" adb -s "$DEVICE_ID" install -r "$APK_PATH" >/dev/null; then
  log "APK install failed"
  capture_failure_artifacts "$DEVICE_ID"
  exit 1
fi

adb -s "$DEVICE_ID" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
adb -s "$DEVICE_ID" shell pm clear "$APP_ID" >/dev/null 2>&1 || true

log "Configuring app smoke mode (${C64U_TARGET})"
BUILD_PAYLOAD=$(node -e "const target=process.argv[1];const host=process.argv[2];const payload={target,readOnly:target==='real',debugLogging:true};if(target==='real'&&host){payload.host=host;}process.stdout.write(JSON.stringify(payload));" "$C64U_TARGET" "$C64U_HOST")
adb -s "$DEVICE_ID" shell "run-as $APP_ID sh -c 'mkdir -p files && cat > files/c64u-smoke.json'" <<<"$BUILD_PAYLOAD" || true

log "Running Maestro gating flows"
set +e
MAESTRO_EXIT_CODE=0
# On CI, run only critical tests to keep build time under 6 minutes
# Critical tests verify native Android components (file picker integration)
TAG_FILTER="device"
if [[ "${CI:-false}" == "true" ]]; then
  TAG_FILTER="ci-critical"
fi
if ! run_with_timeout "$MAESTRO_TIMEOUT_SECS" maestro test "$ROOT_DIR/.maestro" --include-tags="$TAG_FILTER" --udid "$DEVICE_ID" --format JUNIT --output "$RAW_OUTPUT_DIR/maestro-report.xml" --test-output-dir "$RAW_OUTPUT_DIR" --debug-output "$RAW_OUTPUT_DIR/debug"; then
  MAESTRO_EXIT_CODE=$?
fi
set -e

export MAESTRO_EXIT_CODE
node "$ROOT_DIR/scripts/build-maestro-evidence.mjs" || true

if [[ "$MAESTRO_EXIT_CODE" -ne 0 ]]; then
  log "Maestro gating failed with exit code $MAESTRO_EXIT_CODE"
  capture_failure_artifacts "$DEVICE_ID"
fi

if [[ -n "$EMULATOR_PID" ]]; then
  log "Stopping emulator"
  kill "$EMULATOR_PID" >/dev/null 2>&1 || true
fi

exit "$MAESTRO_EXIT_CODE"
