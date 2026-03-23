#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

UDID=""
APP_PATH=""
MOCK_PORT=""

usage() {
  cat <<EOF
Usage: $(basename "$0") --udid <sim-udid> --app-path <App.app> [--mock-port <port>]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --udid) UDID="$2"; shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --mock-port) MOCK_PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$UDID" || -z "$APP_PATH" ]]; then
  echo "Missing required arguments --udid or --app-path" >&2
  usage
  exit 1
fi

probe_flows=(
  "ios-subflow-open-play-tab-probe"
  "ios-subflow-open-settings-tab-probe"
  "ios-subflow-open-play-add-items-probe"
)

cd "$ROOT_DIR"

for flow in "${probe_flows[@]}"; do
  cmd=(bash scripts/ci/ios-maestro-run-flow.sh --flow "$flow" --udid "$UDID" --app-path "$APP_PATH")
  if [[ -n "$MOCK_PORT" ]]; then
    cmd+=(--mock-port "$MOCK_PORT")
  fi
  echo "Running shared iOS subflow probe: $flow" >&2
  "${cmd[@]}"
done
