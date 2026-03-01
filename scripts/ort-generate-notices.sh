#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORT_OUT_DIR="${ORT_OUT_DIR:-$ROOT_DIR/.tmp/ort}"

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

bash "$ROOT_DIR/scripts/ort-pipeline.sh"

NOTICE_INPUT="$ORT_OUT_DIR/NOTICE_DEFAULT"
if [[ ! -f "$NOTICE_INPUT" ]]; then
  echo "ORT notice template output is missing: $NOTICE_INPUT" >&2
  exit 1
fi

TMP_DIR="$ROOT_DIR/.tmp/ort-generated"
mkdir -p "$TMP_DIR"

TXT_OUT="$TMP_DIR/THIRD_PARTY_NOTICES.txt"
MD_OUT="$TMP_DIR/THIRD_PARTY_NOTICES.md"

sed -e 's/\r$//' "$NOTICE_INPUT" > "$TXT_OUT"

{
  echo "# Third-Party Notices"
  echo
  echo "This file is generated from ORT (${ORT_IMAGE:-ghcr.io/oss-review-toolkit/ort:80.0.0}) PlainTextTemplate (template id: NOTICE_DEFAULT)."
  echo
  cat "$TXT_OUT"
} > "$MD_OUT"

ROOT_TXT="$ROOT_DIR/THIRD_PARTY_NOTICES.txt"
ROOT_MD="$ROOT_DIR/THIRD_PARTY_NOTICES.md"

if [[ "$CHECK_ONLY" == "1" ]]; then
  cmp -s "$TXT_OUT" "$ROOT_TXT" || {
    echo "notice drift detected: THIRD_PARTY_NOTICES.txt is out of date" >&2
    exit 1
  }
  cmp -s "$MD_OUT" "$ROOT_MD" || {
    echo "notice drift detected: THIRD_PARTY_NOTICES.md is out of date" >&2
    exit 1
  }
  echo "notice drift check passed"
  exit 0
fi

cp "$TXT_OUT" "$ROOT_TXT"
cp "$MD_OUT" "$ROOT_MD"

echo "updated notices:"
echo "- $ROOT_TXT"
echo "- $ROOT_MD"
