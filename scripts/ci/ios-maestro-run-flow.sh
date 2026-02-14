#!/usr/bin/env bash
# iOS Maestro per-flow wrapper with structured evidence capture.
# Usage: scripts/ci/ios-maestro-run-flow.sh --flow <name> --udid <sim-udid> --app-path <App.app> [--app-id <id>] [--mock-port <port>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_ID="uk.gleissner.c64commander"
FLOW=""
UDID=""
APP_PATH=""
MOCK_PORT=""
MAESTRO_BIN="${HOME}/.maestro/bin/maestro"
ARTIFACTS_BASE="${ROOT_DIR}/artifacts/ios"
TIMING_START=""
FLOW_EXIT=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --flow <name>        Maestro flow name (without .yaml)
  --udid <sim-udid>    Simulator UDID
  --app-path <path>    Path to App.app
  --app-id <id>        Bundle identifier (default: $APP_ID)
  --mock-port <port>   External mock server port (optional)
  -h, --help           Show this help
EOF
}

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --flow) FLOW="$2"; shift 2 ;;
    --udid) UDID="$2"; shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --app-id) APP_ID="$2"; shift 2 ;;
    --mock-port) MOCK_PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$FLOW" || -z "$UDID" || -z "$APP_PATH" ]]; then
  echo "Missing required arguments" >&2
  usage
  exit 1
fi

FLOW_DIR="${ARTIFACTS_BASE}/${FLOW}"
mkdir -p "${FLOW_DIR}/screenshots" "${FLOW_DIR}/video"

# ── Timing ──────────────────────────────────────────────────────
TIMING_START=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")

emit_timing() {
  local end
  end=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")
  local duration_ms=$((end - TIMING_START))
  cat > "${FLOW_DIR}/timing.json" <<TJSON
{
  "flow": "${FLOW}",
  "startMs": ${TIMING_START},
  "endMs": ${end},
  "durationMs": ${duration_ms},
  "exitCode": ${FLOW_EXIT}
}
TJSON
  log "Flow ${FLOW} completed in ${duration_ms}ms (exit=${FLOW_EXIT})"
}

# ── Meta ────────────────────────────────────────────────────────
emit_meta() {
  cat > "${FLOW_DIR}/meta.json" <<MJSON
{
  "flow": "${FLOW}",
  "udid": "${UDID}",
  "appId": "${APP_ID}",
  "mockPort": "${MOCK_PORT:-null}",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "ci": "${CI:-false}",
  "runId": "${GITHUB_RUN_ID:-local}",
  "runAttempt": "${GITHUB_RUN_ATTEMPT:-1}"
}
MJSON
}

# ── Smoke Config Seeding ───────────────────────────────────────
seed_smoke_config() {
  log "Seeding smoke config for ${FLOW}..."
  local app_data_dir
  app_data_dir="$(xcrun simctl get_app_container "$UDID" "$APP_ID" data 2>/dev/null || true)"

  if [[ -z "$app_data_dir" ]]; then
    log "App not yet installed or container unavailable — seeding after install"
    return 0
  fi

  local payload='{"target":"mock","readOnly":false,"debugLogging":true}'
  mkdir -p "$app_data_dir/Documents" "$app_data_dir/Library/NoCloud" "$app_data_dir/Library/Application Support"
  printf '%s' "$payload" > "$app_data_dir/Documents/c64u-smoke.json"
  printf '%s' "$payload" > "$app_data_dir/Library/NoCloud/c64u-smoke.json"
  printf '%s' "$payload" > "$app_data_dir/Library/Application Support/c64u-smoke.json"
  log "Smoke config seeded in ${app_data_dir}"
}

# ── Connectivity Probe ─────────────────────────────────────────
connectivity_probe() {
  if [[ -z "$MOCK_PORT" ]]; then
    log "No mock port specified — skipping connectivity probe"
    return 0
  fi

  log "Probing mock server at 127.0.0.1:${MOCK_PORT}..."
  local attempt=0
  local max_attempts=10
  while [[ $attempt -lt $max_attempts ]]; do
    if xcrun simctl spawn "$UDID" /usr/bin/curl --silent --fail "http://127.0.0.1:${MOCK_PORT}/v1/info" > /dev/null 2>&1; then
      log "Mock server reachable from simulator"
      return 0
    fi
    # Also try host-level curl
    if curl --silent --fail "http://127.0.0.1:${MOCK_PORT}/v1/info" > /dev/null 2>&1; then
      log "Mock server reachable from host (attempt $((attempt + 1)))"
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  log "ERROR: Mock server unreachable after ${max_attempts} attempts"
  return 1
}

# ── Debug Payload Collection ───────────────────────────────────
collect_debug_payloads() {
  local endpoints=("trace" "actions" "log" "errorLog")
  local filenames=("trace.json" "action.json" "log.json" "errorLog.json")

  for i in "${!endpoints[@]}"; do
    local endpoint="${endpoints[$i]}"
    local filename="${filenames[$i]}"
    local attempt=0
    while [[ $attempt -lt 5 ]]; do
      if xcrun simctl spawn "$UDID" /usr/bin/curl --silent --show-error --fail \
        "http://127.0.0.1:39877/debug/${endpoint}" > "${FLOW_DIR}/${filename}" 2>/dev/null; then
        break
      fi
      attempt=$((attempt + 1))
      sleep 1
    done
    if [[ $attempt -ge 5 ]]; then
      echo "[]" > "${FLOW_DIR}/${filename}"
      log "Failed to collect debug/${endpoint} — wrote empty array"
    fi
  done

  # Collect network.json if available
  local net_attempt=0
  while [[ $net_attempt -lt 3 ]]; do
    if xcrun simctl spawn "$UDID" /usr/bin/curl --silent --show-error --fail \
      "http://127.0.0.1:39877/debug/network" > "${FLOW_DIR}/network.json" 2>/dev/null; then
      break
    fi
    net_attempt=$((net_attempt + 1))
    sleep 1
  done
  if [[ $net_attempt -ge 3 ]]; then
    echo '{"requests":[],"successCount":0,"failureCount":0}' > "${FLOW_DIR}/network.json"
    log "No network.json endpoint — wrote empty stub"
  fi

  # Produce event.json stub (Maestro events are in junit)
  echo '[]' > "${FLOW_DIR}/event.json"
}

# ── Video Recording ────────────────────────────────────────────
VIDEO_PID=""
start_video() {
  local video_path="${FLOW_DIR}/video/${FLOW}.mov"
  xcrun simctl io "$UDID" recordVideo --codec h264 "$video_path" &
  VIDEO_PID=$!
  log "Video recording started (PID=${VIDEO_PID})"
}

stop_video() {
  if [[ -n "$VIDEO_PID" ]]; then
    kill -INT "$VIDEO_PID" 2>/dev/null || true
    wait "$VIDEO_PID" 2>/dev/null || true
    VIDEO_PID=""
    log "Video recording stopped"
  fi
}

# ── Infra Diagnostics (on failure) ─────────────────────────────
capture_infra_diagnostics() {
  local infra_dir="${ARTIFACTS_BASE}/_infra/${FLOW}"
  mkdir -p "$infra_dir"

  lsof -i 2>/dev/null | head -100 > "$infra_dir/lsof.txt" || true
  netstat -an 2>/dev/null | head -50 > "$infra_dir/netstat.txt" || true
  ps aux 2>/dev/null | head -30 > "$infra_dir/ps.txt" || true
  xcrun simctl list devices 2>/dev/null > "$infra_dir/simctl-devices.txt" || true

  # Simulator system log (last 2 minutes)
  xcrun simctl spawn "$UDID" log show --last 2m --style compact 2>/dev/null \
    | tail -200 > "$infra_dir/simctl-syslog.txt" || true

  # Host curl health
  if [[ -n "$MOCK_PORT" ]]; then
    curl --silent --max-time 5 "http://127.0.0.1:${MOCK_PORT}/v1/info" \
      > "$infra_dir/host-curl-health.json" 2>&1 || true
  fi

  # Simulator curl health
  if [[ -n "$MOCK_PORT" ]]; then
    xcrun simctl spawn "$UDID" /usr/bin/curl --silent --max-time 5 \
      "http://127.0.0.1:${MOCK_PORT}/v1/info" \
      > "$infra_dir/sim-curl-health.json" 2>&1 || true
  fi

  log "Infrastructure diagnostics captured in ${infra_dir}"
}

# ── Cleanup Trap ───────────────────────────────────────────────
cleanup() {
  stop_video
  emit_timing
}
trap cleanup EXIT

# ── Main ───────────────────────────────────────────────────────
emit_meta

# Install app
log "Installing app in simulator ${UDID}..."
xcrun simctl install "$UDID" "$APP_PATH"

# Seed smoke config
seed_smoke_config

# Connectivity probe
if ! connectivity_probe; then
  log "Connectivity probe failed — capturing diagnostics and aborting"
  capture_infra_diagnostics
  FLOW_EXIT=1
  exit 1
fi

# Start video
start_video

# Run Maestro
log "Running Maestro flow: ${FLOW}"
MAESTRO_CLI_NO_ANALYTICS=1 \
MAESTRO_DRIVER_STARTUP_TIMEOUT=120000 \
  "$MAESTRO_BIN" test ".maestro/${FLOW}.yaml" \
    --format junit \
    --output "${FLOW_DIR}/junit.xml" \
  && FLOW_EXIT=0 || FLOW_EXIT=$?

# Capture screenshot
if [[ $FLOW_EXIT -eq 0 ]]; then
  xcrun simctl io "$UDID" screenshot "${FLOW_DIR}/screenshots/${FLOW}-final.png" || true
else
  xcrun simctl io "$UDID" screenshot "${FLOW_DIR}/screenshots/${FLOW}-failure.png" || true
fi

# Collect debug payloads
collect_debug_payloads

# On failure, capture infra diagnostics
if [[ $FLOW_EXIT -ne 0 ]]; then
  log "Flow ${FLOW} failed (exit=${FLOW_EXIT}) — capturing diagnostics"
  capture_infra_diagnostics
fi

exit $FLOW_EXIT
