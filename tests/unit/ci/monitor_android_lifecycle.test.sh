#!/usr/bin/env bash
# State-machine harness test for the main-process disappearance/recovery
# classification in ci/telemetry/android/monitor_android.sh.
#
# The Android CI harness runs all required Maestro flows as a single
# `maestro test` invocation, and each flow's shared launch-and-wait.yaml
# subflow issues `launchApp: stopApp: true`. That intentionally kills and
# relaunches the app's main process between flows, producing a real
# multi-second gap in `pidof` visibility that is expected test-harness
# churn, not a crash. This harness locks in that a disappearance followed
# by a reappearance is downgraded (main_disappeared reset, restart counted)
# while a disappearance that never recovers by monitor shutdown still fails.

set -euo pipefail

PASS=0
FAIL=0

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

# Extracted main-process state machine matching monitor_android.sh's
# per-sample handling for role="main" (missing-streak threshold of 2,
# appear/restart/recover/disappear transitions). Sets main_disappeared and
# main_restart_count as globals, mirroring the real script's variables.
run_samples() {
  local samples="$1"
  main_disappeared=0
  main_restart_count=0
  local missing_streak=0
  local prev_pid=""
  local pid

  for pid in $samples; do
    if [[ -z "$pid" || "$pid" == "-" ]]; then
      missing_streak=$((missing_streak + 1))
      if (( missing_streak >= 2 )); then
        if [[ -n "$prev_pid" ]]; then
          main_disappeared=1
        fi
        prev_pid=""
      fi
      continue
    fi

    missing_streak=0

    if [[ -z "$prev_pid" ]]; then
      if [[ "$main_disappeared" == "1" ]]; then
        main_disappeared=0
        main_restart_count=$((main_restart_count + 1))
      fi
    elif [[ "$prev_pid" != "$pid" ]]; then
      main_restart_count=$((main_restart_count + 1))
    fi

    prev_pid="$pid"
  done
}

echo "Test 1: stable pid throughout -> no disappearance, no restart"
run_samples "100 100 100 100"
assert_eq "main_disappeared" "0" "$main_disappeared"
assert_eq "main_restart_count" "0" "$main_restart_count"

echo "Test 2: single stopApp/launchApp cycle (gap then new pid) -> recovered, not failed"
run_samples "100 100 - - 200 200"
assert_eq "main_disappeared" "0" "$main_disappeared"
assert_eq "main_restart_count" "1" "$main_restart_count"

echo "Test 3: two flow relaunches (two gaps, e.g. smoke-launch then smoke-hvsc) -> recovered twice"
run_samples "100 100 - - 200 200 - - 300 300"
assert_eq "main_disappeared" "0" "$main_disappeared"
assert_eq "main_restart_count" "2" "$main_restart_count"

echo "Test 4: instantaneous pid swap without a recorded gap -> restart, not failed"
run_samples "100 100 200 200"
assert_eq "main_disappeared" "0" "$main_disappeared"
assert_eq "main_restart_count" "1" "$main_restart_count"

echo "Test 5: disappearance that never recovers -> fails"
run_samples "100 100 - - -"
assert_eq "main_disappeared" "1" "$main_disappeared"
assert_eq "main_restart_count" "0" "$main_restart_count"

echo "Test 6: single missed sample (below streak threshold) is tolerated, not a disappearance"
run_samples "100 - 100 100"
assert_eq "main_disappeared" "0" "$main_disappeared"
assert_eq "main_restart_count" "0" "$main_restart_count"

echo "Test 7: recovers, then a second disappearance never recovers -> fails"
run_samples "100 100 - - 200 200 - - -"
assert_eq "main_disappeared" "1" "$main_disappeared"
assert_eq "main_restart_count" "1" "$main_restart_count"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
