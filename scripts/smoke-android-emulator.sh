#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="uk.gleissner.c64commander"
MAIN_ACTIVITY="${APP_ID}/.MainActivity"
APK_PATH="${APK_PATH:-$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk}"
C64U_TARGET="mock"
C64U_HOST="C64U"
EMULATOR_ID=""
LOG_DIR="$ROOT_DIR/test-results/smoke-android-emulator"
LOGCAT_FILE="$LOG_DIR/logcat.txt"
SMOKE_STATUS_FILE="files/c64u-smoke-status.json"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --c64u-target mock|real   Target device type (default: mock)
  --c64u-host <hostname>    Hostname/IP for real target (default: C64U)
  --apk-path <path>         APK path (default: android/app/build/outputs/apk/debug/app-debug.apk)
  --emulator-id <id>        Use a specific emulator ID (default: first emulator)
  -h, --help                Show this help
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

get_emulator_id() {
  if [[ -n "$EMULATOR_ID" ]]; then
    echo "$EMULATOR_ID"
    return
  fi
  adb devices | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {print $1}' | head -n 1
}

wait_for_boot() {
  local emulator_id="$1"
  adb -s "$emulator_id" wait-for-device
  local boot_completed=""
  local attempts=0
  while [[ "$boot_completed" != "1" && $attempts -lt 120 ]]; do
    boot_completed="$(adb -s "$emulator_id" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    if [[ "$boot_completed" != "1" ]]; then
      sleep 2
      attempts=$((attempts + 1))
    fi
  done
  if [[ "$boot_completed" != "1" ]]; then
    echo "Emulator did not finish booting in time." >&2
    exit 1
  fi
}

start_emulator_if_needed() {
  local emulator_id
  emulator_id="$(get_emulator_id)"
  if [[ -n "$emulator_id" ]]; then
    echo "$emulator_id"
    return
  fi
  if [[ -z "${ANDROID_HOME:-}" && -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  fi
  "$ROOT_DIR/scripts/android-emulator.sh" --no-prereqs --no-build --no-apk --no-install
  emulator_id="$(get_emulator_id)"
  if [[ -z "$emulator_id" ]]; then
    echo "Failed to start emulator." >&2
    exit 1
  fi
  echo "$emulator_id"
}

write_smoke_config() {
  local emulator_id="$1"
  mkdir -p "$LOG_DIR"
  local payload
  payload=$(cat <<EOF
{"target":"$C64U_TARGET","host":"$C64U_HOST","readOnly":true,"debugLogging":true}
EOF
)
  adb -s "$emulator_id" shell "run-as $APP_ID sh -c 'mkdir -p files && cat > files/c64u-smoke.json'" <<EOF
$payload
EOF
}

start_logcat() {
  local emulator_id="$1"
  mkdir -p "$LOG_DIR"
  adb -s "$emulator_id" logcat -c
  adb -s "$emulator_id" logcat -v time > "$LOGCAT_FILE" &
  LOGCAT_PID=$!
}

stop_logcat() {
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
    wait "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
}

wait_for_log() {
  local pattern="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if grep -E "$pattern" "$LOGCAT_FILE" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

read_smoke_status() {
  local emulator_id="$1"
  adb -s "$emulator_id" shell "run-as $APP_ID cat $SMOKE_STATUS_FILE" 2>/dev/null || true
}

wait_for_status_state() {
  local emulator_id="$1"
  local state="$2"
  local timeout="${3:-30}"
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local payload
    payload="$(read_smoke_status "$emulator_id")"
    if echo "$payload" | grep -q "\"state\"\s*:\s*\"$state\""; then
      echo "$payload"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --c64u-target) C64U_TARGET="$2"; shift 2;;
    --c64u-host) C64U_HOST="$2"; shift 2;;
    --apk-path) APK_PATH="$2"; shift 2;;
    --emulator-id) EMULATOR_ID="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; usage; exit 1;;
  esac
 done

if [[ "$C64U_TARGET" != "mock" && "$C64U_TARGET" != "real" ]]; then
  echo "Invalid --c64u-target: $C64U_TARGET" >&2
  exit 1
fi

require_cmd adb

if [[ ! -f "$APK_PATH" ]]; then
  APK_PATH=$(ls -1 "$ROOT_DIR"/android/app/build/outputs/apk/debug/*-debug.apk 2>/dev/null | head -n 1 || true)
fi
if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  echo "APK not found: $APK_PATH" >&2
  exit 1
fi

EMULATOR_ID="$(start_emulator_if_needed)"
wait_for_boot "$EMULATOR_ID"

adb -s "$EMULATOR_ID" install -r "$APK_PATH"
write_smoke_config "$EMULATOR_ID"

trap stop_logcat EXIT
start_logcat "$EMULATOR_ID"

adb -s "$EMULATOR_ID" shell am start -n "$MAIN_ACTIVITY" >/dev/null 2>&1

STATUS_PAYLOAD="$(wait_for_status_state "$EMULATOR_ID" "REAL_CONNECTED" 50)" || {
  echo "Smoke test failed: REAL_CONNECTED not observed. See $LOGCAT_FILE" >&2
  exit 1
}

if [[ "$C64U_TARGET" == "mock" ]]; then
  if ! echo "$STATUS_PAYLOAD" | grep -q "\"mode\"\s*:\s*\"mock\""; then
    echo "Smoke test failed: mock mode not confirmed. See $LOGCAT_FILE" >&2
    exit 1
  fi
fi

if echo "$STATUS_PAYLOAD" | grep -q "\"state\"\s*:\s*\"DEMO_ACTIVE\""; then
  echo "Smoke test failed: demo mode activated unexpectedly. See $LOGCAT_FILE" >&2
  exit 1
fi

if ! wait_for_log "CapacitorHttp" 40; then
  echo "Smoke test failed: CapacitorHttp usage not observed. See $LOGCAT_FILE" >&2
  exit 1
fi

if grep -E "\"method\"\s*:\s*\"(POST|PUT|PATCH|DELETE)\"" "$LOGCAT_FILE" >/dev/null 2>&1; then
  echo "Smoke test failed: mutating endpoint was attempted. See $LOGCAT_FILE" >&2
  exit 1
fi

echo "Smoke test passed. Logcat: $LOGCAT_FILE"
