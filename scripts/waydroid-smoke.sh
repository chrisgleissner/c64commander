#!/usr/bin/env bash
# Waydroid smoke test for the C64U Remote APK.
#
# Waydroid is the closest analog to Sailfish OS Android AppSupport: both run an
# AOSP-derived Android in an LXC container sharing the host kernel, and the
# Waydroid VANILLA image has NO Google services (like Sailfish). This harness
# brings Waydroid up and runs the keypad-only / no-GMS smoke
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
IMAGE_TYPE="${WAYDROID_IMAGE_TYPE:-VANILLA}"   # VANILLA = AOSP, NO Google services (like Sailfish)
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

start_session() {
  local st; st="$(waydroid status 2>/dev/null)"
  if echo "$st" | grep -qi "Session.*RUNNING"; then log "Waydroid session already running."; return 0; fi
  ensure_compositor || return 1
  log "Starting Waydroid session..."
  nohup waydroid session start >"$SESSION_LOG" 2>&1 &
  disown || true
  local n=0
  until waydroid status 2>/dev/null | grep -qi "Session.*RUNNING" || [[ $n -ge 60 ]]; do sleep 3; n=$((n+1)); done
  waydroid status 2>/dev/null | grep -qi "Session.*RUNNING" || { log "ERROR: session did not start (see $SESSION_LOG)"; return 1; }
  # let Android finish booting
  local b=0
  until waydroid shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q 1 || [[ $b -ge 60 ]]; do sleep 3; b=$((b+1)); done
  log "Waydroid session running."
}

waydroid_serial() {
  local ip; ip="$(waydroid status 2>/dev/null | awk -F'\t' '/IP address/{print $2}' | tr -d ' \r')"
  [[ -z "$ip" ]] && ip="$(waydroid shell ip route 2>/dev/null | awk '/scope link/{print $9; exit}' | tr -d '\r')"
  echo "${ip:+$ip:5555}"
}

adb_connect() {
  adb start-server >/dev/null 2>&1 || true
  local serial; serial="$(waydroid_serial)"
  if [[ -n "$serial" ]]; then adb connect "$serial" >/dev/null 2>&1 || true; echo "$serial"; return; fi
  # fall back to any already-listed device that isn't a physical phone/emulator
  adb devices | awk 'NR>1 && $2=="device"{print $1}' | grep -E '^[0-9]+\.' | head -n1
}

run() {
  local apk_glob="${1:-$DEFAULT_APK_GLOB}" pkg="${2:-$DEFAULT_PACKAGE}"
  have waydroid || { log "ERROR: waydroid not installed. Run: sudo $0 setup"; exit 2; }
  start_session || exit 6
  local serial; serial="$(adb_connect)"
  [[ -z "$serial" ]] && { log "ERROR: could not resolve a Waydroid adb serial"; exit 7; }
  log "Waydroid adb serial: $serial"
  log "Running keypad/no-GMS smoke against $pkg inside Waydroid..."
  bash scripts/android-keypad-smoke.sh "$serial" "$apk_glob" "$pkg" "artifacts/android-apks/validation/waydroid"
}

smoke() { run "$@"; }

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
