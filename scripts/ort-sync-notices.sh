#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check)
      CHECK_ONLY=1
      ;;
    *)
      echo "unsupported argument: $arg" >&2
      exit 1
      ;;
  esac
done

SRC_MD="$ROOT_DIR/THIRD_PARTY_NOTICES.md"
SRC_TXT="$ROOT_DIR/THIRD_PARTY_NOTICES.txt"

if [[ ! -f "$SRC_MD" || ! -f "$SRC_TXT" ]]; then
  echo "root notices are missing; run scripts/ort-generate-notices.sh first" >&2
  exit 1
fi

TARGETS=(
  "$ROOT_DIR/public/THIRD_PARTY_NOTICES.md"
  "$ROOT_DIR/public/THIRD_PARTY_NOTICES.txt"
  "$ROOT_DIR/android/app/src/main/assets/public/THIRD_PARTY_NOTICES.md"
  "$ROOT_DIR/android/app/src/main/assets/public/THIRD_PARTY_NOTICES.txt"
  "$ROOT_DIR/ios/App/App/public/THIRD_PARTY_NOTICES.md"
  "$ROOT_DIR/ios/App/App/public/THIRD_PARTY_NOTICES.txt"
)

for target in "${TARGETS[@]}"; do
  src="$SRC_MD"
  if [[ "$target" == *.txt ]]; then
    src="$SRC_TXT"
  fi

  target_dir="$(dirname "$target")"
  if [[ "$CHECK_ONLY" == "1" ]]; then
    if [[ ! -f "$target" ]]; then
      echo "notice sync drift detected: missing $target" >&2
      exit 1
    fi
    cmp -s "$src" "$target" || {
      echo "notice sync drift detected: $target" >&2
      exit 1
    }
    continue
  fi

  mkdir -p "$target_dir"
  cp "$src" "$target"
done

if [[ "$CHECK_ONLY" == "1" ]]; then
  echo "notice sync check passed"
else
  echo "notice assets synced"
fi
