#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/android/app"

if [[ $# -lt 1 ]]; then
  echo "Usage: $(basename "$0") <apk-path> [apk-path ...]" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "ERROR: unzip is required" >&2
  exit 1
fi

find_dex_string() {
  local apk_path="$1"
  local needle="$2"
  local dex
  dex=$(unzip -Z1 "$apk_path" 'classes*.dex' || true)
  if [[ -z "$dex" ]]; then
    echo "ERROR: no classes*.dex entries in $apk_path" >&2
    return 1
  fi

  while IFS= read -r dex_entry; do
    if unzip -p "$apk_path" "$dex_entry" | strings | grep -q "$needle"; then
      return 0
    fi
  done <<< "$dex"

  return 1
}

find_with_apkanalyzer() {
  local apk_path="$1"
  local needle="$2"
  local sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
  local apkanalyzer="$sdk_root/cmdline-tools/latest/bin/apkanalyzer"
  if [[ ! -x "$apkanalyzer" ]]; then
    return 2
  fi

  if "$apkanalyzer" dex packages "$apk_path" | grep -q "$needle"; then
    return 0
  fi
  return 1
}

for raw in "$@"; do
  apk_path="$raw"
  if [[ ! -f "$apk_path" ]]; then
    echo "ERROR: APK not found: $apk_path" >&2
    exit 1
  fi

  echo "Verifying APK runtime classes: $apk_path"

  if ! find_with_apkanalyzer "$apk_path" "org.tukaani.xz.LZMA2Options"; then
    if [[ $? -eq 2 ]]; then
      if ! find_dex_string "$apk_path" "Lorg/tukaani/xz/LZMA2Options;" && ! find_dex_string "$apk_path" "org.tukaani.xz.LZMA2Options"; then
        echo "ERROR: org.tukaani.xz.LZMA2Options not found in DEX: $apk_path" >&2
        exit 1
      fi
    else
      echo "ERROR: org.tukaani.xz.LZMA2Options not found in DEX: $apk_path" >&2
      exit 1
    fi
  fi

  if ! find_with_apkanalyzer "$apk_path" "org.apache.commons.compress.archivers.sevenz.SevenZFile"; then
    if [[ $? -eq 2 ]]; then
      if ! find_dex_string "$apk_path" "Lorg/apache/commons/compress/archivers/sevenz/SevenZFile;" && ! find_dex_string "$apk_path" "org.apache.commons.compress.archivers.sevenz.SevenZFile"; then
        echo "ERROR: org.apache.commons.compress.archivers.sevenz.SevenZFile not found in DEX: $apk_path" >&2
        exit 1
      fi
    else
      echo "ERROR: org.apache.commons.compress.archivers.sevenz.SevenZFile not found in DEX: $apk_path" >&2
      exit 1
    fi
  fi
  echo "OK: required SevenZ/XZ runtime classes found"
  echo

done
