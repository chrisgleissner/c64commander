#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="uk.gleissner.c64commander"
APK_PATH="${APK_PATH:-$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk}"
C64U_TARGET="mock"
C64U_HOST="C64U"
EMULATOR_ID=""
DEVICE_TYPE=""
MOCK_SERVER_PID=""
MOCK_INFO_PATH=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --c64u-target mock|real   Target device type (default: mock)
  --c64u-host <hostname>    Hostname/IP for real target (default: C64U). Use "auto" for external mock.
  --apk-path <path>         APK path (default: android/app/build/outputs/apk/debug/app-debug.apk)
  --emulator-id <id>        Use a specific emulator ID (default: first emulator)
  --device-type <name>      Evidence device type (default: emulator model)
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
  local attempts=0
  while [[ -z "$emulator_id" && $attempts -lt 60 ]]; do
    sleep 2
    emulator_id="$(get_emulator_id)"
    attempts=$((attempts + 1))
  done
  if [[ -z "$emulator_id" ]]; then
    echo "Failed to start emulator." >&2
    exit 1
  fi
  echo "$emulator_id"
}

cleanup() {
  if [[ -n "$MOCK_SERVER_PID" ]]; then
    kill "$MOCK_SERVER_PID" >/dev/null 2>&1 || true
    wait "$MOCK_SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --c64u-target) C64U_TARGET="$2"; shift 2;;
    --c64u-host) C64U_HOST="$2"; shift 2;;
    --apk-path) APK_PATH="$2"; shift 2;;
    --emulator-id) EMULATOR_ID="$2"; shift 2;;
    --device-type) DEVICE_TYPE="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; usage; exit 1;;
  esac
 done

if [[ "$C64U_TARGET" != "mock" && "$C64U_TARGET" != "real" ]]; then
  echo "Invalid --c64u-target: $C64U_TARGET" >&2
  exit 1
fi

require_cmd adb
require_cmd node
require_cmd maestro

if [[ ! -f "$APK_PATH" ]]; then
  APK_PATH=$(ls -1 "$ROOT_DIR"/android/app/build/outputs/apk/debug/*-debug.apk 2>/dev/null | head -n 1 || true)
fi
if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  echo "APK not found: $APK_PATH" >&2
  exit 1
fi

EMULATOR_ID="$(start_emulator_if_needed)"
wait_for_boot "$EMULATOR_ID"

if [[ -z "$DEVICE_TYPE" ]]; then
  DEVICE_TYPE="$(adb -s "$EMULATOR_ID" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
fi

if [[ "$C64U_TARGET" == "real" && "$C64U_HOST" == "auto" ]]; then
  MOCK_INFO_PATH="$ROOT_DIR/test-results/maestro/external-mock.json"
  node "$ROOT_DIR/scripts/maestro-external-mock.mjs" --out "$MOCK_INFO_PATH" &
  MOCK_SERVER_PID=$!
  for _ in {1..40}; do
    if [[ -f "$MOCK_INFO_PATH" ]]; then
      break
    fi
    sleep 0.25
  done
  if [[ ! -f "$MOCK_INFO_PATH" ]]; then
    echo "External mock server did not start." >&2
    exit 1
  fi
  C64U_HOST="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.hostForEmulator||'')" "$MOCK_INFO_PATH")"
fi

if [[ "$C64U_TARGET" == "mock" ]]; then
  C64U_HOST=""
fi

adb -s "$EMULATOR_ID" install -r "$APK_PATH" >/dev/null
adb -s "$EMULATOR_ID" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
adb -s "$EMULATOR_ID" shell pm clear "$APP_ID" >/dev/null 2>&1 || true

rm -rf "$ROOT_DIR/test-results/maestro" "$ROOT_DIR/test-results/evidence/maestro"
mkdir -p "$ROOT_DIR/test-results/maestro"

BUILD_PAYLOAD=$(node -e "const target=process.argv[1];const host=process.argv[2];const payload={target,readOnly:true,debugLogging:true};if(target==='real'&&host){payload.host=host;}process.stdout.write(JSON.stringify(payload));" "$C64U_TARGET" "$C64U_HOST")
adb -s "$EMULATOR_ID" shell "run-as $APP_ID sh -c 'mkdir -p files && cat > files/c64u-smoke.json'" <<<"$BUILD_PAYLOAD"

set +e
(cd "$ROOT_DIR" && maestro test .maestro)
MAESTRO_STATUS=$?
set -e

export MAESTRO_EXIT_CODE="$MAESTRO_STATUS"
export MAESTRO_DEVICE_TYPE="$DEVICE_TYPE"
(cd "$ROOT_DIR" && node scripts/build-maestro-evidence.mjs)

if [[ "$MAESTRO_STATUS" -ne 0 ]]; then
  exit "$MAESTRO_STATUS"
fi
