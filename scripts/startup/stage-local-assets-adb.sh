#!/usr/bin/env bash
set -euo pipefail

ASSET_DIR="${1:-tests/fixtures/local-source-assets}"
TARGET_DIR="${2:-/sdcard/Download/c64commander-assets}"
SERIAL="${ANDROID_SERIAL:-}"

ADB=(adb)
if [[ -n "$SERIAL" ]]; then
  ADB+=( -s "$SERIAL" )
fi

if [[ ! -d "$ASSET_DIR" ]]; then
  echo "Asset directory not found: $ASSET_DIR" >&2
  exit 1
fi

required=(".sid" ".mod" ".crt" ".prg" ".d64" ".d71" ".d81")
for extension in "${required[@]}"; do
  if ! find "$ASSET_DIR" -type f -name "*${extension}" -print -quit | grep -q .; then
    echo "Missing required asset type ${extension} in ${ASSET_DIR}" >&2
    exit 1
  fi
done

if ! find "$ASSET_DIR" -type f -name "Songlengths.md5" -print -quit | grep -q .; then
  echo "Missing required Songlengths.md5 in ${ASSET_DIR}" >&2
  exit 1
fi

"${ADB[@]}" shell "rm -rf '$TARGET_DIR' && mkdir -p '$TARGET_DIR'"
"${ADB[@]}" push "$ASSET_DIR/." "$TARGET_DIR/" >/dev/null

echo "Staged assets to $TARGET_DIR"
for extension in "${required[@]}"; do
  count=$("${ADB[@]}" shell "find '$TARGET_DIR' -type f -name '*${extension}' | wc -l" | tr -d '[:space:]')
  echo "${extension}: ${count}"
done
songlengthCount=$("${ADB[@]}" shell "find '$TARGET_DIR' -type f -name 'Songlengths.md5' | wc -l" | tr -d '[:space:]')
echo "Songlengths.md5: ${songlengthCount}"
