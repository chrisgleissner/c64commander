#!/usr/bin/env bash
# How the iOS telemetry monitor classifies the app process going away, and what it exits with.
#
# Sourced by monitor_ios.sh and by tests/unit/ci/monitor_ios_lifecycle.test.sh, so the test
# exercises the shipped decision rather than a copy of it.

# Classify a disappearance from the flow flags. Sets RESULT_DURING_FLOW to 1 or 0.
# shellcheck disable=SC2034  # read by the caller that sources this file
classify_disappearance() {
  local flow_active_flag="$1"
  local flow_complete_flag="$2"

  if [[ -f "$flow_active_flag" && ! -f "$flow_complete_flag" ]]; then
    RESULT_DURING_FLOW=1
  else
    RESULT_DURING_FLOW=0
  fi
}

# Whether a disappearance that is still within the relaunch grace window may yet turn out to be a
# relaunch rather than a crash. Maestro stops and launches the app at the start of each flow, and
# SpringBoard reports that as an explicit "Termination requested by simulator host" kill. The
# monitor samples once a second, so it sees the gap between the kill and the new process while the
# flow is already marked active. It commits the failure only if the app does not come back.
disappearance_is_pending() {
  local elapsed_sec="$1"
  local grace_sec="$2"

  (( elapsed_sec <= grace_sec ))
}

# The monitor's exit code: 0 clean, 3 crash during a flow, 4 the same but detected while simctl was
# unavailable, which the workflow treats as an infrastructure warning.
decide_exit_code() {
  local expect_main_pid="$1"
  local main_seen_once="$2"
  local main_disappeared_during_flow="$3"
  local main_disappeared_during_flow_simctl_unreliable="${4:-0}"

  if [[ "$expect_main_pid" == "1" && "$main_seen_once" == "1" && "$main_disappeared_during_flow" == "1" ]]; then
    if [[ "$main_disappeared_during_flow_simctl_unreliable" == "1" ]]; then
      return 4
    fi
    return 3
  fi
  return 0
}
