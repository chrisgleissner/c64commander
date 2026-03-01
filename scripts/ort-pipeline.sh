#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORT_IMAGE="${ORT_IMAGE:-ghcr.io/oss-review-toolkit/ort:80.0.0}"
ORT_OUT_DIR="${ORT_OUT_DIR:-$ROOT_DIR/.tmp/ort}"
DOCKER_USER="${ORT_DOCKER_USER:-0:0}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for ORT compliance checks" >&2
  exit 1
fi

mkdir -p "$ORT_OUT_DIR"

echo "[ort] analyze"
docker run --rm -u "$DOCKER_USER" -v "$ROOT_DIR:/project" -w /project "$ORT_IMAGE" analyze \
  -i /project \
  -o "/project/${ORT_OUT_DIR#$ROOT_DIR/}" \
  -f YAML

ANALYZER_RESULT="$ORT_OUT_DIR/analyzer-result.yml"
if [[ ! -f "$ANALYZER_RESULT" ]]; then
  echo "missing analyzer result: $ANALYZER_RESULT" >&2
  exit 1
fi

echo "[ort] scan"
docker run --rm -u "$DOCKER_USER" -v "$ROOT_DIR:/project" -w /project "$ORT_IMAGE" scan \
  -i "/project/${ANALYZER_RESULT#$ROOT_DIR/}" \
  -o "/project/${ORT_OUT_DIR#$ROOT_DIR/}" \
  -f YAML

SCAN_RESULT="$ORT_OUT_DIR/scan-result.yml"
if [[ ! -f "$SCAN_RESULT" ]]; then
  echo "missing scan result: $SCAN_RESULT" >&2
  exit 1
fi

echo "[ort] evaluate"
docker run --rm -u "$DOCKER_USER" -v "$ROOT_DIR:/project" -w /project "$ORT_IMAGE" evaluate \
  -i "/project/${SCAN_RESULT#$ROOT_DIR/}" \
  -o "/project/${ORT_OUT_DIR#$ROOT_DIR/}" \
  -f YAML \
  -r /project/.ort/evaluator.rules.kts \
  --license-classifications-file=/project/.ort/license-classifications.yml \
  --resolutions-file=/project/.ort/resolutions.yml

EVALUATION_RESULT="$ORT_OUT_DIR/evaluation-result.yml"
if [[ ! -f "$EVALUATION_RESULT" ]]; then
  echo "missing evaluation result: $EVALUATION_RESULT" >&2
  exit 1
fi

echo "[ort] report"
docker run --rm -u "$DOCKER_USER" -v "$ROOT_DIR:/project" -w /project "$ORT_IMAGE" report \
  -i "/project/${EVALUATION_RESULT#$ROOT_DIR/}" \
  -o "/project/${ORT_OUT_DIR#$ROOT_DIR/}" \
  -f PlainTextTemplate \
  -O PlainTextTemplate=template.id=NOTICE_DEFAULT

NOTICE_FILE="$ORT_OUT_DIR/NOTICE_DEFAULT"
if [[ ! -f "$NOTICE_FILE" ]]; then
  echo "missing ORT notice output: $NOTICE_FILE" >&2
  exit 1
fi

echo "[ort] done -> $NOTICE_FILE"
