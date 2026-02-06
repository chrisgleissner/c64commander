#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/song.sid [--song 1] [--duration-ms 180000]"
  echo "Env: C64U_HOST, C64U_DEVICE_HOST, C64U_BASE_URL, C64U_PASSWORD, C64U_SONGNR, C64U_DURATION_MS"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SID_PATH="$1"
shift

if [[ ! -f "$SID_PATH" ]]; then
  echo "SID file not found: $SID_PATH"
  exit 1
fi

export VITE_ENABLE_TEST_PROBES="${VITE_ENABLE_TEST_PROBES:-0}"

npx --yes tsx "$ROOT_DIR/scripts/manual-play-sid.ts" "$SID_PATH" "$@"
