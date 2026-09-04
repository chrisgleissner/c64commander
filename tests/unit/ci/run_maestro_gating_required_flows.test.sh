#!/usr/bin/env bash
# Regression harness for the ci-critical gate integrity check in
# scripts/run-maestro-gating.sh.
#
# The function under test is extracted from the production script and run against
# synthetic Maestro JUnit reports, so a change to run-maestro-gating.sh is what
# these cases see. The script cannot be sourced directly because it starts an
# emulator and runs Maestro at top level.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PRODUCTION_SCRIPT="$ROOT_DIR/scripts/run-maestro-gating.sh"
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

log() { printf '%s\n' "$*"; }

eval "$(extract_definition assert_required_flows_present)"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

write_report() {
  local file="$WORK_DIR/$1"
  shift
  {
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n'
    local flow
    for flow in "$@"; do
      printf '  <testcase name="%s" classname="%s" status="SUCCESS"/>\n' "$flow" "$flow"
    done
    printf '</testsuites>\n'
  } > "$file"
  printf '%s\n' "$file"
}

check() {
  local label="$1" expected="$2" report="$3"
  shift 3
  local output status
  output=$(assert_required_flows_present "$report" "$@" 2>&1)
  status=$?
  if [[ "$status" == "$expected" ]]; then
    PASS=$((PASS + 1))
    echo "ok - $label"
  else
    FAIL=$((FAIL + 1))
    echo "not ok - $label (expected exit $expected, got $status)"
    printf '%s\n' "$output" | sed 's/^/    /'
  fi
}

REPORT_BOTH=$(write_report both.xml smoke-hvsc smoke-launch)
check "both required flows present" 0 "$REPORT_BOTH" smoke-hvsc smoke-launch

# The defect this harness exists for: before the check was anchored, a report holding only
# the longer sibling satisfied a search for the shorter name.
REPORT_SIBLINGS=$(write_report siblings.xml smoke-hvsc-lowram smoke-launch-resume)
check "sibling flows do not satisfy the shorter name" 1 "$REPORT_SIBLINGS" smoke-hvsc smoke-launch

REPORT_ONE=$(write_report one.xml smoke-launch)
check "one missing flow fails" 1 "$REPORT_ONE" smoke-hvsc smoke-launch

REPORT_LOWRAM=$(write_report lowram.xml smoke-hvsc smoke-launch smoke-hvsc-lowram)
check "the low-RAM flow is matched by its own name" 0 "$REPORT_LOWRAM" smoke-hvsc smoke-launch smoke-hvsc-lowram

# Maestro has written the flow name both bare and with its file extension across versions, so
# neither form may be rejected.
REPORT_YAML=$(write_report yaml.xml smoke-hvsc.yaml smoke-launch.yaml)
check "a name carrying the .yaml extension still matches" 0 "$REPORT_YAML" smoke-hvsc smoke-launch

check "a missing report file fails" 1 "$WORK_DIR/absent.xml" smoke-launch

echo "Passed: $PASS"
echo "Failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
