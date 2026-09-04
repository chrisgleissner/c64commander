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
  if ! command -v strings >/dev/null 2>&1; then
    echo "ERROR: strings is required to scan DEX entries without apkanalyzer" >&2
    return 1
  fi
  dex=$(unzip -Z1 "$apk_path" 'classes*.dex' || true)
  if [[ -z "$dex" ]]; then
    echo "ERROR: no classes*.dex entries in $apk_path" >&2
    return 1
  fi

  while IFS= read -r dex_entry; do
    # `grep -q` exits on the first match, which kills the writer ahead of it with SIGPIPE.
    # Under `set -o pipefail` that dead writer, not grep, would decide the pipeline status,
    # so a class present near the start of a large DEX was reported as absent. The subshell
    # turns pipefail off for this one pipeline, leaving grep's own verdict as the status.
    if ( set +o pipefail; unzip -p "$apk_path" "$dex_entry" | strings | grep -q "$needle" ); then
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

  # Same SIGPIPE-under-pipefail hazard as find_dex_string: apkanalyzer lists every package,
  # and grep exits as soon as it matches one. See the comment there.
  if ( set +o pipefail; "$apkanalyzer" dex packages "$apk_path" | grep -q "$needle" ); then
    return 0
  fi
  return 1
}

# Returns 0 when the class is present, 1 when it is provably absent. apkanalyzer is
# preferred; exit status 2 from it means the Android cmdline-tools are not installed, which
# is the only case that falls back to scanning the DEX entries with strings.
require_runtime_class() {
  local apk_path="$1"
  local dotted="$2"
  local slashed="$3"
  local status=0

  find_with_apkanalyzer "$apk_path" "$dotted" || status=$?
  if [[ "$status" -eq 0 ]]; then
    return 0
  fi
  if [[ "$status" -ne 2 ]]; then
    echo "ERROR: $dotted not found in DEX: $apk_path" >&2
    return 1
  fi

  if find_dex_string "$apk_path" "$slashed" || find_dex_string "$apk_path" "$dotted"; then
    return 0
  fi
  echo "ERROR: $dotted not found in DEX: $apk_path" >&2
  return 1
}

for raw in "$@"; do
  apk_path="$raw"
  if [[ ! -f "$apk_path" ]]; then
    echo "ERROR: APK not found: $apk_path" >&2
    exit 1
  fi

  echo "Verifying APK runtime classes: $apk_path"

  require_runtime_class "$apk_path" "org.tukaani.xz.LZMA2Options" "Lorg/tukaani/xz/LZMA2Options;"
  require_runtime_class "$apk_path" \
    "org.apache.commons.compress.archivers.sevenz.SevenZFile" \
    "Lorg/apache/commons/compress/archivers/sevenz/SevenZFile;"

  echo "OK: required SevenZ/XZ runtime classes found"
  echo

done
