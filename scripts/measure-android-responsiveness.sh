#!/usr/bin/env bash
# Measure Android responsiveness on the attached Pixel 4 against the
# C64 Commander debug build. Emits a single JSON record to stdout.
#
# Usage:
#   scripts/measure-android-responsiveness.sh
#
# Required: adb-attached Android device with uk.gleissner.c64commander
# installed, and the saved-device entry resolving to a reachable C64U.
set -euo pipefail

PKG="uk.gleissner.c64commander"
ACTIVITY="$PKG/.MainActivity"

# Force-stop and cold launch.
adb shell am force-stop "$PKG" >/dev/null
sleep 1
START_OUTPUT=$(adb shell am start -W -n "$ACTIVITY")
TOTAL_TIME=$(echo "$START_OUTPUT" | awk '/TotalTime:/ { print $2 }')
LAUNCH_STATE=$(echo "$START_OUTPUT" | awk '/LaunchState:/ { print $2 }')

# Allow the WebView to settle so logcat noise within ~5s is captured.
sleep 6

# Logcat noise counts since boot.
LOG=$(adb logcat -d -v brief)
MIME_MAX_MS=$(echo "$LOG" | grep -oE 'Long monitor contention.*MimeMap.*for [0-9]+ms' | grep -oE 'for [0-9]+ms' | grep -oE '[0-9]+' | sort -nr | head -1 || true)
MIME_COUNT=$(echo "$LOG" | grep -c 'Long monitor contention.*MimeMap' || true)
ENOENT_SMOKE=$(echo "$LOG" | grep -c 'c64u-smoke.json.*ENOENT' || true)
CAPHTTP_COUNT=$(echo "$LOG" | grep -c 'Handling CapacitorHttp request' || true)
CAPCOOKIES_COUNT=$(echo "$LOG" | grep -c 'CapacitorCookies.*Getting cookies' || true)
MSG_UNDEFINED=$(echo "$LOG" | grep -c 'Msg: undefined' || true)

# Frame stats: reset and capture next 10s of UI activity (caller drives input).
adb shell dumpsys gfxinfo "$PKG" reset >/dev/null

cat <<JSON
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "package": "$PKG",
  "coldStart": {
    "totalTimeMs": ${TOTAL_TIME:-null},
    "launchState": "${LAUNCH_STATE:-unknown}"
  },
  "logcatNoise": {
    "mimeMapLongMonitorContentionMaxMs": ${MIME_MAX_MS:-0},
    "mimeMapLongMonitorContentionEvents": ${MIME_COUNT:-0},
    "enoentSmokeJson": ${ENOENT_SMOKE:-0},
    "capacitorHttpHandlingLines": ${CAPHTTP_COUNT:-0},
    "capacitorCookiesGettingLines": ${CAPCOOKIES_COUNT:-0},
    "msgUndefinedLines": ${MSG_UNDEFINED:-0}
  }
}
JSON
