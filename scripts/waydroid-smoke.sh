#!/usr/bin/env bash
# Waydroid smoke test for the C64U Remote APK.
#
# Waydroid is a useful stand-in for a de-Googled, container-based Android host:
# it runs an AOSP-derived Android in an LXC container sharing the host kernel,
# and the Waydroid VANILLA image has NO Google services. This harness brings
# Waydroid up and runs the keypad-only / no-GMS smoke
# (scripts/android-keypad-smoke.sh) against the C64U Remote APK inside it.
#
# It is intentionally SELF-CONTAINED and EASILY DISABLED:
#   - set WAYDROID_SMOKE_DISABLE=1 to make every subcommand exit 0 immediately,
#   - `preflight` never fails the build (informational unless --strict),
#   - the CI job that calls it is opt-in (workflow_dispatch) and continue-on-error,
#   so if Waydroid proves unstable it can be turned off without touching anything else.
#
# Subcommands:
#   preflight          report prerequisites (binder, waydroid, weston, root); exit 0 unless --strict
#   setup              [ROOT] load binder, install waydroid + weston, `waydroid init -s VANILLA`, start container
#   run [apk] [pkg]    [user] start a headless session, adb-connect, and smoke the APK (default: C64U Remote)
#   smoke [apk] [pkg]  [user] just the smoke against an already-running session
#   teardown           stop the Waydroid session (and container if root)
#   adb-serial         print the connected Waydroid adb serial
#
# Local:  scripts/waydroid-smoke.sh preflight
#         sudo scripts/waydroid-smoke.sh setup        # one-time, privileged
#         scripts/waydroid-smoke.sh run               # builds nothing; expects artifacts/android-apks/*.apk
# CI:     see .github/workflows/waydroid-smoke.yaml (manual, non-blocking).
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_APK_GLOB="artifacts/android-apks/c64u-remote-*.apk"
DEFAULT_PACKAGE="uk.gleissner.c64uremote"
WAYLAND_SOCKET="${WAYDROID_WAYLAND_SOCKET:-wayland-waydroid}"
IMAGE_TYPE="${WAYDROID_IMAGE_TYPE:-VANILLA}"   # VANILLA = AOSP, NO Google services
WESTON_LOG="/tmp/waydroid-weston.log"
SESSION_LOG="/tmp/waydroid-session.log"

log() { echo "[waydroid-smoke] $*"; }
is_disabled() { [[ "${WAYDROID_SMOKE_DISABLE:-0}" == "1" ]]; }

have() { command -v "$1" >/dev/null 2>&1; }
binder_ready() { ls /dev/binder* >/dev/null 2>&1 || ls /dev/binderfs/binder* >/dev/null 2>&1; }
is_root() { [[ "$(id -u)" -eq 0 ]]; }

preflight() {
  local strict=0; [[ "${1:-}" == "--strict" ]] && strict=1
  local missing=0
  log "Waydroid smoke preflight:"
  binder_ready && echo "  [ok] binder device present" || { echo "  [missing] binder device (run: sudo modprobe binder_linux)"; missing=1; }
  have waydroid && echo "  [ok] waydroid installed" || { echo "  [missing] waydroid (run: sudo $0 setup)"; missing=1; }
  have weston && echo "  [ok] weston installed (for headless session)" || echo "  [warn] weston not installed (needed for headless run)"
  have adb && echo "  [ok] adb present" || { echo "  [missing] adb (Android platform-tools)"; missing=1; }
  if have waydroid; then
    local st; st="$(waydroid status 2>/dev/null | tr '\n' ' ')"
    echo "  [info] waydroid status: ${st:-unavailable}"
  fi
  [[ -n "$(ls $DEFAULT_APK_GLOB 2>/dev/null | head -n1)" ]] && echo "  [ok] C64U Remote APK present" || echo "  [warn] no APK at $DEFAULT_APK_GLOB (build with: npm run android:apk:all)"
  if [[ $missing -eq 0 ]]; then log "preflight: ready"; return 0; fi
  log "preflight: prerequisites missing (see above)"
  [[ $strict -eq 1 ]] && return 1 || return 0
}

setup() {
  is_root || { log "ERROR: 'setup' needs root. Run: sudo $0 setup"; exit 2; }
  log "Loading binder kernel module..."
  modprobe binder_linux 2>/dev/null || modprobe binder 2>/dev/null || true
  echo "binder_linux" > /etc/modules-load.d/waydroid.conf 2>/dev/null || true
  binder_ready || { log "ERROR: binder device still absent after modprobe; kernel may lack CONFIG_ANDROID_BINDER_IPC"; exit 3; }

  export DEBIAN_FRONTEND=noninteractive
  if ! have waydroid; then
    log "Installing Waydroid..."
    if ! have curl; then apt-get update && apt-get install -y curl ca-certificates; fi
    curl -s https://repo.waydro.id | bash || { log "repo.waydro.id script failed; trying distro package"; apt-get update; }
    apt-get install -y waydroid || { log "ERROR: failed to install waydroid"; exit 4; }
  fi
  if ! have weston; then
    log "Installing Weston (headless Wayland compositor)..."
    apt-get install -y weston || log "WARN: weston install failed; a Wayland session will be required for 'run'"
  fi

  if [[ ! -f /var/lib/waydroid/waydroid.cfg ]]; then
    log "Initializing Waydroid ($IMAGE_TYPE image; this downloads ~1 GB)..."
    waydroid init -s "$IMAGE_TYPE" || { log "ERROR: waydroid init failed"; exit 5; }
  else
    log "Waydroid already initialized."
  fi

  log "Starting Waydroid container service..."
  systemctl enable --now waydroid-container 2>/dev/null || (waydroid container start &)
  sleep 3
  log "setup complete. Now (as your normal user) run: $0 run"
}

ensure_compositor() {
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  mkdir -p "$XDG_RUNTIME_DIR" 2>/dev/null || true; chmod 700 "$XDG_RUNTIME_DIR" 2>/dev/null || true
  local sock="$XDG_RUNTIME_DIR/$WAYLAND_SOCKET"
  # Reuse an existing compositor (our named socket, or an inherited WAYLAND_DISPLAY).
  if [[ -S "$sock" ]]; then export WAYLAND_DISPLAY="$WAYLAND_SOCKET"; log "Reusing compositor socket $sock"; return 0; fi
  if [[ -n "${WAYLAND_DISPLAY:-}" && -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then log "Using existing WAYLAND_DISPLAY=$WAYLAND_DISPLAY"; return 0; fi
  if have weston; then
    log "Starting headless Weston (socket $WAYLAND_SOCKET)..."
    setsid weston --backend=headless-backend.so --socket="$WAYLAND_SOCKET" --idle-time=0 >"$WESTON_LOG" 2>&1 &
    disown || true
  elif have kwin_wayland; then
    # KDE's compositor with a virtual (offscreen) framebuffer — needs a session bus.
    log "Starting headless kwin_wayland --virtual (socket $WAYLAND_SOCKET)..."
    setsid bash -c "exec dbus-run-session -- kwin_wayland --virtual --width ${WAYDROID_SCREEN_W:-480} --height ${WAYDROID_SCREEN_H:-640} -s '$WAYLAND_SOCKET'" >"$WESTON_LOG" 2>&1 &
    disown || true
  else
    log "ERROR: no Wayland compositor available (install weston, or have kwin_wayland)"; return 1
  fi
  local n=0; until [[ -S "$sock" || $n -ge 25 ]]; do sleep 1; n=$((n+1)); done
  [[ -S "$sock" ]] || { log "ERROR: compositor socket $sock not created (see $WESTON_LOG)"; return 1; }
  export WAYLAND_DISPLAY="$WAYLAND_SOCKET"
  log "Compositor ready: WAYLAND_DISPLAY=$WAYLAND_DISPLAY (XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR)"
}

pm_ready() { [[ "$(waydroid app list 2>/dev/null | grep -c packageName)" -gt 0 ]]; }

start_session() {
  ensure_compositor || return 1
  if waydroid status 2>/dev/null | grep -qi "Session.*RUNNING"; then
    log "Waydroid session already running."
  else
    log "Starting Waydroid session..."
    nohup env WAYLAND_DISPLAY="$WAYLAND_DISPLAY" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" waydroid session start >"$SESSION_LOG" 2>&1 &
    disown || true
    local n=0
    until waydroid status 2>/dev/null | grep -qi "Session.*RUNNING" || [[ $n -ge 60 ]]; do sleep 3; n=$((n+1)); done
    waydroid status 2>/dev/null | grep -qi "Session.*RUNNING" || { log "ERROR: session did not start (see $SESSION_LOG)"; return 1; }
  fi
  # Readiness WITHOUT root: the Android package manager is up once `waydroid app
  # list` returns packages (avoids `waydroid shell`, which needs root).
  log "Waiting for the Android package manager..."
  local b=0; until pm_ready || [[ $b -ge 80 ]]; do sleep 3; b=$((b+1)); done
  pm_ready && log "Waydroid session ready (package manager up)." || log "WARN: package manager not confirmed; continuing."
}

waydroid_serial() {
  local ip; ip="$(waydroid status 2>/dev/null | awk -F'\t' '/IP address/{print $2}' | tr -d ' \r')"
  echo "${ip:+$ip:5555}"
}

run() {
  local apk_glob="${1:-$DEFAULT_APK_GLOB}" pkg="${2:-$DEFAULT_PACKAGE}"
  have waydroid || { log "ERROR: waydroid not installed. Run: sudo $0 setup"; exit 2; }
  start_session || exit 6
  smoke_waydroid "$apk_glob" "$pkg"
}

# Waydroid-native smoke. The core checks (no-GMS + install + launch) use only
# user-level `waydroid app *` commands so they work WITHOUT root. Deeper runtime
# inspection (resumed activity, screenshot, logcat) is best-effort and used only
# when root `waydroid shell` or an authorized adb connection is available
# (e.g. on CI runners with passwordless sudo).
smoke_waydroid() {
  local apk_glob="$1" pkg="$2"
  local apk; apk="$(ls $apk_glob 2>/dev/null | head -n1)"
  [[ -f "$apk" ]] || { log "ERROR: APK not found: $apk_glob"; exit 7; }
  local out="artifacts/android-apks/validation/waydroid"; mkdir -p "$out"
  local fails=0

  log "1. No hard Google Play Services dependency (static)"
  if node scripts/verify-apk-no-gms.mjs "$apk"; then log "   OK"; else log "   FAIL"; fails=$((fails+1)); fi

  log "2. Waydroid image has no Google services (VANILLA)"
  local gms; gms="$(waydroid app list 2>/dev/null | grep -c 'com.google.android.gms')"
  if [[ "$gms" == "0" ]]; then log "   OK (0 com.google.android.gms packages on the image)"; else log "   FAIL ($gms gms packages)"; fails=$((fails+1)); fi

  log "3. Install $pkg into Waydroid"
  waydroid app install "$apk" >/tmp/waydroid-install.log 2>&1 || true
  if waydroid app list 2>/dev/null | grep -q "packageName: $pkg"; then log "   OK (installed; listed by 'waydroid app list')"; else log "   FAIL (not listed after install)"; fails=$((fails+1)); fi

  log "4. Launch $pkg"
  if waydroid app launch "$pkg" >/tmp/waydroid-launch.log 2>&1; then log "   OK (launch issued; container active)"; else log "   FAIL (launch error; see /tmp/waydroid-launch.log)"; fails=$((fails+1)); fi
  sleep 6
  # Still listed after launch (proxy for "did not crash-uninstall").
  waydroid app list 2>/dev/null | grep -q "packageName: $pkg" && log "   OK ($pkg still present after launch)" || { log "   FAIL ($pkg vanished after launch)"; fails=$((fails+1)); }

  log "5. Runtime inspection (best-effort; needs root waydroid shell or authorized adb)"
  local serial; serial="$(waydroid_serial)"
  if [[ -n "$serial" ]] && adb connect "$serial" >/dev/null 2>&1 && adb -s "$serial" shell true >/dev/null 2>&1; then
    adb -s "$serial" shell dumpsys activity activities 2>/dev/null | grep -i ResumedActivity | grep -q "$pkg" \
      && log "   OK (adb): $pkg is the resumed activity" || log "   note (adb): $pkg not currently resumed"
    adb -s "$serial" exec-out screencap -p > "$out/c64u-remote-waydroid.png" 2>/dev/null && log "   screenshot: $out/c64u-remote-waydroid.png"
    adb -s "$serial" logcat -d 2>/dev/null | grep -iE 'GooglePlayServicesNotAvailable|SERVICE_MISSING|FATAL EXCEPTION' | grep -i "$pkg" \
      && { log "   FAIL (adb logcat shows GMS/fatal)"; fails=$((fails+1)); } || log "   OK (adb): no GMS/fatal in logcat"
  elif is_root || sudo -n true 2>/dev/null; then
    local SU=""; is_root || SU="sudo -n"
    $SU waydroid shell dumpsys activity activities 2>/dev/null | grep -i ResumedActivity | grep -q "$pkg" \
      && log "   OK (shell): $pkg is the resumed activity" || log "   note (shell): $pkg not currently resumed"
    if $SU waydroid shell screencap -p /sdcard/c64u-waydroid.png 2>/dev/null; then
      $SU cp /var/lib/waydroid/data/media/0/c64u-waydroid.png "$out/c64u-remote-waydroid.png" 2>/dev/null && log "   screenshot: $out/c64u-remote-waydroid.png"
    fi
  else
    log "   skipped (no root / authorized adb). Install + launch verified above; on CI (passwordless sudo) this step also captures a screenshot + resumed-activity + logcat."
  fi

  log "Waydroid smoke result: $([[ $fails -eq 0 ]] && echo PASS || echo "$fails CHECK(S) FAILED") for $pkg"
  [[ $fails -eq 0 ]] || exit 1
}

smoke() { local a="${1:-$DEFAULT_APK_GLOB}" p="${2:-$DEFAULT_PACKAGE}"; smoke_waydroid "$a" "$p"; }

teardown() {
  waydroid session stop 2>/dev/null || true
  is_root && (systemctl stop waydroid-container 2>/dev/null || waydroid container stop 2>/dev/null || true)
  pkill -f "weston .*$WAYLAND_SOCKET" 2>/dev/null || true
  log "torn down."
}

if is_disabled; then log "WAYDROID_SMOKE_DISABLE=1 → skipping (exit 0)."; exit 0; fi

case "${1:-preflight}" in
  preflight) shift || true; preflight "${1:-}";;
  setup) setup;;
  run) shift || true; run "${1:-}" "${2:-}";;
  smoke) shift || true; smoke "${1:-}" "${2:-}";;
  teardown) teardown;;
  adb-serial) waydroid_serial;;
  *) echo "Usage: $0 {preflight|setup|run|smoke|teardown|adb-serial}"; exit 1;;
esac
