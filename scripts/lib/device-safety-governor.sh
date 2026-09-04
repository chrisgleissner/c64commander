#!/usr/bin/env bash
# HARD27-036: the device-safety governor is disabled by VITE_ENABLE_TEST_PROBES,
# so any build that turns probes on also silences the guard that protects the
# repository's first-ranked hazard. This resolver decides VITE_DEVICE_SAFETY_GOVERNOR
# separately from the probe flag, so a build that drives real hardware keeps the
# governor on no matter what other test instrumentation it enables.

# resolve_device_safety_governor <c64u_target> <builds_apk> <runs_playwright>
# Prints "1", "0" or nothing (leave the variable unset).
#
# A run that drives Playwright from the same dist/ is left undeclared: its golden
# traces record the ungoverned pattern, and changing that is a separate task.
resolve_device_safety_governor() {
  local c64u_target="${1:-mock}"
  local builds_apk="${2:-false}"
  local runs_playwright="${3:-false}"
  local explicit="${VITE_DEVICE_SAFETY_GOVERNOR:-}"

  if [[ -n "$explicit" ]]; then
    printf '%s' "$explicit"
    return 0
  fi

  if [[ "$runs_playwright" == "true" ]]; then
    printf ''
    return 0
  fi

  if [[ "${c64u_target,,}" == "real" || "$builds_apk" == "true" ]]; then
    printf '1'
    return 0
  fi

  printf ''
}
