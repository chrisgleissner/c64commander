#!/usr/bin/env bash
# QA bug-hunt capture helper (infrastructure-only: screenshot + UI hierarchy + foreground + logcat tail).
#
# Runs through droidctl, so the screenshot, hierarchy and logcat all carry its
# retry, settle and signature checks, and every adb call it makes is recorded in
# the run's commands.jsonl.
#
# Usage: bughunt-capture.sh <case-name> [logcat-lines]
#   --target is required, or DROIDCTL_TARGET / ANDROID_SERIAL in the environment.
set -uo pipefail
CASE="${1:?case name required}"
LC_LINES="${2:-400}"
REPO=/home/chris/dev/c64/c64commander
ROOT_FILE="${BUGHUNT_ARTIFACT_ROOT_FILE:-$REPO/scratchpad/artifact_root.txt}"
ROOT="${BUGHUNT_ARTIFACT_ROOT:-$(cat "$ROOT_FILE")}"

TARGET="${DROIDCTL_TARGET:-}"
if [ -z "$TARGET" ] && [ -n "${ANDROID_SERIAL:-}" ]; then TARGET="adb:${ANDROID_SERIAL}"; fi
if [ -z "$TARGET" ]; then
  echo "bughunt-capture: set DROIDCTL_TARGET (or ANDROID_SERIAL); there is no default target" >&2
  exit 2
fi

cd "$REPO"
mkdir -p "$ROOT"/logs/commands
exec node scripts/bughunt-capture.mjs --target "$TARGET" --case "$CASE" --lines "$LC_LINES" --out "$ROOT"
