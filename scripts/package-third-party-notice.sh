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
DIST_MD="$ROOT_DIR/dist/THIRD_PARTY_NOTICES.md"

if [[ ! -f "$SRC_MD" ]]; then
  echo "root notice is missing; run scripts/generate-third-party-notices.mjs first" >&2
  exit 1
fi

if [[ "$CHECK_ONLY" == "1" ]]; then
  if [[ ! -f "$DIST_MD" ]]; then
    echo "packaged notice drift detected: missing dist/THIRD_PARTY_NOTICES.md" >&2
    exit 1
  fi
  cmp -s "$SRC_MD" "$DIST_MD" || {
    echo "packaged notice drift detected: dist/THIRD_PARTY_NOTICES.md is out of date" >&2
    exit 1
  }
  echo "packaged notice check passed"
  exit 0
fi

mkdir -p "$(dirname "$DIST_MD")"
cp "$SRC_MD" "$DIST_MD"
echo "packaged THIRD_PARTY_NOTICES.md into dist"
