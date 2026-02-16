#!/usr/bin/env bash
# iOS Maestro per-flow wrapper with structured evidence capture.
# Supports single-flow mode (--flow) and multi-flow mode (--flows).
#
# Single-flow usage:
#   scripts/ci/ios-maestro-run-flow.sh --flow <name> --udid <sim-udid> --app-path <App.app>
#
# Multi-flow usage:
#   scripts/ci/ios-maestro-run-flow.sh --flows "flow1,flow2,flow3" --group "group-1" --udid <sim-udid> --app-path <App.app>
#
# In multi-flow mode:
#   - Simulator is booted once (by caller)
#   - App is installed once (by this script at start)
#   - Each flow runs sequentially with isolated artifacts
#   - Group-level timing summary is produced
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_ID="uk.gleissner.c64commander"
FLOW=""
FLOWS=""
GROUP=""
UDID=""
APP_PATH=""
MOCK_PORT=""
MAESTRO_BIN="${HOME}/.maestro/bin/maestro"
ARTIFACTS_BASE="${ROOT_DIR}/artifacts/ios"
MAESTRO_CLI_NO_ANALYTICS=1

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Single-flow mode:
  --flow <name>        Maestro flow name (without .yaml)

Multi-flow mode:
  --flows <names>      Comma-separated Maestro flow names
  --group <name>       Group name for timing summary

Common options:
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
    --flows) FLOWS="$2"; shift 2 ;;
    --group) GROUP="$2"; shift 2 ;;
    --udid) UDID="$2"; shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --app-id) APP_ID="$2"; shift 2 ;;
    --mock-port) MOCK_PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# Validate arguments
if [[ -n "$FLOW" && -n "$FLOWS" ]]; then
  echo "ERROR: Cannot use both --flow and --flows" >&2
  exit 1
fi

if [[ -z "$FLOW" && -z "$FLOWS" ]]; then
  echo "ERROR: Must specify either --flow or --flows" >&2
  usage
  exit 1
fi

if [[ -z "$UDID" || -z "$APP_PATH" ]]; then
  echo "ERROR: Missing required arguments --udid or --app-path" >&2
  usage
  exit 1
fi

if [[ -n "$FLOWS" && -z "$GROUP" ]]; then
  echo "ERROR: --group is required when using --flows" >&2
  usage
  exit 1
fi

# Normalize to flows array
if [[ -n "$FLOW" ]]; then
  FLOWS="$FLOW"
  GROUP="${FLOW}"
fi

# ── Timing Utilities ─────────────────────────────────────────────
# macOS BSD date does not support %N (nanoseconds) — use python3
# for portable millisecond timestamps.
ms_timestamp() {
  python3 -c "import time; print(int(time.time()*1000))"
}

seconds_since() {
  local start_ms="$1"
  local end_ms
  end_ms=$(ms_timestamp)
  echo $(( (end_ms - start_ms) / 1000 ))
}

# ── Meta ────────────────────────────────────────────────────────
emit_meta() {
  local flow="$1"
  local flow_dir="$2"
  cat > "${flow_dir}/meta.json" <<MJSON
{
  "flow": "${flow}",
  "group": "${GROUP}",
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
  local flow="$1"
  log "Seeding smoke config for ${flow}..."
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
  local flow="$1"
  local flow_dir="$2"
  local endpoints=("trace" "actions" "log" "errorLog")
  local filenames=("trace.json" "action.json" "log.json" "errorLog.json")

  for i in "${!endpoints[@]}"; do
    local endpoint="${endpoints[$i]}"
    local filename="${filenames[$i]}"
    local attempt=0
    while [[ $attempt -lt 5 ]]; do
      if xcrun simctl spawn "$UDID" /usr/bin/curl --silent --show-error --fail \
        "http://127.0.0.1:39877/debug/${endpoint}" > "${flow_dir}/${filename}" 2>/dev/null; then
        break
      fi
      attempt=$((attempt + 1))
      sleep 1
    done
    if [[ $attempt -ge 5 ]]; then
      echo "[]" > "${flow_dir}/${filename}"
      log "Failed to collect debug/${endpoint} — wrote empty array"
    fi
  done

  # Collect network.json if available
  local net_attempt=0
  while [[ $net_attempt -lt 3 ]]; do
    if xcrun simctl spawn "$UDID" /usr/bin/curl --silent --show-error --fail \
      "http://127.0.0.1:39877/debug/network" > "${flow_dir}/network.json" 2>/dev/null; then
      break
    fi
    net_attempt=$((net_attempt + 1))
    sleep 1
  done
  if [[ $net_attempt -ge 3 ]]; then
    echo '{"requests":[],"successCount":0,"failureCount":0}' > "${flow_dir}/network.json"
    log "No network.json endpoint — wrote empty stub"
  fi

  # Produce event.json stub (Maestro events are in junit)
  echo '[]' > "${flow_dir}/event.json"
}

# ── Video Recording ────────────────────────────────────────────
VIDEO_PID=""
start_video() {
  local flow="$1"
  local flow_dir="$2"
  local video_path="${flow_dir}/video/${flow}.mov"
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
  local flow="$1"
  local infra_dir="${ARTIFACTS_BASE}/_infra/${flow}"
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

# ── Run Single Flow ────────────────────────────────────────────
run_single_flow() {
  local flow="$1"
  local flow_dir="${ARTIFACTS_BASE}/${flow}"
  local flow_start flow_end flow_duration_ms flow_exit=0

  mkdir -p "${flow_dir}/screenshots" "${flow_dir}/video"

  log "Starting flow: ${flow}"
  flow_start=$(ms_timestamp)

  # Emit meta
  emit_meta "$flow" "$flow_dir"

  # Seed smoke config (for flows that need it)
  seed_smoke_config "$flow"

  # Connectivity probe
  if ! connectivity_probe; then
    log "Connectivity probe failed for ${flow} — capturing diagnostics"
    capture_infra_diagnostics "$flow"
    flow_exit=1
    # Write timing and return
    flow_end=$(ms_timestamp)
    flow_duration_ms=$((flow_end - flow_start))
    cat > "${flow_dir}/timing.json" <<TJSON
{
  "flow": "${flow}",
  "group": "${GROUP}",
  "startMs": ${flow_start},
  "endMs": ${flow_end},
  "durationMs": ${flow_duration_ms},
  "exitCode": ${flow_exit}
}
TJSON
    return $flow_exit
  fi

  # Start video
  start_video "$flow" "$flow_dir"

  # Run Maestro
  log "Running Maestro flow: ${flow}"
  MAESTRO_CLI_NO_ANALYTICS=1 \
  MAESTRO_DRIVER_STARTUP_TIMEOUT=120000 \
    "$MAESTRO_BIN" test ".maestro/${flow}.yaml" \
      --device "$UDID" \
      --format junit \
      --output "${flow_dir}/junit.xml" \
    && flow_exit=0 || flow_exit=$?

  # Stop video
  stop_video

  # Capture screenshot
  if [[ $flow_exit -eq 0 ]]; then
    xcrun simctl io "$UDID" screenshot "${flow_dir}/screenshots/${flow}-final.png" || true
  else
    xcrun simctl io "$UDID" screenshot "${flow_dir}/screenshots/${flow}-failure.png" || true
  fi

  # Collect debug payloads
  collect_debug_payloads "$flow" "$flow_dir"

  # On failure, capture infra diagnostics
  if [[ $flow_exit -ne 0 ]]; then
    log "Flow ${flow} failed (exit=${flow_exit}) — capturing diagnostics"
    capture_infra_diagnostics "$flow"
  fi

  # Write timing
  flow_end=$(ms_timestamp)
  flow_duration_ms=$((flow_end - flow_start))
  cat > "${flow_dir}/timing.json" <<TJSON
{
  "flow": "${flow}",
  "group": "${GROUP}",
  "startMs": ${flow_start},
  "endMs": ${flow_end},
  "durationMs": ${flow_duration_ms},
  "exitCode": ${flow_exit}
}
TJSON

  log "Flow ${flow} completed in ${flow_duration_ms}ms (exit=${flow_exit})"
  return $flow_exit
}

# ── Group Timing Summary ───────────────────────────────────────
emit_group_timing() {
  local group="$1"
  local boot_seconds="$2"
  local install_seconds="$3"
  local job_start_ms="$4"
  local job_end_ms="$5"
  shift 5
  local flow_exits=("$@")

  local infra_dir="${ARTIFACTS_BASE}/_infra/${group}"
  mkdir -p "$infra_dir"

  local total_job_seconds=$(( (job_end_ms - job_start_ms) / 1000 ))

  # Build per-flow timing object
  local per_flow_json="{"
  local first=true
  for f in ${FLOWS//,/ }; do
    local timing_file="${ARTIFACTS_BASE}/${f}/timing.json"
    if [[ -f "$timing_file" ]]; then
      local duration_sec
      duration_sec=$(python3 -c "import json; print(json.load(open('$timing_file'))['durationMs'] // 1000)")
      if [[ "$first" != "true" ]]; then
        per_flow_json+=","
      fi
      per_flow_json+="\"${f}\": ${duration_sec}"
      first=false
    fi
  done
  per_flow_json+="}"

  # Build exit codes object
  local exit_codes_json="{"
  first=true
  for i in "${!flow_exits[@]}"; do
    local f
    f=$(echo "$FLOWS" | cut -d',' -f$((i+1)))
    if [[ "$first" != "true" ]]; then
      exit_codes_json+=","
    fi
    exit_codes_json+="\"${f}\": ${flow_exits[$i]}"
    first=false
  done
  exit_codes_json+="}"

  cat > "${infra_dir}/timing.json" <<GTJSON
{
  "group": "${group}",
  "flows": [$(echo "$FLOWS" | sed 's/,/", "/g' | sed 's/^/"/;s/$/"/')],
  "simulator_boot_seconds": ${boot_seconds},
  "app_install_seconds": ${install_seconds},
  "per_flow_seconds": ${per_flow_json},
  "total_job_seconds": ${total_job_seconds},
  "exitCodes": ${exit_codes_json}
}
GTJSON

  log "Group timing summary written to ${infra_dir}/timing.json"
}

# ── Main ───────────────────────────────────────────────────────

# Convert comma-separated flows to array
IFS=',' read -ra FLOW_ARRAY <<< "$FLOWS"

# Single-flow mode: backward compatible behavior
if [[ ${#FLOW_ARRAY[@]} -eq 1 && -n "$FLOW" ]]; then
  log "Single-flow mode: ${FLOW}"

  # Install app
  log "Installing app in simulator ${UDID}..."
  xcrun simctl install "$UDID" "$APP_PATH"

  # Run the flow
  run_single_flow "$FLOW"
  exit $?
fi

# Multi-flow mode
log "Multi-flow mode: group=${GROUP}, flows=${FLOWS}"

JOB_START_MS=$(ms_timestamp)
BOOT_START_MS=$(ms_timestamp)

# Note: Simulator boot is handled by the caller (workflow)
# We only track timing for operations we perform

# Install app once
log "Installing app in simulator ${UDID}..."
INSTALL_START_MS=$(ms_timestamp)
xcrun simctl install "$UDID" "$APP_PATH"
INSTALL_END_MS=$(ms_timestamp)
INSTALL_SECONDS=$(( (INSTALL_END_MS - INSTALL_START_MS) / 1000 ))

# Boot time is from job start to install complete (approximation)
BOOT_SECONDS=$(( (INSTALL_START_MS - JOB_START_MS) / 1000 ))

# Run each flow
FLOW_EXITS=()
for flow in "${FLOW_ARRAY[@]}"; do
  log "Running flow ${flow} in group ${GROUP}"
  run_single_flow "$flow"
  FLOW_EXITS+=($?)
done

JOB_END_MS=$(ms_timestamp)

# Emit group timing summary
emit_group_timing "$GROUP" "$BOOT_SECONDS" "$INSTALL_SECONDS" "$JOB_START_MS" "$JOB_END_MS" "${FLOW_EXITS[@]}"

# Determine overall exit code
# Return the first non-zero exit code, or 0 if all passed
OVERALL_EXIT=0
for exit_code in "${FLOW_EXITS[@]}"; do
  if [[ $exit_code -ne 0 ]]; then
    OVERALL_EXIT=$exit_code
    break
  fi
done

log "Group ${GROUP} completed with overall exit code ${OVERALL_EXIT}"
exit $OVERALL_EXIT
