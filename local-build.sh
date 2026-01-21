#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APK_DEFAULT="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"

RUN_INSTALL=true
RUN_BUILD=true
RUN_TEST=true
RUN_APK=true
RUN_INSTALL_APK=false
RUN_EMULATOR=false
RUN_SCREENSHOTS=false
RUN_TEST_UNIT=false
RUN_TEST_E2E=false
RUN_TEST_E2E_CI=false
RUN_VALIDATE_EVIDENCE=false
RUN_COVERAGE=false
APK_PATH=""
DEVICE_ID=""

usage() {
  cat <<'EOF'
local-build.sh - C64 Commander local build helper

Usage:
  ./local-build.sh [options]

Default (no options):
  - Install deps
  - Build web app + sync
  - Run tests
  - Build debug APK

Options:
  --emulator            Run scripts/android-emulator.sh and exit
  --install             Install APK to a connected Android device (via adb)
  --device [id]         Device ID for adb (optional). If omitted, picks the first real phone.
  --apk-path <path>     APK path to install (default: android/app/build/outputs/apk/debug/app-debug.apk)

  --test                Run unit tests only (vitest)
  --test-e2e            Run E2E tests only (Playwright, no screenshots)
  --test-e2e-ci         Run full CI mirror (screenshots + e2e + validation)
  --validate-evidence   Validate Playwright evidence structure
  --coverage            Run unit + e2e coverage (slower)
  
  --skip-install        Skip npm install
  --skip-build          Skip npm run cap:build
  --skip-tests          Skip npm test
  --skip-apk            Skip npm run android:apk
  --screenshots         Capture app screenshots into doc/img

  -h, --help            Show this help

Examples:
  ./local-build.sh
  ./local-build.sh --skip-tests
  ./local-build.sh --install --device R5CRC3ZY9XH
  ./local-build.sh --apk-path /path/to/app-debug.apk --install
  ./local-build.sh --emulator
  ./local-build.sh --screenshots
EOF
}

log() {
  printf "\n==> %s\n" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --emulator)
      RUN_EMULATOR=true
      shift
      ;;
    --install)
      RUN_INSTALL_APK=true
      shift
      ;;
    --test)
      RUN_TEST_UNIT=true
      RUN_BUILD=true
      RUN_INSTALL=true
      RUN_APK=false
      RUN_TEST=false
      shift
      ;;
    --test-e2e)
      RUN_TEST_E2E=true
      RUN_BUILD=true
      RUN_INSTALL=true
      RUN_APK=false
      RUN_TEST=false
      shift
      ;;
    --test-e2e-ci)
      RUN_TEST_E2E_CI=true
      RUN_BUILD=true
      RUN_INSTALL=true
      RUN_APK=false
      RUN_TEST=false
      shift
      ;;
    --validate-evidence)
      RUN_VALIDATE_EVIDENCE=true
      RUN_BUILD=false
      RUN_INSTALL=false
      RUN_APK=false
      RUN_TEST=false
      shift
      ;;
    --coverage)
      RUN_COVERAGE=true
      RUN_BUILD=true
      RUN_INSTALL=true
      RUN_APK=false
      RUN_TEST=false
      shift
      ;;
    --device)
      if [[ -n "${2:-}" && "${2:-}" != "--"* ]]; then
        DEVICE_ID="$2"
        shift 2
      else
        DEVICE_ID=""
        shift
      fi
      ;;
    --apk-path)
      APK_PATH="$2"
      shift 2
      ;;
    --skip-install)
      RUN_INSTALL=false
      shift
      ;;
    --skip-build)
      RUN_BUILD=false
      shift
      ;;
    --skip-tests)
      RUN_TEST=false
      shift
      ;;
    --skip-apk)
      RUN_APK=false
      shift
      ;;
    --screenshots)
      RUN_SCREENSHOTS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$RUN_EMULATOR" == "true" ]]; then
  log "Starting Android emulator flow"
  "$ROOT_DIR/scripts/android-emulator.sh"
  exit 0
fi

require_cmd npm

if [[ -x /usr/lib/jvm/java-17-openjdk-amd64/bin/jlink ]]; then
  export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if command -v git >/dev/null 2>&1; then
  if [[ -z "${VITE_GIT_SHA:-}" ]]; then
    export VITE_GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  fi
fi
if [[ -z "${VITE_BUILD_TIME:-}" ]]; then
  export VITE_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

if [[ "$RUN_INSTALL" == "true" ]]; then
  log "Installing npm dependencies"
  (cd "$ROOT_DIR" && npm install --no-audit --no-fund)
fi

if [[ "$RUN_BUILD" == "true" ]]; then
  log "Building web app + syncing Capacitor"
  (cd "$ROOT_DIR" && npm run cap:build)

  if [[ -f "$ROOT_DIR/android/capacitor-cordova-android-plugins/build.gradle" ]]; then
    sed -i.bak '/flatDir{/,/}/d' "$ROOT_DIR/android/capacitor-cordova-android-plugins/build.gradle"
    rm -f "$ROOT_DIR/android/capacitor-cordova-android-plugins/build.gradle.bak"
  fi
fi

if [[ "$RUN_TEST" == "true" ]]; then
  log "Running tests"
  (cd "$ROOT_DIR" && npm test)
  (cd "$ROOT_DIR" && npx playwright install --check >/dev/null 2>&1 || npx playwright install)
  if [[ "$RUN_SCREENSHOTS" == "true" ]]; then
    (cd "$ROOT_DIR" && npm run test:e2e)
  else
    (cd "$ROOT_DIR" && npx playwright test --grep-invert @screenshots)
  fi
  (cd "$ROOT_DIR/android" && ./gradlew test --warning-mode none)
fi

if [[ "$RUN_TEST_UNIT" == "true" ]]; then
  log "Running unit tests"
  (cd "$ROOT_DIR" && npm test)
fi

if [[ "$RUN_TEST_E2E" == "true" ]]; then
  log "Running E2E tests"
  (cd "$ROOT_DIR" && npx playwright install --check >/dev/null 2>&1 || npx playwright install)
  (cd "$ROOT_DIR" && npx playwright test --grep-invert @screenshots)
fi

if [[ "$RUN_TEST_E2E_CI" == "true" ]]; then
  log "Running CI mirror (screenshots + E2E + validation)"
  (cd "$ROOT_DIR" && npx playwright install --check >/dev/null 2>&1 || npx playwright install)
  (cd "$ROOT_DIR" && npm run test:e2e:ci)
fi

if [[ "$RUN_VALIDATE_EVIDENCE" == "true" ]]; then
  log "Validating Playwright evidence"
  (cd "$ROOT_DIR" && npm run validate:evidence)
fi

if [[ "$RUN_COVERAGE" == "true" ]]; then
  log "Running coverage (unit + e2e)"
  (cd "$ROOT_DIR" && ./scripts/collect-coverage.sh)
  (cd "$ROOT_DIR" && EXPECT_WEB_COVERAGE=1 node scripts/verify-coverage-artifacts.mjs)
  (cd "$ROOT_DIR" && COVERAGE_MIN=80 node scripts/check-coverage-threshold.mjs)
fi

if [[ "$RUN_SCREENSHOTS" == "true" ]]; then
  log "Capturing screenshots"
  (cd "$ROOT_DIR" && npx playwright install --check >/dev/null 2>&1 || npx playwright install)
  (cd "$ROOT_DIR" && \
    VITE_GIT_SHA="screenshots" \
    VITE_BUILD_TIME="1970-01-01T00:00:00Z" \
    SOURCE_DATE_EPOCH="0" \
    npm run screenshots)
fi

if [[ "$RUN_APK" == "true" ]]; then
  log "Building debug APK"
  (cd "$ROOT_DIR" && npm run android:apk -- --warning-mode none)
fi

if [[ "$RUN_INSTALL_APK" == "true" ]]; then
  require_cmd adb
  APK_PATH="${APK_PATH:-$APK_DEFAULT}"

  if [[ ! -f "$APK_PATH" ]]; then
    echo "APK not found: $APK_PATH" >&2
    exit 1
  fi

  if [[ -z "$DEVICE_ID" ]]; then
    mapfile -t DEVICES < <(adb devices | awk 'NR>1 && $2=="device" {print $1}' | grep -v '^emulator-')
    if [[ ${#DEVICES[@]} -eq 0 ]]; then
      echo "No adb devices found. Connect a device or pass --device <id>." >&2
      exit 1
    fi
    DEVICE_ID="${DEVICES[0]}"
  fi

  log "Installing APK to device: $DEVICE_ID"
  adb -s "$DEVICE_ID" install -r "$APK_PATH"

  log "Launching app"
  adb -s "$DEVICE_ID" shell monkey -p uk.gleissner.c64commander -c android.intent.category.LAUNCHER 1
fi

log "Done"
