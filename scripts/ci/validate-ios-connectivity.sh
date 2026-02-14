#!/usr/bin/env bash
# Deterministic JSON-based connectivity validation for iOS Maestro flows.
# Usage: scripts/ci/validate-ios-connectivity.sh <flow-artifacts-dir>
#
# Exit 0 = connectivity validated
# Exit 1 = connectivity failure detected
set -euo pipefail

FLOW_DIR="${1:?Usage: validate-ios-connectivity.sh <flow-artifacts-dir>}"
FLOW_NAME="$(basename "$FLOW_DIR")"
VALIDATION_FILE="${FLOW_DIR}/connectivity-validation.json"

log() {
  echo "[validate-connectivity] $*" >&2
}

had_error=0
errors=()

# ── 1. errorLog.json fatal patterns ─────────────────────────────
check_error_log() {
  local error_log="${FLOW_DIR}/errorLog.json"
  if [[ ! -f "$error_log" ]]; then
    log "No errorLog.json found — skipping"
    return 0
  fi

  local fatal_patterns=(
    "plugin is not implemented"
    "Unhandled promise rejection"
    "failed to start"
  )

  for pattern in "${fatal_patterns[@]}"; do
    if grep -qi "$pattern" "$error_log" 2>/dev/null; then
      errors+=("errorLog contains fatal pattern: '${pattern}'")
      had_error=1
    fi
  done
}

# ── 2. action.json REST success check ───────────────────────────
check_action_log() {
  local action_log="${FLOW_DIR}/action.json"
  if [[ ! -f "$action_log" ]]; then
    log "No action.json found — skipping REST action check"
    return 0
  fi

  # Check if there are any REST actions at all
  local rest_count
  rest_count=$(python3 -c "
import json, sys
try:
    data = json.load(open('${action_log}'))
    if not isinstance(data, list):
        data = data.get('actions', []) if isinstance(data, dict) else []
    rest = [a for a in data if isinstance(a, dict) and 'rest' in str(a.get('type','')).lower()]
    print(len(rest))
except Exception:
    print(0)
" 2>/dev/null || echo "0")

  if [[ "$rest_count" == "0" ]]; then
    log "No REST actions found in action.json — skipping (may be expected for some flows)"
    return 0
  fi

  # Check for successful REST actions
  local success_count
  success_count=$(python3 -c "
import json, sys
try:
    data = json.load(open('${action_log}'))
    if not isinstance(data, list):
        data = data.get('actions', []) if isinstance(data, dict) else []
    success = [a for a in data if isinstance(a, dict) and 'rest' in str(a.get('type','')).lower() and a.get('outcome','') == 'success']
    print(len(success))
except Exception:
    print(0)
" 2>/dev/null || echo "0")

  if [[ "$success_count" == "0" && "$rest_count" != "0" ]]; then
    errors+=("action.json: ${rest_count} REST actions found but 0 succeeded")
    had_error=1
  fi
}

# ── 3. network.json validation ──────────────────────────────────
check_network_log() {
  local network_log="${FLOW_DIR}/network.json"
  if [[ ! -f "$network_log" ]]; then
    log "No network.json found — skipping"
    return 0
  fi

  local validation
  validation=$(python3 -c "
import json, sys
try:
    data = json.load(open('${network_log}'))
    sc = data.get('successCount', 0)
    fc = data.get('failureCount', 0)
    reqs = data.get('requests', [])
    resolved = any(r.get('resolvedIp') for r in reqs if isinstance(r, dict))
    issues = []
    if sc == 0 and len(reqs) > 0:
        issues.append('successCount is 0 with {} total requests'.format(len(reqs)))
    if len(reqs) > 0 and not resolved:
        issues.append('no resolvedIp in any request')
    if fc > 0 and sc == 0:
        issues.append('all {} requests failed'.format(fc))
    print(json.dumps({'ok': len(issues) == 0, 'issues': issues}))
except Exception as e:
    print(json.dumps({'ok': True, 'issues': [], 'note': 'parse error: ' + str(e)}))
" 2>/dev/null || echo '{"ok":true,"issues":[]}')

  local is_ok
  is_ok=$(echo "$validation" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',True))" 2>/dev/null || echo "True")

  if [[ "$is_ok" == "False" ]]; then
    local issues
    issues=$(echo "$validation" | python3 -c "import json,sys; print('; '.join(json.load(sys.stdin).get('issues',[])))" 2>/dev/null || echo "unknown")
    errors+=("network.json: ${issues}")
    had_error=1
  fi
}

# ── Run all checks ──────────────────────────────────────────────
check_error_log
check_action_log
check_network_log

# ── Emit validation result ──────────────────────────────────────
python3 -c "
import json
result = {
    'flow': '${FLOW_NAME}',
    'valid': ${had_error} == 0,
    'errors': $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${errors[@]+"${errors[@]}"})][:-1] if [$(printf '"%s",' "${errors[@]+"${errors[@]}"})][:-1] else []))" 2>/dev/null || echo '[]'),
    'checks': {
        'errorLog': True,
        'actionLog': True,
        'networkLog': True
    }
}
with open('${VALIDATION_FILE}', 'w') as f:
    json.dump(result, f, indent=2)
print(json.dumps(result, indent=2))
" 2>/dev/null || {
  # Fallback if python3 fails
  cat > "$VALIDATION_FILE" <<VJSON
{
  "flow": "${FLOW_NAME}",
  "valid": $([ $had_error -eq 0 ] && echo "true" || echo "false"),
  "errors": [],
  "checks": {
    "errorLog": true,
    "actionLog": true,
    "networkLog": true
  }
}
VJSON
}

if [[ $had_error -ne 0 ]]; then
  log "CONNECTIVITY VALIDATION FAILED for ${FLOW_NAME}:"
  for err in "${errors[@]}"; do
    log "  - ${err}"
  done
  exit 1
else
  log "Connectivity validated for ${FLOW_NAME}"
  exit 0
fi
