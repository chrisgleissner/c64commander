#!/usr/bin/env bash
# Runner for the Remote Input -> C64U HIL verification harness.
#
# Drives the app's Remote Input surface with REAL Android touch (adb input) and
# asserts the input reaches the C64U, monitored over the device's own REST API.
#
# Prereqs: a Pixel-class phone on adb with the app installed & foregrounded, and
# a reachable Ultimate (C64U_HOST, default "u64"; C64U_PASSWORD if set).
#
# Usage: ./run.sh [joystick|keyboard|joystick-screen|all]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG=uk.gleissner.c64commander
: "${C64U_HOST:=u64}"; export C64U_HOST

PID=$(adb shell pidof "$PKG" | tr -d '\r')
if [ -z "$PID" ]; then
  echo "App not running; launching..."
  adb shell am start -n "$PKG/.MainActivity" >/dev/null
  sleep 3
  PID=$(adb shell pidof "$PKG" | tr -d '\r')
fi
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb forward tcp:9333 "localabstract:webview_devtools_remote_$PID" >/dev/null
WS=$(curl -s http://localhost:9333/json | grep -o '"webSocketDebuggerUrl": "[^"]*"' | head -1 | sed 's/.*ws:/ws:/; s/"$//')
[ -n "$WS" ] || { echo "Could not find the WebView debugger URL"; exit 1; }
echo "App PID=$PID  C64U=$C64U_HOST"

run() { echo; echo "=== verify-$1 ==="; node "$HERE/verify-$1.mjs" "$WS"; }
case "${1:-all}" in
  joystick) run joystick ;;
  keyboard) run keyboard ;;
  joystick-screen) run joystick-screen ;;
  all) run joystick; run keyboard; run joystick-screen ;;
  *) echo "usage: $0 [joystick|keyboard|joystick-screen|all]"; exit 2 ;;
esac
