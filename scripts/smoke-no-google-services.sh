#!/usr/bin/env bash
# smoke-no-google-services.sh <apk> <output-dir>
#
# Proves the app installs, starts and can be navigated on an Android device that
# has no Google Play Services at all.
#
# The app is meant to run on de-Googled handsets. It uses no Google APIs — no FCM,
# no Maps, no Play Billing, no Play Integrity, no GMS location — so nothing should
# stop it, but "should" is not evidence. Every other emulator job in this workflow
# runs a `google_apis` system image, so none of them would notice a Google
# dependency creeping in through a library or a Gradle transitive. This one runs an
# AOSP image instead and fails if the app cannot cope.
#
# It also fails if Play Services turns out to be present, because then the test
# would be proving nothing while appearing to pass.
#
# Reuses .maestro/smoke-launch.yaml rather than defining its own walk: that flow
# already launches the app, clears the first-run dialogs and steps through Home,
# Play, Settings and Config with assertions on each.
set -euo pipefail

APK="${1:?usage: smoke-no-google-services.sh <apk> <output-dir>}"
OUT="${2:?usage: smoke-no-google-services.sh <apk> <output-dir>}"
PKG=uk.gleissner.c64commander

mkdir -p "$OUT"

echo "== waiting for the device"
adb wait-for-device
# Bounded, per AGENTS.md: an unbounded wait on sys.boot_completed hangs until the runner
# kills the job, which reports as a timeout with no indication of what it was waiting for.
# scripts/smoke-android-emulator.sh bounds the same wait for the same reason.
BOOT_TIMEOUT_SECS=180
boot_deadline=$(( $(date +%s) + BOOT_TIMEOUT_SECS ))
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  if [ "$(date +%s)" -ge "$boot_deadline" ]; then
    echo "the emulator did not finish booting within ${BOOT_TIMEOUT_SECS}s" >&2
    exit 1
  fi
  sleep 2
done

# The whole point of this job. If a Google image is ever wired in by mistake, the
# run would still pass and silently stop testing what it claims to test.
echo "== confirming the device really has no Google Play Services"
INSTALLED="$(adb shell pm list packages | tr -d '\r')"
if grep -qE "package:com\.google\.android\.gms$" <<<"$INSTALLED"; then
  echo "this device has Google Play Services installed, so it cannot show the app" >&2
  echo "works without them. Check the system image is an AOSP one." >&2
  exit 1
fi
echo "confirmed: com.google.android.gms is not installed"

# Recorded in the evidence so a reader can see what the app did and did not have.
adb shell getprop ro.build.version.sdk > "$OUT/device-sdk.txt" 2>/dev/null || true
grep -cE "^package:" <<<"$INSTALLED" > "$OUT/device-package-count.txt" 2>/dev/null || true

echo "== installing $APK"
# Bounded: adb install can hang on a wedged adbd or a busy package manager.
if ! timeout 120 adb install -r -g "$APK"; then
  echo "installing the APK failed or timed out" >&2
  exit 1
fi
adb logcat -c || true

echo "== launching and walking the app"
set +e
(cd .maestro && maestro --no-ansi test smoke-launch.yaml)
MAESTRO_STATUS=$?
set -e

adb logcat -d > "$OUT/logcat.txt"

if [ $MAESTRO_STATUS -ne 0 ]; then
  echo "the app did not survive a launch and walk without Google Play Services" >&2
  adb exec-out screencap -p > "$OUT/failure.png" || true
  exit 1
fi

# Match the crashing process explicitly. A bare "FATAL EXCEPTION" grep matches the
# whole device log, and other preinstalled apps can crash under emulator load
# without it meaning anything about this build. AndroidRuntime always logs
# "Process: <pkg>, PID: N" on the line after "FATAL EXCEPTION: <thread>".
if grep -A1 -F "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -qF "Process: $PKG,"; then
  echo "the app crashed:" >&2
  grep -A20 -F "FATAL EXCEPTION" "$OUT/logcat.txt" >&2
  exit 1
fi

# A Java uncaught exception is only one of the ways this can die. A native crash writes a
# libc tombstone rather than a FATAL EXCEPTION, and an ANR writes neither, so the check
# above would pass through both. Both are worth failing on here: the whole point of this
# job is that the app is healthy without Google services.
if grep -qE "Fatal signal [0-9]+ .*>>> $PKG <<<" "$OUT/logcat.txt"; then
  echo "the app crashed natively:" >&2
  grep -B2 -A20 -E "Fatal signal [0-9]+ .*>>> $PKG <<<" "$OUT/logcat.txt" >&2
  exit 1
fi

if grep -qF "ANR in $PKG" "$OUT/logcat.txt"; then
  echo "the app stopped responding:" >&2
  grep -A20 -F "ANR in $PKG" "$OUT/logcat.txt" >&2
  exit 1
fi

if ! adb shell pidof "$PKG" >/dev/null; then
  echo "the app is no longer running at the end of the walk" >&2
  exit 1
fi

echo "== the app runs without Google Play Services"
