#!/usr/bin/env bash
# QA bug-hunt capture helper (infrastructure-only: screenshot + UI hierarchy + foreground + logcat tail)
# Usage: bughunt-capture.sh <case-name> [logcat-lines]
# Saves into the active artifact root recorded in scratchpad/artifact_root.txt
set -uo pipefail
SERIAL="9B081FFAZ001WX"
ROOT_FILE="/tmp/claude-1000/-home-chris-dev-c64-c64commander/23d659ec-030f-450e-82c4-005db3e8a57b/scratchpad/artifact_root.txt"
ROOT="$(cat "$ROOT_FILE")"
CASE="${1:?case name required}"
LC_LINES="${2:-400}"
cd /home/chris/dev/c64/c64commander
mkdir -p "$ROOT"/screenshots "$ROOT"/hierarchies "$ROOT"/logs/logcat "$ROOT"/logs/commands
# Foreground activity
FG=$(adb -s "$SERIAL" shell dumpsys activity activities 2>/dev/null | grep -m1 -E "mResumedActivity|ResumedActivity" | sed 's/^[[:space:]]*//')
echo "$FG"
# Screenshot
adb -s "$SERIAL" exec-out screencap -p > "$ROOT/screenshots/${CASE}.png" 2>/dev/null
SZ=$(stat -c%s "$ROOT/screenshots/${CASE}.png" 2>/dev/null || echo 0)
echo "screenshot: $ROOT/screenshots/${CASE}.png (${SZ} bytes)"
# UI hierarchy
adb -s "$SERIAL" exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to: \/dev\/tty//' > "$ROOT/hierarchies/${CASE}.xml"
HSZ=$(stat -c%s "$ROOT/hierarchies/${CASE}.xml" 2>/dev/null || echo 0)
echo "hierarchy: $ROOT/hierarchies/${CASE}.xml (${HSZ} bytes)"
# Logcat tail for the package
adb -s "$SERIAL" logcat -d -t "$LC_LINES" 2>/dev/null | grep -iE "c64commander|AndroidRuntime|FATAL|ANR|chromium|Console" > "$ROOT/logs/logcat/${CASE}.log" 2>/dev/null
echo "logcat: $ROOT/logs/logcat/${CASE}.log"
