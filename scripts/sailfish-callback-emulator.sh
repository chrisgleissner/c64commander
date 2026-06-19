#!/usr/bin/env bash
# Creates and launches a Commodore-Callback-8020-like Android emulator on Linux,
# as the closest reproducible substitute for Sailfish OS Android AppSupport when
# no real device is available. It is configured for the constraints that matter:
#
#   - AOSP "default" system image  -> NO Google Play Services (like Sailfish)
#   - 480x640, ~3.25" (density 240) -> the Callback's tiny internal display
#   - hw.touchScreen=no, hw.dPad=yes, hw.keyboard=yes, hw.mainKeys=yes
#                                    -> keypad-first / touch-disabled device
#
# Android level defaults to API 33 (Android 13), which matches the newest
# Sailfish OS 5.0 "Tampella" AppSupport level. This is a FUNCTIONAL substitute,
# not a Sailfish system: it does not reproduce AppSupport's LXC container, the T9
# IME, or Jolla host integration. For the closest container analog see Waydroid
# (docs/testing/sailfish-callback-8020-emulation.md). Without /dev/kvm the
# emulator runs under software rendering and is slow (multi-minute cold boots).
#
# Usage:
#   scripts/sailfish-callback-emulator.sh create        # create the AVD (installs the image if needed)
#   scripts/sailfish-callback-emulator.sh start         # launch headless
#   scripts/sailfish-callback-emulator.sh stop          # kill the running emulator
#   scripts/sailfish-callback-emulator.sh recreate      # delete + create
#   scripts/sailfish-callback-emulator.sh config        # print the resolved config
set -euo pipefail

AVD_NAME="${CALLBACK_AVD_NAME:-callback8020}"
API_LEVEL="${CALLBACK_API_LEVEL:-33}"            # 33 = Android 13 = newest Sailfish AppSupport level
IMAGE_TYPE="${CALLBACK_IMAGE_TYPE:-default}"     # default = AOSP, NO Google services
ABI="${CALLBACK_ABI:-x86_64}"
SYS_IMAGE="system-images;android-${API_LEVEL};${IMAGE_TYPE};${ABI}"
SCREEN_W="${CALLBACK_SCREEN_W:-480}"
SCREEN_H="${CALLBACK_SCREEN_H:-640}"
SCREEN_DENSITY="${CALLBACK_DENSITY:-240}"        # ~3.25" diagonal at 480x640 -> ~246dpi -> hdpi bucket 240
RAM_MB="${CALLBACK_RAM_MB:-4096}"
EMULATOR_GPU="${CALLBACK_GPU:-swiftshader_indirect}"

resolve_sdk_dir() {
  echo "${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
}
SDK_DIR="$(resolve_sdk_dir)"
export ANDROID_SDK_ROOT="$SDK_DIR" ANDROID_HOME="$SDK_DIR"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
AVD_DIR="${ANDROID_AVD_HOME:-$HOME/.android/avd}/${AVD_NAME}.avd"

print_config() {
  cat <<EOF
AVD name:     $AVD_NAME
System image: $SYS_IMAGE   (AOSP/no-GMS when IMAGE_TYPE=default)
Screen:       ${SCREEN_W}x${SCREEN_H} @ ${SCREEN_DENSITY}dpi  (~3.25")
RAM:          ${RAM_MB} MB
Input:        touchScreen=no, dPad=yes, keyboard=yes, mainKeys=yes
GPU:          $EMULATOR_GPU   (software; no /dev/kvm required, slow)
AVD dir:      $AVD_DIR
EOF
}

ensure_image() {
  if [[ ! -d "$ANDROID_HOME/system-images/android-${API_LEVEL}/${IMAGE_TYPE}/${ABI}" ]]; then
    echo "Installing $SYS_IMAGE ..."
    yes | sdkmanager --licenses >/dev/null 2>&1 || true
    sdkmanager "platform-tools" "emulator" "$SYS_IMAGE"
  fi
}

apply_hardware_profile() {
  local cfg="$AVD_DIR/config.ini"
  # config.ini is the editable source of truth; hardware-qemu.ini is regenerated each boot.
  set_key() {
    local key="$1" value="$2"
    if grep -q "^${key}=" "$cfg" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$cfg"
    else
      echo "${key}=${value}" >> "$cfg"
    fi
  }
  set_key hw.lcd.width "$SCREEN_W"
  set_key hw.lcd.height "$SCREEN_H"
  set_key hw.lcd.density "$SCREEN_DENSITY"
  set_key hw.ramSize "$RAM_MB"
  set_key hw.keyboard yes
  set_key hw.dPad yes
  set_key hw.mainKeys yes
  set_key hw.touchScreen no
  set_key hw.gpu.enabled yes
  set_key hw.gpu.mode "$EMULATOR_GPU"
  set_key skin.name "${SCREEN_W}x${SCREEN_H}"
  set_key skin.path _no_skin
  echo "Applied Callback 8020 hardware profile to $cfg"
}

create_avd() {
  ensure_image
  if avdmanager list avd 2>/dev/null | grep -q "Name: ${AVD_NAME}$"; then
    echo "AVD '$AVD_NAME' already exists. Use 'recreate' to rebuild."
  else
    echo "no" | avdmanager create avd -n "$AVD_NAME" -k "$SYS_IMAGE" -b "$ABI" --force
  fi
  apply_hardware_profile
  print_config
}

delete_avd() {
  avdmanager delete avd -n "$AVD_NAME" 2>/dev/null || true
}

start_avd() {
  adb start-server
  if adb devices | awk 'NR>1{print $1}' | grep -q "^emulator-"; then
    echo "An emulator is already running."
  else
    echo "Launching $AVD_NAME headless (software rendering; expect a slow cold boot without KVM)..."
    nohup setsid emulator -avd "$AVD_NAME" -gpu "$EMULATOR_GPU" \
      -no-window -no-audio -no-boot-anim -no-snapshot -accel off -cores 4 \
      </dev/null >/tmp/callback8020-emu.log 2>&1 &
    disown || true
  fi
  echo "Waiting for boot (log: /tmp/callback8020-emu.log) ..."
  adb wait-for-device
  local n=0
  until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" || $n -ge 150 ]]; do
    sleep 4; n=$((n+1))
  done
  adb shell input keyevent 82 >/dev/null 2>&1 || true
  echo "Boot state: $(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  echo "Next: install both APKs with 'npm run android:apk:all', then run scripts/android-keypad-smoke.sh <serial> <apk> <package>"
}

stop_avd() {
  adb emu kill 2>/dev/null || pkill -f "emulator .* -avd ${AVD_NAME}" || true
  echo "Stopped."
}

case "${1:-}" in
  create) create_avd ;;
  recreate) delete_avd; create_avd ;;
  start) start_avd ;;
  stop) stop_avd ;;
  config) print_config ;;
  *) echo "Usage: $0 {create|recreate|start|stop|config}"; exit 1 ;;
esac
