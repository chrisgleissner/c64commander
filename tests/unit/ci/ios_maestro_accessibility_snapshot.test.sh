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
SEEN_ARGV_FILE="$WORK_DIR/maestro-argv.txt"
export SEEN_ARGV_FILE
# The stub enforces Maestro 2.2.0's own argument grammar rather than accepting any argv. A stub
# that accepted anything is why `maestro hierarchy --device <udid>` reached run 33845624818 and
# produced a 664-byte usage message instead of a view hierarchy: in `App.kt` `--device`/`--udid`
# is declared on the root command and `PrintHierarchyCommand` reads it from its parent, so it has
# to precede the subcommand. `test` declares its own `--device`, which is why the flow runs work.
cat > "$MAESTRO_BIN" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
device=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device|--udid) device="$2"; shift 2 ;;
    -p|--platform|--host|--port) shift 2 ;;
    --verbose) shift ;;
    *) break ;;
  esac
done
printf '%s\n' "$*" > "${SEEN_ARGV_FILE:-/dev/null}"
[[ "${1:-}" == "hierarchy" ]] || { echo "Unmatched argument at index 0: '${1:-}'" >&2; exit 2; }
shift
for arg in "$@"; do
  case "$arg" in
    -h|--help|--compact|--ansi|--no-ansi|--reinstall-driver|--no-reinstall-driver) ;;
    *)
      echo "Unknown options: '$arg'" >&2
      echo "Usage: maestro hierarchy [-h] [--compact] [--[no-]ansi] [--[no-]reinstall-driver]" >&2
      exit 2
      ;;
  esac
done
[[ -n "$device" ]] || { echo "No device selected" >&2; exit 2; }
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

  # A usage message is also a non-empty file, and that is exactly what run 33845624818 recorded
  # as the failure dump. "Dumped" therefore means the file holds a hierarchy.
  local dumped="no"
  if grep -q "^Element: " "$flow_dir/accessibility/failure.txt" 2>/dev/null; then
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

# The device has to reach the Maestro session, or the dump is taken against no device at all.
if grep -q "^hierarchy$" "$SEEN_ARGV_FILE"; then
  echo "  PASS: passes the device as a root option, ahead of the subcommand"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected the subcommand argv to be exactly 'hierarchy', got '$(cat "$SEEN_ARGV_FILE")'"
  FAIL=$((FAIL + 1))
fi

echo
echo "Passed: $PASS"
echo "Failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
