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
MAESTRO_LOG_LEVEL="${MAESTRO_LOG_LEVEL:-debug}"
MAESTRO_CLI_LOG_LEVEL="${MAESTRO_CLI_LOG_LEVEL:-debug}"
MAESTRO_DRIVER_STARTUP_TIMEOUT_MS="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"
IOS_MAESTRO_RECORD_VIDEO="${IOS_MAESTRO_RECORD_VIDEO:-0}"
MAESTRO_MAX_ATTEMPTS="${MAESTRO_MAX_ATTEMPTS:-3}"
MAESTRO_DRIVER_RETRY_BOOT_TIMEOUT_SECONDS="${MAESTRO_DRIVER_RETRY_BOOT_TIMEOUT_SECONDS:-240}"
IOS_MAESTRO_HEARTBEAT_SECONDS="${IOS_MAESTRO_HEARTBEAT_SECONDS:-15}"
DEBUG_PAYLOAD_MAX_ATTEMPTS="${IOS_DEBUG_PAYLOAD_MAX_ATTEMPTS:-3}"
DEBUG_PAYLOAD_CONNECT_TIMEOUT_SECONDS="${IOS_DEBUG_PAYLOAD_CONNECT_TIMEOUT_SECONDS:-1}"
DEBUG_PAYLOAD_CURL_MAX_TIME_SECONDS="${IOS_DEBUG_PAYLOAD_CURL_MAX_TIME_SECONDS:-3}"
UNIFIED_LOG_PID=""
INSTALL_START_MS=""
INSTALL_END_MS=""
FLOW_LIFECYCLE_DIR="${TELEMETRY_FLOW_LIFECYCLE_DIR:-}"
FLOW_ACTIVE_FLAG="${FLOW_LIFECYCLE_DIR}/flow-active.flag"
FLOW_COMPLETE_FLAG="${FLOW_LIFECYCLE_DIR}/flow-complete.flag"

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

set_flow_lifecycle_state() {
  local state="$1"
  if [[ -z "$FLOW_LIFECYCLE_DIR" ]]; then
    return 0
  fi

  mkdir -p "$FLOW_LIFECYCLE_DIR"
  case "$state" in
    active)
      rm -f "$FLOW_COMPLETE_FLAG"
      touch "$FLOW_ACTIVE_FLAG"
      ;;
    complete)
      rm -f "$FLOW_ACTIVE_FLAG"
      touch "$FLOW_COMPLETE_FLAG"
      ;;
    reset)
      rm -f "$FLOW_ACTIVE_FLAG" "$FLOW_COMPLETE_FLAG"
      ;;
    *)
      echo "Unknown flow lifecycle state: $state" >&2
      return 1
      ;;
  esac
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

log_elapsed() {
  local start_ms="$1"
  echo "$(seconds_since "$start_ms")s"
}

trace_event() {
  local flow_dir="$1"
  local event_type="$2"
  local source="$3"
  local details_json="${4:-{}}"
  local event_file="${flow_dir}/timing-events.jsonl"

  python3 - "$event_file" "$event_type" "$source" "$details_json" <<'PY'
import json
import sys
import time

event_file, event_type, source, details_raw = sys.argv[1:5]
details = {}
if details_raw:
    try:
        details = json.loads(details_raw)
    except Exception:
        details = {"raw": details_raw}

event = {
    "tsMs": int(time.time() * 1000),
    "type": event_type,
    "source": source,
    "details": details,
}
with open(event_file, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(event, sort_keys=True) + "\n")
PY
}

trace_event_at() {
  local flow_dir="$1"
  local ts_ms="$2"
  local event_type="$3"
  local source="$4"
  local details_json="${5:-{}}"
  local event_file="${flow_dir}/timing-events.jsonl"

  python3 - "$event_file" "$ts_ms" "$event_type" "$source" "$details_json" <<'PY'
import json
import sys

event_file, ts_raw, event_type, source, details_raw = sys.argv[1:6]
details = {}
if details_raw:
    try:
        details = json.loads(details_raw)
    except Exception:
        details = {"raw": details_raw}

try:
    ts_ms = int(ts_raw)
except Exception:
    ts_ms = 0

event = {
    "tsMs": ts_ms,
    "type": event_type,
    "source": source,
    "details": details,
}
with open(event_file, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(event, sort_keys=True) + "\n")
PY
}

emit_timing_trace() {
  local flow="$1"
  local flow_dir="$2"
  local event_file="${flow_dir}/timing-events.jsonl"
  local trace_file="${flow_dir}/timing-trace.json"

  python3 - "$flow" "$GROUP" "$event_file" "$trace_file" <<'PY'
import json
import os
import sys

flow, group, event_file, trace_file = sys.argv[1:5]
events = []
if os.path.exists(event_file):
    with open(event_file, encoding="utf-8") as handle:
        for index, line in enumerate(handle):
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                event["_index"] = index
                events.append(event)
            except Exception:
                continue

events.sort(key=lambda item: (item.get("tsMs", 0), item.get("_index", 0)))
for event in events:
    event.pop("_index", None)

payload = {
    "flow": flow,
    "group": group,
    "events": events,
}
with open(trace_file, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
PY
}

start_unified_log_capture() {
  local flow_dir="$1"
  local unified_log_file="${flow_dir}/ios-unified.log"

  xcrun simctl spawn "$UDID" log stream --style compact --level debug --color none \
    --predicate 'process == "App" OR process == "SpringBoard" OR subsystem == "uk.gleissner.c64commander"' \
    > "$unified_log_file" 2>&1 &
  UNIFIED_LOG_PID=$!
  trace_event "$flow_dir" "ios.unified_log.start" "runner" "{\"pid\":${UNIFIED_LOG_PID}}"
}

stop_unified_log_capture() {
  local flow_dir="$1"
  if [[ -n "$UNIFIED_LOG_PID" ]]; then
    local started_ms
    started_ms=$(ms_timestamp)
    local stopped_pid="$UNIFIED_LOG_PID"
    log "Stopping unified iOS log capture for ${flow_dir} (pid=${stopped_pid})"
    kill -INT "$UNIFIED_LOG_PID" 2>/dev/null || true
    wait "$UNIFIED_LOG_PID" 2>/dev/null || true
    UNIFIED_LOG_PID=""
    trace_event "$flow_dir" "ios.unified_log.stop" "runner" "{\"pid\":${stopped_pid}}"
    log "Unified iOS log capture stopped for ${flow_dir} (pid=${stopped_pid}, elapsed=$(log_elapsed "$started_ms"))"
  fi
}

write_fallback_debug_payload() {
  local endpoint="$1"
  local outfile="$2"
  local flow_dir="$3"

  log "Writing fallback debug payload for debug/${endpoint} -> ${outfile}"

  python3 - "$endpoint" "$outfile" "$flow_dir" <<'PY'
import json
import os
import sys

endpoint, outfile, flow_dir = sys.argv[1:4]


def load_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def load_jsonl_lines(path, limit=20):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows[-limit:]


def load_text_tail(path, limit=20):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", errors="replace") as handle:
        lines = [line.rstrip("\n") for line in handle]
    return lines[-limit:]


meta = load_json(os.path.join(flow_dir, "meta.json")) or {}
timing_trace = load_json(os.path.join(flow_dir, "timing-trace.json")) or {"events": []}
raw_log = load_jsonl_lines(os.path.join(flow_dir, "maestro-raw.jsonl"))
unified_log = load_text_tail(os.path.join(flow_dir, "ios-unified.log"))

fallback_meta = {
    "fallback": True,
    "endpoint": endpoint,
    "reason": "debug-endpoint-unavailable",
    "meta": meta,
}

if endpoint == "actions":
    payload = {
        "actions": [
            {
                "type": "runner-fallback",
                "outcome": "unavailable",
                "endpoint": endpoint,
                "detail": "Maestro debug endpoint was unavailable; use raw runner evidence attached to this flow.",
                "rawLogExcerpt": [entry.get("line", "") for entry in raw_log[-10:]],
            }
        ],
        "fallback": fallback_meta,
    }
elif endpoint == "network":
    payload = {
        "requests": [
            {
                "url": "http://127.0.0.1:39877/debug/network",
                "method": "GET",
                "outcome": "unavailable",
                "reason": "debug-endpoint-unavailable",
            }
        ],
        "successCount": 0,
        "failureCount": 0,
        "fallback": fallback_meta,
    }
elif endpoint == "event":
    payload = {
        "events": timing_trace.get("events", [])[-20:],
        "fallback": fallback_meta,
    }
else:
    payload = [
        {
            "type": "runner-fallback",
            "endpoint": endpoint,
            "reason": "debug-endpoint-unavailable",
            "timingEventExcerpt": timing_trace.get("events", [])[-10:],
            "rawLogExcerpt": [entry.get("line", "") for entry in raw_log[-10:]],
            "unifiedLogExcerpt": unified_log[-10:],
        }
    ]

with open(outfile, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
}

capture_accessibility_snapshot() {
  local flow_dir="$1"
  local snapshot_name="$2"
  local out_dir="${flow_dir}/accessibility"
  local out_file="${out_dir}/${snapshot_name}.txt"
  local started_ms
  started_ms=$(ms_timestamp)
  mkdir -p "$out_dir"

  log "Capturing accessibility snapshot ${snapshot_name} -> ${out_file}"

  if "$MAESTRO_BIN" hierarchy --device "$UDID" > "$out_file" 2>&1; then
    trace_event "$flow_dir" "app.accessibility.snapshot" "maestro" "{\"name\":\"${snapshot_name}\",\"status\":\"ok\"}"
    if [[ ! -f "${flow_dir}/.a11y-first" ]]; then
      touch "${flow_dir}/.a11y-first"
      trace_event "$flow_dir" "app.accessibility.first_available" "maestro" "{\"name\":\"${snapshot_name}\"}"
    fi
    log "Accessibility snapshot ${snapshot_name} captured successfully (elapsed=$(log_elapsed "$started_ms"))"
  else
    trace_event "$flow_dir" "app.accessibility.snapshot" "maestro" "{\"name\":\"${snapshot_name}\",\"status\":\"error\"}"
    log "Accessibility snapshot ${snapshot_name} failed (elapsed=$(log_elapsed "$started_ms"))"
  fi
}

run_maestro_and_capture() {
  local flow="$1"
  local flow_dir="$2"
  local attempt="$3"
  local junit_file="${flow_dir}/junit.xml"
  local raw_log_file="${flow_dir}/maestro-raw-attempt-${attempt}.jsonl"
  local raw_log_latest_file="${flow_dir}/maestro-raw.jsonl"
  local flow_yaml=".maestro/${flow}.yaml"
  local heartbeat_seconds="$IOS_MAESTRO_HEARTBEAT_SECONDS"

  log "Launching Maestro attempt ${attempt}/${MAESTRO_MAX_ATTEMPTS} for ${flow} (yaml=${flow_yaml}, junit=${junit_file}, rawLog=${raw_log_file}, heartbeat=${heartbeat_seconds}s)"

  python3 - "$MAESTRO_BIN" "$flow_yaml" "$UDID" "$junit_file" "$raw_log_file" "$attempt" "$heartbeat_seconds" <<'PY'
import json
import os
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET

maestro_bin, flow_yaml, udid, junit_file, raw_log_file, attempt_raw, heartbeat_raw = sys.argv[1:8]
flow_name = os.path.splitext(os.path.basename(flow_yaml))[0]
attempt = int(attempt_raw)
try:
    heartbeat_seconds = max(1, int(heartbeat_raw))
except Exception:
    heartbeat_seconds = 15

cmd = [
    maestro_bin,
    "test",
    flow_yaml,
    "--device",
    udid,
    "--format",
    "junit",
    "--output",
    junit_file,
]

def emit(message: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"[{ts}] {message}", flush=True)

process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
start_time = time.time()
emit(
    "Maestro subprocess started: "
    f"flow={flow_name} attempt={attempt} udid={udid} junit={junit_file} rawLog={raw_log_file}"
)
emit(f"Maestro command: {' '.join(cmd)}")

with open(raw_log_file, "w", encoding="utf-8") as handle:
    stop_heartbeat = threading.Event()

    def heartbeat() -> None:
        while not stop_heartbeat.wait(heartbeat_seconds):
            elapsed = int(time.time() - start_time)
            emit(
                f"Maestro still running: flow={flow_name} attempt={attempt} elapsed={elapsed}s rawLog={raw_log_file}"
            )

    heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
    heartbeat_thread.start()
    for line in iter(process.stdout.readline, ""):
        now_ms = int(time.time() * 1000)
        entry = {"tsMs": now_ms, "line": line.rstrip("\n")}
        handle.write(json.dumps(entry, sort_keys=True) + "\n")
        handle.flush()
        print(line, end="")
    exit_code = process.wait()
    stop_heartbeat.set()
    heartbeat_thread.join(timeout=1)

elapsed_seconds = int(time.time() - start_time)
emit(f"Maestro subprocess finished: flow={flow_name} attempt={attempt} exit={exit_code} elapsed={elapsed_seconds}s")

def raw_log_excerpt(path: str, limit: int = 40) -> str:
  lines = []
  try:
    with open(path, encoding="utf-8") as handle:
      for line in handle:
        line = line.rstrip("\n")
        if line:
          lines.append(line)
  except FileNotFoundError:
    return ""
  return "\n".join(lines[-limit:])

def write_fallback_junit_report(path: str, reason: str, process_exit_code: int) -> None:
  suite = ET.Element(
      "testsuite",
      name=flow_name,
      tests="1",
      failures="1",
      errors="0",
      skipped="0",
      time="0",
  )
  case = ET.SubElement(suite, "testcase", classname="maestro", name=flow_name, time="0")
  failure = ET.SubElement(case, "failure", message=reason, type="MaestroFailure")
  excerpt = raw_log_excerpt(raw_log_file)
  failure.text = f"processExit={process_exit_code}"
  if excerpt:
    failure.text = f"{failure.text}\n{excerpt}"
  ET.ElementTree(suite).write(path, xml_declaration=True, encoding="unicode")

def summarize_junit(path: str) -> tuple[int, int, int]:
  tree = ET.parse(path)
  root = tree.getroot()

  if root.tag == "testsuite":
    tests = int(root.attrib.get("tests", "0"))
    failures = int(root.attrib.get("failures", "0"))
    errors = int(root.attrib.get("errors", "0"))
    return tests, failures, errors

  if root.tag == "testsuites":
    tests = 0
    failures = 0
    errors = 0
    for suite in root.findall("testsuite"):
      tests += int(suite.attrib.get("tests", "0"))
      failures += int(suite.attrib.get("failures", "0"))
      errors += int(suite.attrib.get("errors", "0"))
    return tests, failures, errors

  raise ValueError(f"Unexpected JUnit root element: {root.tag}")

junit_status = 0
needs_fallback_junit = False
try:
  tests, failures, errors = summarize_junit(junit_file)
  emit(
      f"Maestro JUnit summary: flow={flow_name} attempt={attempt} tests={tests} failures={failures} errors={errors} file={junit_file}"
  )
  if tests == 0:
    print(f"Maestro JUnit report contains zero tests: {junit_file}")
    junit_status = 1
    needs_fallback_junit = True
  elif failures > 0 or errors > 0:
    if exit_code == 0:
      print(
        f"Maestro JUnit report recorded failures/errors despite process exit {exit_code}: "
        f"tests={tests} failures={failures} errors={errors}"
      )
    else:
      print(
        f"Maestro JUnit report recorded failures/errors (process exit={exit_code}): "
        f"tests={tests} failures={failures} errors={errors}"
      )
    junit_status = 1
except FileNotFoundError:
  print(f"Maestro JUnit report missing: {junit_file}")
  junit_status = 1
  needs_fallback_junit = True
except Exception as exc:
  print(f"Failed to parse Maestro JUnit report {junit_file}: {exc}")
  junit_status = 1
  needs_fallback_junit = True

if needs_fallback_junit:
  write_fallback_junit_report(
      junit_file,
      "Maestro failed before producing a valid JUnit report.",
      exit_code,
  )
  emit(f"Wrote fallback JUnit report for flow={flow_name} attempt={attempt} -> {junit_file}")

if exit_code != 0:
  sys.exit(exit_code)
sys.exit(junit_status)
PY

  cp "$raw_log_file" "$raw_log_latest_file"
  log "Completed Maestro attempt ${attempt}/${MAESTRO_MAX_ATTEMPTS} for ${flow} (copied latest raw log to ${raw_log_latest_file})"
}

is_driver_startup_timeout_failure() {
  local flow_dir="$1"
  local raw_log_file="${flow_dir}/maestro-raw.jsonl"
  if [[ ! -f "$raw_log_file" ]]; then
    return 1
  fi

  if grep -qiE "IOSDriverTimeoutException|iOS driver not ready in time" "$raw_log_file" 2>/dev/null; then
    return 0
  fi
  return 1
}

preflight_maestro_driver_retry() {
  local flow="$1"
  local flow_dir="$2"

  trace_event "$flow_dir" "maestro.driver.preflight" "runner" "{\"reason\":\"ios_driver_timeout\"}"
  log "Driver timeout preflight: rebooting simulator and reinstalling app for ${flow}"

  xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true

  if ! xcrun simctl boot "$UDID" >/dev/null 2>&1; then
    trace_event "$flow_dir" "maestro.driver.preflight.boot" "runner" "{\"status\":\"boot-command-failed\"}"
    log "Simulator boot command failed during retry preflight (${flow})"
    return 1
  fi

  if ! timeout "$MAESTRO_DRIVER_RETRY_BOOT_TIMEOUT_SECONDS" xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1; then
    trace_event "$flow_dir" "maestro.driver.preflight.boot" "runner" "{\"status\":\"bootstatus-timeout\"}"
    log "Simulator bootstatus timeout during retry preflight (${flow})"
    return 1
  fi

  if ! xcrun simctl install "$UDID" "$APP_PATH" >/dev/null 2>&1; then
    trace_event "$flow_dir" "maestro.driver.preflight.install" "runner" "{\"status\":\"install-failed\"}"
    log "App reinstall failed during retry preflight (${flow})"
    return 1
  fi

  if ! seed_smoke_config "$flow"; then
    trace_event "$flow_dir" "maestro.driver.preflight.seed_smoke_config" "runner" '{"status":"failed"}'
    log "Smoke config seeding failed during retry preflight (${flow})"
    return 1
  fi
  xcrun simctl launch "$UDID" "$APP_ID" >/dev/null 2>&1 || true
  sleep 5
  xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
  sleep 2

  trace_event "$flow_dir" "maestro.driver.preflight" "runner" "{\"status\":\"ready\"}"
  log "Prepared simulator/app state for Maestro retry (${flow})"
}

extract_maestro_markers() {
  local flow_dir="$1"
  local raw_log_file="${flow_dir}/maestro-raw.jsonl"

  if [[ ! -f "$raw_log_file" ]]; then
    return
  fi

  python3 - "$raw_log_file" "${flow_dir}/timing-events.jsonl" <<'PY'
import json
import re
import sys

raw_log_file, event_file = sys.argv[1:3]

first_lookup = None
first_assertion = None

lookup_re = re.compile(r"lookup|visible|element", re.IGNORECASE)
assert_re = re.compile(r"assert|assertion", re.IGNORECASE)

with open(raw_log_file, encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except Exception:
            continue
        ts_ms = entry.get("tsMs")
        text = entry.get("line", "")
        if ts_ms is None:
            continue
        if first_lookup is None and lookup_re.search(text):
            first_lookup = {"tsMs": int(ts_ms), "type": "maestro.lookup.first", "source": "maestro", "details": {"line": text}}
        if first_assertion is None and assert_re.search(text):
            first_assertion = {"tsMs": int(ts_ms), "type": "maestro.assertion.evaluated", "source": "maestro", "details": {"line": text}}
        if first_lookup and first_assertion:
            break

with open(event_file, "a", encoding="utf-8") as out:
    if first_lookup:
        out.write(json.dumps(first_lookup, sort_keys=True) + "\n")
    if first_assertion:
        out.write(json.dumps(first_assertion, sort_keys=True) + "\n")
PY
}

extract_unified_log_markers() {
  local flow_dir="$1"
  local unified_log_file="${flow_dir}/ios-unified.log"

  if [[ ! -f "$unified_log_file" ]]; then
    return
  fi

  python3 - "$unified_log_file" "${flow_dir}/timing-events.jsonl" <<'PY'
import json
import re
import sys
from datetime import datetime

unified_log_file, event_file = sys.argv[1:3]

prefix = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})")
spawn_re = re.compile(r"uk\.gleissner\.c64commander|UIKitApplication", re.IGNORECASE)
window_created_re = re.compile(r"C64_STARTUP_EVENT\|app\.uiwindow\.first_created\|")
window_visible_re = re.compile(r"C64_STARTUP_EVENT\|app\.uiwindow\.first_visible\|")
frame_re = re.compile(r"C64_STARTUP_EVENT\|app\.frame\.first_rendered\|")
process_re = re.compile(r"C64_STARTUP_EVENT\|app\.process\.first_spawn\|")

seen = set()
events = []

def parse_ts_ms(line: str):
    match = prefix.search(line)
    if not match:
        return None
    try:
        dt = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S.%f")
        return int(dt.timestamp() * 1000)
    except Exception:
        return None

with open(unified_log_file, encoding="utf-8", errors="replace") as handle:
    for raw in handle:
        line = raw.rstrip("\n")
        ts_ms = parse_ts_ms(line)
        if ts_ms is None:
            continue

        if "app.process.first_spawn" not in seen and process_re.search(line):
            seen.add("app.process.first_spawn")
            events.append({"tsMs": ts_ms, "type": "app.process.first_spawn", "source": "app-log", "details": {"line": line}})
            continue

        if "app.process.first_spawn.fallback" not in seen and spawn_re.search(line):
            seen.add("app.process.first_spawn.fallback")
            events.append({"tsMs": ts_ms, "type": "app.process.first_spawn", "source": "simctl-log", "details": {"line": line}})

        if "app.uiwindow.first_created" not in seen and window_created_re.search(line):
          seen.add("app.uiwindow.first_created")
          events.append({"tsMs": ts_ms, "type": "app.uiwindow.first_created", "source": "app-log", "details": {"line": line}})

        if "app.uiwindow.first_visible" not in seen and window_visible_re.search(line):
          seen.add("app.uiwindow.first_visible")
          events.append({"tsMs": ts_ms, "type": "app.uiwindow.first_visible", "source": "app-log", "details": {"line": line}})

        if "app.frame.first_rendered" not in seen and frame_re.search(line):
            seen.add("app.frame.first_rendered")
            events.append({"tsMs": ts_ms, "type": "app.frame.first_rendered", "source": "app-log", "details": {"line": line}})

with open(event_file, "a", encoding="utf-8") as out:
    for event in events:
        out.write(json.dumps(event, sort_keys=True) + "\n")
PY
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

  local payload='{"target":"mock","readOnly":false,"debugLogging":true,"featureFlags":{"hvsc_enabled":true}}'
  log "Smoke config payload for ${flow}: ${payload}"
  mkdir -p "$app_data_dir/Documents" "$app_data_dir/Library/NoCloud" "$app_data_dir/Library/Application Support"
  printf '%s' "$payload" > "$app_data_dir/Documents/c64u-smoke.json"
  printf '%s' "$payload" > "$app_data_dir/Library/NoCloud/c64u-smoke.json"
  printf '%s' "$payload" > "$app_data_dir/Library/Application Support/c64u-smoke.json"
  log "Smoke config seeded in ${app_data_dir} (Documents, Library/NoCloud, Library/Application Support)"
}

# ── Connectivity Probe ─────────────────────────────────────────
connectivity_probe() {
  if [[ -z "$MOCK_PORT" ]]; then
    log "No external mock port configured — skipping external connectivity probe (smoke config is seeded in-app)"
    return 0
  fi

  log "Probing mock server at 127.0.0.1:${MOCK_PORT}..."
  local attempt=0
  local max_attempts=10
  while [[ $attempt -lt $max_attempts ]]; do
    log "Connectivity probe attempt $((attempt + 1))/${max_attempts} for 127.0.0.1:${MOCK_PORT}/v1/info"
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
    log "Collecting debug/${endpoint} for ${flow} -> ${flow_dir}/${filename}"
    while [[ $attempt -lt "$DEBUG_PAYLOAD_MAX_ATTEMPTS" ]]; do
      log "debug/${endpoint} fetch attempt $((attempt + 1))/${DEBUG_PAYLOAD_MAX_ATTEMPTS}"
      if xcrun simctl spawn "$UDID" /usr/bin/curl --silent --show-error --fail \
        --connect-timeout "$DEBUG_PAYLOAD_CONNECT_TIMEOUT_SECONDS" \
        --max-time "$DEBUG_PAYLOAD_CURL_MAX_TIME_SECONDS" \
        "http://127.0.0.1:39877/debug/${endpoint}" > "${flow_dir}/${filename}" 2>/dev/null; then
        break
      fi
      attempt=$((attempt + 1))
      sleep 1
    done
    if [[ $attempt -ge "$DEBUG_PAYLOAD_MAX_ATTEMPTS" ]]; then
      write_fallback_debug_payload "$endpoint" "${flow_dir}/${filename}" "$flow_dir"
      log "Failed to collect debug/${endpoint} — wrote fallback payload"
    fi
  done

  # Collect network.json if available
  local net_attempt=0
  log "Collecting debug/network for ${flow} -> ${flow_dir}/network.json"
  while [[ $net_attempt -lt "$DEBUG_PAYLOAD_MAX_ATTEMPTS" ]]; do
    log "debug/network fetch attempt $((net_attempt + 1))/${DEBUG_PAYLOAD_MAX_ATTEMPTS}"
    if xcrun simctl spawn "$UDID" /usr/bin/curl --silent --show-error --fail \
      --connect-timeout "$DEBUG_PAYLOAD_CONNECT_TIMEOUT_SECONDS" \
      --max-time "$DEBUG_PAYLOAD_CURL_MAX_TIME_SECONDS" \
      "http://127.0.0.1:39877/debug/network" > "${flow_dir}/network.json" 2>/dev/null; then
      break
    fi
    net_attempt=$((net_attempt + 1))
    sleep 1
  done
  if [[ $net_attempt -ge "$DEBUG_PAYLOAD_MAX_ATTEMPTS" ]]; then
    write_fallback_debug_payload "network" "${flow_dir}/network.json" "$flow_dir"
    log "No network.json endpoint — wrote fallback payload"
  fi

  log "Writing event fallback payload for ${flow} -> ${flow_dir}/event.json"
  write_fallback_debug_payload "event" "${flow_dir}/event.json" "$flow_dir"
}

# ── Video Recording ────────────────────────────────────────────
VIDEO_PID=""
start_video() {
  local flow="$1"
  local flow_dir="$2"
  if [[ "$IOS_MAESTRO_RECORD_VIDEO" != "1" ]]; then
    log "Video recording disabled for flow ${flow} (IOS_MAESTRO_RECORD_VIDEO=${IOS_MAESTRO_RECORD_VIDEO})"
    return
  fi
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

prepare_app_for_flow() {
  local flow="$1"
  local flow_dir="$2"

  log "Resetting app state before flow ${flow}"
  trace_event "$flow_dir" "app.reset.before_flow" "runner" "{\"flow\":\"${flow}\"}"
  xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
  sleep 2
  log "App state reset completed for ${flow}"
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
  local app_install_start_ms="${INSTALL_START_MS:-}"
  local app_install_end_ms="${INSTALL_END_MS:-}"

  mkdir -p "${flow_dir}/screenshots" "${flow_dir}/video"

  log "Starting flow: ${flow}"
  log "Flow ${flow} artifacts directory: ${flow_dir}"
  flow_start=$(ms_timestamp)

  trace_event "$flow_dir" "maestro.flow.start" "runner" "{\"flow\":\"${flow}\",\"group\":\"${GROUP}\"}"

  if [[ -n "${SIM_BOOT_START_MS:-}" ]]; then
    trace_event_at "$flow_dir" "$SIM_BOOT_START_MS" "simulator.boot.start" "workflow" "{}"
  fi
  if [[ -n "${SIM_BOOT_READY_MS:-}" ]]; then
    trace_event_at "$flow_dir" "$SIM_BOOT_READY_MS" "simulator.boot.ready" "workflow" "{}"
  fi
  if [[ -n "$app_install_start_ms" ]]; then
    trace_event_at "$flow_dir" "$app_install_start_ms" "app.install.start" "runner" "{}"
  fi
  if [[ -n "$app_install_end_ms" ]]; then
    trace_event_at "$flow_dir" "$app_install_end_ms" "app.install.end" "runner" "{}"
  fi

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
    emit_timing_trace "$flow" "$flow_dir"
    return $flow_exit
  fi

  prepare_app_for_flow "$flow" "$flow_dir"

  capture_accessibility_snapshot "$flow_dir" "pre-flow"
  log "Starting unified log capture for ${flow}"
  start_unified_log_capture "$flow_dir"

  # Start video
  start_video "$flow" "$flow_dir"

  set_flow_lifecycle_state active

  # Run Maestro
  log "Running Maestro flow: ${flow}"
  local attempt=1
  local max_attempts="$MAESTRO_MAX_ATTEMPTS"
  while [[ $attempt -le $max_attempts ]]; do
    log "Flow ${flow}: starting Maestro attempt ${attempt}/${max_attempts}"
    trace_event "$flow_dir" "maestro.command.first_sent" "runner" "{\"command\":\"maestro test\",\"attempt\":${attempt}}"
    MAESTRO_CLI_NO_ANALYTICS=1 \
    MAESTRO_LOG_LEVEL="$MAESTRO_LOG_LEVEL" \
    MAESTRO_CLI_LOG_LEVEL="$MAESTRO_CLI_LOG_LEVEL" \
    MAESTRO_DRIVER_STARTUP_TIMEOUT="$MAESTRO_DRIVER_STARTUP_TIMEOUT_MS" \
      run_maestro_and_capture "$flow" "$flow_dir" "$attempt" \
      && flow_exit=0 || flow_exit=$?

    if [[ $flow_exit -eq 0 ]]; then
      break
    fi

    if [[ $attempt -lt $max_attempts ]] && is_driver_startup_timeout_failure "$flow_dir"; then
      log "Detected iOS driver startup timeout for ${flow}; retrying with preflight"
      trace_event "$flow_dir" "maestro.driver.retry" "runner" "{\"attempt\":${attempt},\"reason\":\"ios_driver_timeout\"}"
      if ! preflight_maestro_driver_retry "$flow" "$flow_dir"; then
        log "Preflight retry failed for ${flow}; aborting retries"
        break
      fi
      attempt=$((attempt + 1))
      continue
    fi

    break
  done

  log "Flow ${flow}: Maestro loop finished with exit=${flow_exit} after ${attempt} attempt(s)"

  set_flow_lifecycle_state complete

  # Stop video
  stop_video
  log "Stopping unified log capture for ${flow}"
  stop_unified_log_capture "$flow_dir"

  extract_maestro_markers "$flow_dir"
  extract_unified_log_markers "$flow_dir"

  capture_accessibility_snapshot "$flow_dir" "post-flow"

  # Capture screenshot
  if [[ $flow_exit -eq 0 ]]; then
    log "Capturing success screenshot for ${flow}"
    xcrun simctl io "$UDID" screenshot "${flow_dir}/screenshots/${flow}-final.png" || true
  else
    log "Capturing failure screenshot for ${flow}"
    xcrun simctl io "$UDID" screenshot "${flow_dir}/screenshots/${flow}-failure.png" || true
  fi

  # On failure, capture infra diagnostics
  if [[ $flow_exit -ne 0 ]]; then
    log "Flow ${flow} failed (exit=${flow_exit}) — capturing diagnostics"
    capture_accessibility_snapshot "$flow_dir" "failure"
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

  emit_timing_trace "$flow" "$flow_dir"

  # Collect debug payloads after timing trace exists so fallback payloads can
  # embed real runner evidence instead of empty placeholders.
  log "Collecting debug payloads for ${flow}"
  collect_debug_payloads "$flow" "$flow_dir"

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
  INSTALL_START_MS=$(ms_timestamp)
  xcrun simctl install "$UDID" "$APP_PATH"
  INSTALL_END_MS=$(ms_timestamp)
  log "Installed app in simulator ${UDID} (elapsed=$(log_elapsed "$INSTALL_START_MS"))"

  # Run the flow
  run_single_flow "$FLOW"
  exit $?
fi

# Multi-flow mode
log "Multi-flow mode: group=${GROUP}, flows=${FLOWS}"
log "Runner configuration: udid=${UDID} appPath=${APP_PATH} attempts=${MAESTRO_MAX_ATTEMPTS} heartbeat=${IOS_MAESTRO_HEARTBEAT_SECONDS}s driverTimeoutMs=${MAESTRO_DRIVER_STARTUP_TIMEOUT_MS}"

set_flow_lifecycle_state reset

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
log "Installed app in simulator ${UDID} for group ${GROUP} (elapsed=${INSTALL_SECONDS}s)"

# Boot time is from job start to install complete (approximation)
BOOT_SECONDS=$(( (INSTALL_START_MS - JOB_START_MS) / 1000 ))

# Run each flow
FLOW_EXITS=()
for flow_index in "${!FLOW_ARRAY[@]}"; do
  flow="${FLOW_ARRAY[$flow_index]}"
  log "Running flow ${flow} in group ${GROUP} ($((flow_index + 1))/${#FLOW_ARRAY[@]})"
  flow_exit=0
  if run_single_flow "$flow"; then
    flow_exit=0
  else
    flow_exit=$?
  fi
  FLOW_EXITS+=($flow_exit)
  if [[ $flow_exit -ne 0 ]]; then
    break
  fi
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
