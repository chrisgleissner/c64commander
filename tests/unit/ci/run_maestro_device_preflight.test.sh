#!/usr/bin/env bash
# Regression harness for the device preflight in scripts/run-maestro.sh.
#
# The functions under test are extracted from the production script and then run
# against a stubbed adb, so a change to run-maestro.sh is what these cases see.
# The script cannot be sourced directly because it parses arguments and runs a
# Maestro invocation at top level.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PRODUCTION_SCRIPT="$ROOT_DIR/scripts/run-maestro.sh"
PASS=0
FAIL=0

extract_definition() {
  local name="$1"
  local definition
  definition=$(awk -v start="^${name}\\\\(\\\\) \\\\{$" '$0 ~ start {found=1} found {print} found && /^\}$/ {exit}' "$PRODUCTION_SCRIPT")
  if [[ -z "$definition" ]]; then
    echo "FATAL: could not extract $name from $PRODUCTION_SCRIPT" >&2
    exit 1
  fi
  printf '%s\n' "$definition"
}

extract_assignment() {
  local name="$1"
  local line
  line=$(grep -m 1 -E "^${name}=" "$PRODUCTION_SCRIPT")
  if [[ -z "$line" ]]; then
    echo "FATAL: could not extract assignment $name from $PRODUCTION_SCRIPT" >&2
    exit 1
  fi
  printf '%s\n' "$line"
}

for assignment in APP_ID APP_MAIN_ACTIVITY POWER_STAYON_ENABLED AUTOMATION_READY_TIMEOUT_SECS \
  DEFAULT_LONG_TIMEOUT_MS HVSC_PERF_LONG_TIMEOUT_MS HVSC_PERF_SETUP_LONG_TIMEOUT_MS; do
  eval "$(extract_assignment "$assignment")"
done

for definition in get_current_focus_window is_keyguard_showing unlock_device \
  ensure_device_ready_for_automation select_long_timeout_ms; do
  eval "$(extract_definition "$definition")"
done

# Shorten only the preflight deadline, so the rejection cases do not wait 20 s each.
AUTOMATION_READY_TIMEOUT_SECS=1

STUB_FOCUS=""
STUB_KEYGUARD=""

adb() {
  local command="${*}"
  if [[ "$command" == *"window policy"* ]]; then
    printf '%s\n' "$STUB_KEYGUARD"
    return 0
  fi
  if [[ "$command" == *"mCurrentFocus"* ]]; then
    printf '%s\n' "$STUB_FOCUS"
    return 0
  fi
  return 0
}

assert_ready() {
  local test_name="$1"
  STUB_FOCUS="$2"
  STUB_KEYGUARD="$3"
  if ensure_device_ready_for_automation "emulator-5554" 2>/dev/null; then
    echo "  PASS: $test_name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name (expected the device to be reported ready)"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_ready() {
  local test_name="$1"
  STUB_FOCUS="$2"
  STUB_KEYGUARD="$3"
  if ensure_device_ready_for_automation "emulator-5554" 2>/dev/null; then
    echo "  FAIL: $test_name (expected the preflight to reject the device)"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $test_name"
    PASS=$((PASS + 1))
  fi
}

assert_eq() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $test_name (expected=$expected, actual=$actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name (expected=$expected, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "run-maestro device preflight regression tests"

assert_not_ready \
  "rejects black-screen SystemUI snapshot while keyguard is showing" \
  "mCurrentFocus=Window{1f3 u0 com.android.systemui/com.android.systemui.shade.NotificationShadeWindowView}" \
  $'isStatusBarKeyguard=true\nmShowingLockscreen=true'

assert_not_ready \
  "rejects a keyguard reported only by mDreamingLockscreen" \
  "mCurrentFocus=Window{42b u0 uk.gleissner.c64commander/uk.gleissner.c64commander.MainActivity}" \
  "mDreamingLockscreen=true"

assert_not_ready \
  "rejects unlocked device when another app holds focus" \
  "mCurrentFocus=Window{9aa u0 com.android.settings/.Settings}" \
  "isStatusBarKeyguard=false"

assert_not_ready \
  "rejects transient empty focus output while launch is still settling" \
  "" \
  "isStatusBarKeyguard=false"

assert_ready \
  "accepts focused app after keyguard is dismissed" \
  "mCurrentFocus=Window{42b u0 uk.gleissner.c64commander/uk.gleissner.c64commander.MainActivity}" \
  $'isStatusBarKeyguard=false\nmShowingLockscreen=false'

assert_eq "uses the extended timeout budget for hvsc measurement flows" \
  "600000" "$(select_long_timeout_ms 'hvsc-perf,device')"

assert_eq "uses the longest timeout budget for hvsc setup flows" \
  "1800000" "$(select_long_timeout_ms 'hvsc-perf-setup,device')"

assert_eq "keeps the default timeout budget for non-hvsc flows" \
  "20000" "$(select_long_timeout_ms 'ci-critical')"

assert_eq "preflights against the shipped application id" \
  "uk.gleissner.c64commander" "$APP_ID"

echo
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
