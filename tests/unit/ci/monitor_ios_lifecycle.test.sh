#!/usr/bin/env bash
# Lifecycle state-machine test harness for monitor_ios.sh flag-based logic.
# Validates that the monitor exit-code decision function correctly classifies
# app process disappearance based on flow-active.flag and flow-complete.flag.

set -euo pipefail

PASS=0
FAIL=0
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

# The shipped decision, not a copy of it: a test that re-implemented these two functions passed
# while the monitor itself was changed. See ci/telemetry/ios/lifecycle.sh.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=ci/telemetry/ios/lifecycle.sh
. "$REPO_ROOT/ci/telemetry/ios/lifecycle.sh"

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

# --- Test 1: PID stable during flow → exit 0 ---
echo "Test 1: PID stable during flow → exit 0"
code=0
decide_exit_code "1" "1" "0" || code=$?
assert_eq "exit code" "0" "$code"

# --- Test 2: PID disappearance during active flow → exit 3 ---
echo "Test 2: PID disappearance during active flow → exit 3"
flag_dir="$TEST_DIR/test2"
mkdir -p "$flag_dir"
touch "$flag_dir/flow-active.flag"
classify_disappearance "$flag_dir/flow-active.flag" "$flag_dir/flow-complete.flag"
assert_eq "classified as during-flow" "1" "$RESULT_DURING_FLOW"
code=0
decide_exit_code "1" "1" "$RESULT_DURING_FLOW" || code=$?
assert_eq "exit code" "3" "$code"

# --- Test 3: PID disappearance after flow-complete → exit 0 ---
echo "Test 3: PID disappearance after flow-complete → exit 0"
flag_dir="$TEST_DIR/test3"
mkdir -p "$flag_dir"
touch "$flag_dir/flow-complete.flag"
classify_disappearance "$flag_dir/flow-active.flag" "$flag_dir/flow-complete.flag"
assert_eq "classified as after-flow" "0" "$RESULT_DURING_FLOW"
code=0
decide_exit_code "1" "1" "$RESULT_DURING_FLOW" || code=$?
assert_eq "exit code" "0" "$code"

# --- Test 4: PID never seen → exit 0 ---
echo "Test 4: PID never seen → exit 0"
code=0
decide_exit_code "1" "0" "0" || code=$?
assert_eq "exit code" "0" "$code"

# --- Test 5: Both flags present (race edge case) → exit 0 ---
echo "Test 5: Both flags present → exit 0 (flow-complete takes precedence)"
flag_dir="$TEST_DIR/test5"
mkdir -p "$flag_dir"
touch "$flag_dir/flow-active.flag"
touch "$flag_dir/flow-complete.flag"
classify_disappearance "$flag_dir/flow-active.flag" "$flag_dir/flow-complete.flag"
assert_eq "classified as after-flow" "0" "$RESULT_DURING_FLOW"
code=0
decide_exit_code "1" "1" "$RESULT_DURING_FLOW" || code=$?
assert_eq "exit code" "0" "$code"

# --- Test 6: No flags present (pre-launch or no signaling) → exit 0 ---
echo "Test 6: No flags present → exit 0"
flag_dir="$TEST_DIR/test6"
mkdir -p "$flag_dir"
classify_disappearance "$flag_dir/flow-active.flag" "$flag_dir/flow-complete.flag"
assert_eq "classified as after-flow" "0" "$RESULT_DURING_FLOW"
code=0
decide_exit_code "1" "1" "$RESULT_DURING_FLOW" || code=$?
assert_eq "exit code" "0" "$code"

# --- Test 7: EXPECT_MAIN_PID disabled → exit 0 regardless ---
echo "Test 7: EXPECT_MAIN_PID=0 → exit 0 even with crash"
code=0
decide_exit_code "0" "1" "1" || code=$?
assert_eq "exit code" "0" "$code"

# --- Test 8: PID disappearance during flow, simctl unavailable → exit 4 ---
echo "Test 8: PID disappearance during flow (simctl unreliable) → exit 4"
flag_dir="$TEST_DIR/test8"
mkdir -p "$flag_dir"
touch "$flag_dir/flow-active.flag"
classify_disappearance "$flag_dir/flow-active.flag" "$flag_dir/flow-complete.flag"
assert_eq "classified as during-flow" "1" "$RESULT_DURING_FLOW"
code=0
decide_exit_code "1" "1" "$RESULT_DURING_FLOW" "1" || code=$?
assert_eq "exit code" "4" "$code"

# --- Test 9: PID disappearance during flow, simctl available → still exit 3 ---
echo "Test 9: PID disappearance during flow (simctl available) → exit 3"
flag_dir="$TEST_DIR/test9"
mkdir -p "$flag_dir"
touch "$flag_dir/flow-active.flag"
classify_disappearance "$flag_dir/flow-active.flag" "$flag_dir/flow-complete.flag"
assert_eq "classified as during-flow" "1" "$RESULT_DURING_FLOW"
code=0
decide_exit_code "1" "1" "$RESULT_DURING_FLOW" "0" || code=$?
assert_eq "exit code" "3" "$code"

# --- Test 10: gone mid-flow but back inside the grace window -> relaunch, exit 0 ---
# Maestro stops and launches the app at the start of every flow, and SpringBoard reports that kill
# as "Termination requested by simulator host". Runs 35271936372 attempts 1 and 2 failed on it,
# with all three flows passing and the app back a second later.
echo "Test 10: gone 3s of a 15s grace window, then back -> pending, exit 0"
assert_eq "still pending at 3s" "0" "$(disappearance_is_pending 3 15 && echo 0 || echo 1)"
code=0
decide_exit_code "1" "1" "0" || code=$?
assert_eq "exit code" "0" "$code"

# --- Test 11: gone mid-flow past the grace window -> committed crash, exit 3 ---
echo "Test 11: gone 16s of a 15s grace window -> committed, exit 3"
assert_eq "no longer pending at 16s" "1" "$(disappearance_is_pending 16 15 && echo 0 || echo 1)"
code=0
decide_exit_code "1" "1" "1" || code=$?
assert_eq "exit code" "3" "$code"

# --- Test 12: the grace window boundary is inclusive ---
echo "Test 12: gone exactly 15s of a 15s grace window -> still pending"
assert_eq "pending at 15s" "0" "$(disappearance_is_pending 15 15 && echo 0 || echo 1)"

# --- Summary ---
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
