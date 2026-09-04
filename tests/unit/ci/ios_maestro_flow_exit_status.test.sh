#!/usr/bin/env bash
# Regression harness for the exit status of run_maestro_and_capture in
# scripts/ci/ios-maestro-run-flow.sh.
#
# The function is extracted from the production script and run against a stubbed
# python3, so a change to the production script is what these cases see. The
# script cannot be sourced directly because it parses arguments and installs the
# app in a simulator at top level.
#
# The defect: the function ended with `cp` followed by `log`, so the exit status
# it returned was the status of that trailing log call. The python3 block already
# exits non-zero when Maestro's JUnit report records failures, but nothing above
# the function ever saw it. All three ci-critical-ios flows failed in run
# 33825210983 while the iOS Maestro job reported success.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PRODUCTION_SCRIPT="$ROOT_DIR/scripts/ci/ios-maestro-run-flow.sh"
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

eval "$(extract_definition run_maestro_and_capture)"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

MAESTRO_BIN="/nonexistent/maestro"
UDID="stub-udid"
MAESTRO_MAX_ATTEMPTS=1
IOS_MAESTRO_HEARTBEAT_SECONDS=1
MAESTRO_LOG_LEVEL="debug"
MAESTRO_CLI_LOG_LEVEL="debug"
MAESTRO_DRIVER_STARTUP_TIMEOUT_MS="1000"

# The production function logs through `log`; the harness only needs it to be quiet.
log() { :; }

# `python3` stands in for the whole Maestro invocation and JUnit summary. Its exit
# status is the single thing under test, so the stub sets it directly and writes
# the raw log file the function copies afterwards.
STUB_PYTHON_EXIT=0
python3() {
  printf '%s\n' "stub python3 exiting ${STUB_PYTHON_EXIT}"
  # Drain the heredoc the production function feeds on stdin.
  cat >/dev/null
  # argv is "- <maestro_bin> <flow_yaml> <udid> <junit> <raw_log> <attempt> <heartbeat>".
  local raw_log_file="${6}"
  : > "$raw_log_file"
  return "$STUB_PYTHON_EXIT"
}

check() {
  local label="$1" expected="$2" stub_exit="$3"
  local flow_dir="$WORK_DIR/$label"
  mkdir -p "$flow_dir"
  STUB_PYTHON_EXIT="$stub_exit"
  local status=0
  run_maestro_and_capture "ios-ci-smoke" "$flow_dir" 1 >/dev/null 2>&1 || status=$?
  if [[ "$status" == "$expected" ]]; then
    PASS=$((PASS + 1))
    echo "ok - $label"
  else
    FAIL=$((FAIL + 1))
    echo "not ok - $label (expected exit $expected, got $status)"
  fi
}

check "a passing Maestro flow returns 0" 0 0
# Maestro exits 1 on an assertion failure, and the python block also exits 1 when the
# JUnit report records failures despite a zero process exit.
check "a failing Maestro flow propagates its exit status" 1 1
# A distinct status proves the function returns the real code rather than a constant 1.
check "a Maestro driver failure propagates its own exit status" 3 3

echo "Passed: $PASS"
echo "Failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
