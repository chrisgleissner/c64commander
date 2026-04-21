#!/usr/bin/env bash
set -euo pipefail

PASS=0
FAIL=0
APP_ID="uk.gleissner.c64commander"
DEFAULT_LONG_TIMEOUT_MS=20000
HVSC_PERF_LONG_TIMEOUT_MS=600000
HVSC_PERF_SETUP_LONG_TIMEOUT_MS=1800000

is_keyguard_showing_output() {
  local status="${1,,}"
  [[ "$status" == *"=true"* ]]
}

is_device_ready_for_automation() {
  local app_id="$1"
  local focus="$2"
  local keyguard_status="$3"

  if is_keyguard_showing_output "$keyguard_status"; then
    return 1
  fi

  [[ "$focus" == *"$app_id"* ]]
}

select_long_timeout_ms() {
  local tag_source="$1"
  if [[ "$tag_source" == *"hvsc-perf-setup"* ]]; then
    printf '%s' "$HVSC_PERF_SETUP_LONG_TIMEOUT_MS"
    return
  fi
  if [[ "$tag_source" == *"hvsc-perf"* ]]; then
    printf '%s' "$HVSC_PERF_LONG_TIMEOUT_MS"
    return
  fi
  printf '%s' "$DEFAULT_LONG_TIMEOUT_MS"
}

assert_success() {
  local test_name="$1"
  shift
  if "$@"; then
    echo "  PASS: $test_name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name"
    FAIL=$((FAIL + 1))
  fi
}

assert_failure() {
  local test_name="$1"
  shift
  if "$@"; then
    echo "  FAIL: $test_name"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $test_name"
    PASS=$((PASS + 1))
  fi
}

echo "run-maestro device preflight regression tests"

assert_failure \
  "rejects black-screen SystemUI snapshot while keyguard is showing" \
  is_device_ready_for_automation \
  "$APP_ID" \
  "mCurrentFocus=Window{1f3 u0 com.android.systemui/com.android.systemui.shade.NotificationShadeWindowView}" \
  $'isStatusBarKeyguard=true\nmShowingLockscreen=true'

assert_failure \
  "rejects unlocked device when another app holds focus" \
  is_device_ready_for_automation \
  "$APP_ID" \
  "mCurrentFocus=Window{9aa u0 com.android.settings/.Settings}" \
  "isStatusBarKeyguard=false"

assert_failure \
  "rejects transient empty focus output while launch is still settling" \
  is_device_ready_for_automation \
  "$APP_ID" \
  "" \
  "isStatusBarKeyguard=false"

assert_success \
  "accepts focused app after keyguard is dismissed" \
  is_device_ready_for_automation \
  "$APP_ID" \
  "mCurrentFocus=Window{42b u0 uk.gleissner.c64commander/uk.gleissner.c64commander.MainActivity}" \
  $'isStatusBarKeyguard=false\nmShowingLockscreen=false'

assert_success \
  "uses the extended timeout budget for hvsc measurement flows" \
  test "$(select_long_timeout_ms 'hvsc-perf,device')" = "600000"

assert_success \
  "uses the longest timeout budget for hvsc setup flows" \
  test "$(select_long_timeout_ms 'hvsc-perf-setup,device')" = "1800000"

assert_success \
  "keeps the default timeout budget for non-hvsc flows" \
  test "$(select_long_timeout_ms 'ci-critical')" = "20000"

echo
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
