#!/usr/bin/env bash
set -euo pipefail

# Prefix the GPL header to all .ts, .tsx, and .kt files recursively.
# Excludes:
#   - .git directories
#   - any directory named node_modules (and everything beneath it)
#
# Supports --dry-run which only scans and reports what would change.

HEADER=$'/*\n * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network\n * Copyright (C) 2026 Christian Gleissner\n *\n * Licensed under the GNU General Public License v2.0 or later.\n * See <https://www.gnu.org/licenses/> for details.\n */\n\n'

usage() {
  cat <<'EOF'
Usage:
  ./prefix_headers.sh [--dry-run] [--root <dir>]

Options:
  --dry-run   Do not modify files. Only report what would change.
  --root DIR  Root directory to scan (default: current directory).
EOF
}

DRY_RUN=0
ROOT="."

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --root)
      ROOT="${2:-}"
      [[ -n "$ROOT" ]] || { echo "Missing value for --root"; exit 2; }
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 2 ;;
  esac
done

if [[ ! -d "$ROOT" ]]; then
  echo "Root directory does not exist: $ROOT"
  exit 2
fi

has_header() {
  local file="$1"
  head -n 5 "$file" | grep -Fq \
    "C64 Commander - Configure and control your Commodore 64 Ultimate over your local network"
}

prefix_header() {
  local file="$1"

  if has_header "$file"; then
    return 0
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "WOULD ADD: $file"
    return 0
  fi

  local tmp="${file}.header_tmp.$$"
  {
    printf '%s' "$HEADER"
    cat "$file"
  } >"$tmp"
  mv "$tmp" "$file"
  echo "ADDED: $file"
}

# Collect matching files, pruning .git and node_modules entirely
mapfile -d '' FILES < <(
  find "$ROOT" \
    \( -type d -name .git -o -type d -name node_modules \) -prune -o \
    -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.kt" \) -print0
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No matching files found under: $ROOT"
  exit 0
fi

echo "Scanned ${#FILES[@]} file(s) under: $ROOT (excluding .git and node_modules)"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run mode: no files will be modified."
fi

for f in "${FILES[@]}"; do
  [[ -f "$f" && -r "$f" ]] || continue
  prefix_header "$f"
done

