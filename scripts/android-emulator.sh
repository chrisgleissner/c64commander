#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AVD_NAME="C64Commander"
resolve_sdk_dir() {
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    echo "$ANDROID_SDK_ROOT"
    return
  fi
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    echo "$ANDROID_HOME"
    return
  fi
  if [[ -d "$HOME/Android/Sdk" ]]; then
    echo "$HOME/Android/Sdk"
    return
  fi
  local props="$ROOT_DIR/android/local.properties"
  if [[ -f "$props" ]]; then
    local sdk_dir
    sdk_dir=$(grep -E '^sdk.dir=' "$props" | head -n 1 | cut -d= -f2-)
    if [[ -n "$sdk_dir" ]]; then
      sdk_dir="${sdk_dir//\\/:}"
      echo "$sdk_dir"
      return
    fi
  fi
  echo "$HOME/Android/Sdk"
}

configure_android_sdk_env() {
  local sdk_dir="$1"
  export ANDROID_SDK_ROOT="$sdk_dir"
  export ANDROID_HOME="$sdk_dir"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
}

SDK_DIR="$(resolve_sdk_dir)"
API_LEVEL="34"
BUILD_TOOLS="34.0.0"
DEVICE_PROFILE="pixel_6"
WITH_PREREQS=1
WITH_SDK=1
WITH_AVD=1
WITH_BUILD=1
WITH_APK=1
WITH_EMULATOR=1
WITH_INSTALL=1
EMULATOR_GPU="swiftshader_indirect"
EMULATOR_ARGS="-netdelay none -netspeed full -no-snapshot -no-metrics"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --sdk-dir PATH         Android SDK root (default: $SDK_DIR)
  --avd-name NAME        AVD name (default: $AVD_NAME)
  --api LEVEL            Android API level (default: $API_LEVEL)
  --build-tools VERSION  Build tools version (default: $BUILD_TOOLS)
  --device PROFILE       AVD device profile (default: $DEVICE_PROFILE)
  --no-prereqs           Skip apt prerequisite installation
  --no-sdk               Skip SDK download/installation
  --no-avd               Skip AVD creation
  --no-build             Skip web build + Capacitor sync
  --no-apk               Skip APK build
  --no-emulator          Skip emulator launch
  --no-install           Skip APK install/launch
  --emulator-gpu MODE    Emulator GPU mode (default: $EMULATOR_GPU)
  --emulator-args "ARGS" Extra emulator args
  -h, --help             Show this help

Default behavior installs prerequisites, installs SDK, creates AVD, builds the app,
starts the emulator, installs the APK, and launches the app.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sdk-dir) SDK_DIR="$2"; shift 2;;
    --avd-name) AVD_NAME="$2"; shift 2;;
    --api) API_LEVEL="$2"; shift 2;;
    --build-tools) BUILD_TOOLS="$2"; shift 2;;
    --device) DEVICE_PROFILE="$2"; shift 2;;
    --no-prereqs) WITH_PREREQS=0; shift;;
    --no-sdk) WITH_SDK=0; shift;;
    --no-avd) WITH_AVD=0; shift;;
    --no-build) WITH_BUILD=0; shift;;
    --no-apk) WITH_APK=0; shift;;
    --no-emulator) WITH_EMULATOR=0; shift;;
    --no-install) WITH_INSTALL=0; shift;;
    --emulator-gpu) EMULATOR_GPU="$2"; shift 2;;
    --emulator-args) EMULATOR_ARGS="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; usage; exit 1;;
  esac
 done

  configure_android_sdk_env "$SDK_DIR"
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
export PATH="$JAVA_HOME/bin:$PATH"

install_prereqs() {
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to install prerequisites." >&2
    exit 1
  fi
  echo "Installing missing emulator prerequisites (requires sudo)..."
  sudo apt update
  sudo apt install -y openjdk-17-jdk unzip wget curl git \
    libgl1-mesa-dev libpulse0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrender1 libxi6 libxkbcommon0 libxkbcommon-x11-0 \
    libnss3 libnspr4 libdrm2 libgbm1 libasound2t64 libxtst6 libx11-xcb1 \
    qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils
  sudo usermod -aG kvm,libvirt "$USER" || true
}

check_prereqs() {
  local missing=()

  for cmd in java unzip wget curl git; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done

  if [[ ! -x "/dev/kvm" ]]; then
    missing+=("kvm")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing prerequisites: ${missing[*]}"
    return 1
  fi

  return 0
}

install_sdk_tools() {
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  cd "$ANDROID_HOME"
  if [[ ! -f cmdline-tools.zip ]]; then
    curl -o cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  fi
  if [[ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]]; then
    unzip -q cmdline-tools.zip -d /tmp/android-cmdline
    mv /tmp/android-cmdline/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
  fi

  yes | sdkmanager --licenses || true
  sdkmanager \
    "platform-tools" \
    "platforms;android-${API_LEVEL}" \
    "build-tools;${BUILD_TOOLS}" \
    "emulator" \
    "system-images;android-${API_LEVEL};google_apis;x86_64"
}

ensure_avd() {
  if ! avdmanager list avd | grep -q "Name: $AVD_NAME"; then
    yes "no" | avdmanager create avd -n "$AVD_NAME" -k "system-images;android-${API_LEVEL};google_apis;x86_64" -d "$DEVICE_PROFILE"
  fi
}

build_app() {
  cd "$ROOT_DIR"
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run cap:build
}

build_apk() {
  cd "$ROOT_DIR"
  npm run android:apk
}

start_emulator() {
  adb start-server
  local extra_args=""
  if [[ -z "${DISPLAY:-}" ]]; then
    echo "DISPLAY is not set. Launching emulator headless." >&2
    extra_args="-no-window -no-audio -no-boot-anim"
  fi
  if ! adb devices | grep -q "emulator-"; then
    nohup setsid emulator -avd "$AVD_NAME" -gpu "$EMULATOR_GPU" $EMULATOR_ARGS $extra_args </dev/null >/tmp/c64-emu.log 2>&1 &
    disown || true
  fi
}

get_emulator_id() {
  adb devices | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {print $1}' | head -n 1
}

wait_for_boot() {
  local emulator_id
  emulator_id="$(get_emulator_id)"
  if [[ -z "$emulator_id" ]]; then
    timeout 30 adb wait-for-device || {
      echo "adb wait-for-device timed out after 30s" >&2
      exit 1
    }
    emulator_id="$(get_emulator_id)"
  fi
  local boot_completed=""
  local attempts=0
  # Max 30 attempts × 2s = 60s (strict timeout guardrail)
  while [[ "$boot_completed" != "1" && $attempts -lt 30 ]]; do
    boot_completed="$(timeout 10 adb -s "$emulator_id" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    if [[ "$boot_completed" != "1" ]]; then
      sleep 2
      attempts=$((attempts + 1))
    fi
  done
  if [[ "$boot_completed" != "1" ]]; then
    echo "Emulator did not finish booting within 60s." >&2
    exit 1
  fi
}

install_apk() {
  local apk_path="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
  if [[ ! -f "$apk_path" ]]; then
    local debug_dir="$ROOT_DIR/android/app/build/outputs/apk/debug"
    if [[ -d "$debug_dir" ]]; then
      apk_path=$(ls -1 "$debug_dir"/*.apk 2>/dev/null | sort | head -n 1)
    fi
  fi
  if [[ -z "$apk_path" || ! -f "$apk_path" ]]; then
    echo "APK not found under $ROOT_DIR/android/app/build/outputs/apk/debug" >&2
    exit 1
  fi
  local emulator_id
  emulator_id="$(get_emulator_id)"
  if [[ -z "$emulator_id" ]]; then
    echo "No emulator found. Start one or enable --emulator." >&2
    exit 1
  fi
  wait_for_boot
  adb -s "$emulator_id" install -r "$apk_path"
  adb -s "$emulator_id" shell am start -n uk.gleissner.c64commander/.MainActivity
}

if [[ $WITH_PREREQS -eq 1 ]]; then
  if ! check_prereqs; then
    install_prereqs
  else
    echo "Prerequisites already installed. Skipping sudo."
  fi
fi

if [[ $WITH_SDK -eq 1 ]]; then
  install_sdk_tools
fi

if [[ $WITH_AVD -eq 1 ]]; then
  ensure_avd
fi

if [[ $WITH_BUILD -eq 1 ]]; then
  build_app
fi

if [[ $WITH_APK -eq 1 ]]; then
  build_apk
fi

if [[ $WITH_EMULATOR -eq 1 ]]; then
  start_emulator
fi

if [[ $WITH_INSTALL -eq 1 ]]; then
  install_apk
fi

echo "Done. If the emulator UI is not visible, check /tmp/c64-emu.log for details."
