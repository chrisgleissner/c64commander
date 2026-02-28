#!/usr/bin/env bash
# Lifecycle state-machine test harness for monitor_ios.sh flag-based logic.
# Validates that the monitor exit-code decision function correctly classifies
# app process disappearance based on flow-active.flag and flow-complete.flag.

set -euo pipefail

PASS=0
FAIL=0
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

# Extracted decision logic matching monitor_ios.sh lines 297-311.
# Returns the exit code the monitor would emit.
decide_exit_code() {
  local expect_main_pid="$1"
  local main_seen_once="$2"
  local main_disappeared_during_flow="$3"

  if [[ "$expect_main_pid" == "1" && "$main_seen_once" == "1" && "$main_disappeared_during_flow" == "1" ]]; then
    return 3
  fi
  return 0
}

# Extracted disappearance classification matching monitor_ios.sh lines 198-203.
# Sets RESULT_DURING_FLOW=1 or 0.
classify_disappearance() {
  local flow_active_flag="$1"
  local flow_complete_flag="$2"

  if [[ -f "$flow_active_flag" && ! -f "$flow_complete_flag" ]]; then
    RESULT_DURING_FLOW=1
  else
    RESULT_DURING_FLOW=0
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

# --- Summary ---
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
