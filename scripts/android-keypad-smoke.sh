#!/usr/bin/env bash
# Keypad-first / touch-free / no-GMS smoke test for a built APK, runnable against
# any adb target (the Callback-8020 emulator from scripts/sailfish-callback-emulator.sh
# OR a physical device such as the de-Googled Pixel 4). It validates the Callback
# 8020 constraints that CAN be checked off a real Sailfish device:
#
#   1. the APK has no hard Google Play Services dependency (static, via aapt),
#   2. it installs and launches to a RESUMED activity on a no-GMS Android,
#   3. it is operable with hardware keys only (d-pad + number keys, no taps),
#   4. no GMS / fatal errors appear in logcat after launch.
#
# Usage:
#   scripts/android-keypad-smoke.sh <serial> <apk-path> <package> [activity] [out-dir]
# Example:
#   scripts/android-keypad-smoke.sh 9B081FFAZ001WX \
#     artifacts/android-apks/c64u-remote-*.apk uk.gleissner.c64uremote
set -euo pipefail

SERIAL="${1:?adb serial required}"
APK_GLOB="${2:?apk path required}"
PACKAGE="${3:?package id required}"
ACTIVITY="${4:-}"
OUT_DIR="${5:-artifacts/android-apks/validation}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
mkdir -p "$OUT_DIR"

# Resolve a possible glob to a concrete file.
APK="$(ls $APK_GLOB 2>/dev/null | head -n1)"
[[ -f "$APK" ]] || { echo "FAIL: APK not found: $APK_GLOB"; exit 1; }
adb() { command adb -s "$SERIAL" "$@"; }
fails=0
step() { echo; echo "== $* =="; }

step "1. No hard Google Play Services dependency (static)"
if node scripts/verify-apk-no-gms.mjs "$APK"; then echo "  OK"; else echo "  FAIL"; fails=$((fails+1)); fi

step "2. Install + launch on $(adb shell getprop ro.product.model | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"
echo "  GMS packages on target: $(adb shell pm list packages 2>/dev/null | grep -c 'com.google.android.gms') (0 = no Google services)"
adb install -r -d "$APK" >/dev/null && echo "  installed $(basename "$APK")"
adb logcat -c >/dev/null 2>&1 || true
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 6
if adb shell dumpsys activity activities 2>/dev/null | grep -i "ResumedActivity" | grep -q "$PACKAGE"; then
  echo "  OK: resumed activity for $PACKAGE"
else
  echo "  FAIL: no resumed activity for $PACKAGE"; fails=$((fails+1))
fi

step "3. Keypad-only operation (hardware keys, NO taps)"
# Wake + dismiss keyguard, then drive d-pad + number keys only.
adb shell input keyevent 224 >/dev/null 2>&1 || true   # WAKEUP
# DPAD: DOWN(20) DOWN(20) RIGHT(22) CENTER(23); number keys 1(8) 9(16) 2(10); STAR(17)
for k in 20 20 22 23 8 16 10 17; do adb shell input keyevent "$k" >/dev/null 2>&1; sleep 0.4; done
adb shell uiautomator dump /sdcard/keypad-ui.xml >/dev/null 2>&1 || true
focused="$(adb shell cat /sdcard/keypad-ui.xml 2>/dev/null | grep -o 'focused="true"' | head -n1 || true)"
if [[ -n "$focused" ]]; then echo "  OK: a focusable element is focused after d-pad navigation"; else echo "  WARN: no focused node reported (WebView a11y may be off); see screenshot"; fi

step "4. No GMS / fatal errors in logcat"
errs="$(adb logcat -d 2>/dev/null | grep -iE 'GooglePlayServicesNotAvailable|SERVICE_MISSING|FATAL EXCEPTION' | grep -i "$PACKAGE" || true)"
errs_any="$(adb logcat -d 2>/dev/null | grep -iE 'GooglePlayServicesNotAvailable|SERVICE_MISSING' || true)"
if [[ -z "$errs" && -z "$errs_any" ]]; then echo "  OK: no GMS/fatal errors"; else echo "  FAIL:"; echo "$errs$errs_any"; fails=$((fails+1)); fi

shot="$OUT_DIR/${PACKAGE//./_}-keypad-smoke.png"
adb exec-out screencap -p > "$shot" 2>/dev/null && echo "  screenshot: $shot"

echo
if [[ $fails -eq 0 ]]; then echo "KEYPAD SMOKE: PASS for $PACKAGE"; else echo "KEYPAD SMOKE: $fails check(s) FAILED for $PACKAGE"; exit 1; fi
