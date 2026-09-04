#!/usr/bin/env bash
# Regression harness for capture_accessibility_snapshot in
# scripts/ci/ios-maestro-run-flow.sh.
#
# The function is extracted from the production script and run against a stubbed
# Maestro binary and a stubbed debug-server probe, so a change to the production
# script is what these cases see.
#
# The defect: the dump was gated on debug_server_reachable, which answers "is this
# a DEBUG build whose in-app HTTP server bound port 39877", not "is the app
# running". In run 33840657287 all three snapshots recorded
# "skipped-app-not-running" while the failure screenshot taken moments later showed
# the app rendered on screen, so an iOS text-anchor failure had no view hierarchy
# to diagnose it with.

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

eval "$(extract_definition capture_accessibility_snapshot)"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

UDID="stub-udid"
MAESTRO_BIN="$WORK_DIR/maestro"
cat > "$MAESTRO_BIN" <<'STUB'
#!/usr/bin/env bash
# argv is "hierarchy --device <udid>"; the dump itself is what the caller redirects.
echo "Element: Connection Saved devices, discovery, passwords, demo mode"
STUB
chmod +x "$MAESTRO_BIN"

log() { :; }
ms_timestamp() { echo 0; }
log_elapsed() { echo "0ms"; }

TRACE_FILE=""
trace_event() {
  # argv is "<flow_dir> <type> <source> <json>"; only the status matters here.
  printf '%s\n' "$4" >> "$TRACE_FILE"
}

DEBUG_SERVER_REACHABLE=1
debug_server_reachable() { return "$DEBUG_SERVER_REACHABLE"; }

run_case() {
  local test_name="$1"
  local reachable="$2"
  local expect_dump="$3"
  local expect_status="$4"
  shift 4

  local flow_dir="$WORK_DIR/flow-$((PASS + FAIL))"
  mkdir -p "$flow_dir"
  TRACE_FILE="$flow_dir/trace.txt"
  : > "$TRACE_FILE"
  DEBUG_SERVER_REACHABLE="$reachable"

  capture_accessibility_snapshot "$flow_dir" "failure" "$@"

  local dumped="no"
  if [[ -s "$flow_dir/accessibility/failure.txt" ]]; then
    dumped="yes"
  fi
  local status="missing"
  if grep -q "\"status\":\"${expect_status}\"" "$TRACE_FILE"; then
    status="$expect_status"
  fi

  if [[ "$dumped" == "$expect_dump" && "$status" == "$expect_status" ]]; then
    echo "  PASS: $test_name (dumped=$dumped, status=$status)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name (expected dumped=$expect_dump status=$expect_status, got dumped=$dumped status=$status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "capture_accessibility_snapshot regression tests"

run_case "dumps the hierarchy when the debug server answers" 0 "yes" "ok"
run_case "skips when the debug server is unreachable and it is required" 1 "no" "skipped-debug-server-unreachable"
run_case "dumps when the debug server is unreachable but not required" 1 "yes" "ok" "no"

echo
echo "Passed: $PASS"
echo "Failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
