#!/usr/bin/env bash
# resolve-version.sh — Deterministic Git-based version resolution
#
# Computes the app version and writes it to src/version.ts.
#
# Version format:
#   Clean repo  → <tag>
#   Dirty repo  → <tag>-<5-char-lowercase-hex-SHA>
#
# Dirty = any uncommitted change (staged or unstaged) to tracked files.
# Untracked and gitignored files are excluded by construction.
#
# Exits non-zero if:
#   - No git tag exists
#   - src/version.ts is tracked by git

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Guard: src/version.ts must not be tracked
if git ls-files --error-unmatch "src/version.ts" >/dev/null 2>&1; then
  echo "ERROR: src/version.ts is tracked by git." >&2
  echo "Remove it from tracking first: git rm --cached src/version.ts" >&2
  exit 1
fi

# Fetch tags safely — non-fatal if offline or in a shallow clone
git fetch --tags --quiet 2>/dev/null || true

# Resolve latest tag
TAG="$(git describe --tags --abbrev=0 2>/dev/null)" || true

# If no tag was found, try to deepen a shallow clone and retry
if [[ -z "$TAG" ]] && [[ "$(git rev-parse --is-shallow-repository 2>/dev/null)" == "true" ]]; then
  git fetch --unshallow --tags --quiet 2>/dev/null || true
  TAG="$(git describe --tags --abbrev=0 2>/dev/null)" || true
fi

# Fallback: if still no tag, use package.json version
if [[ -z "$TAG" ]] && [[ -f "package.json" ]]; then
  TAG="$(node -e "console.log(require('./package.json').version || '')" 2>/dev/null)" || true
fi

if [[ -z "$TAG" ]]; then
  echo "ERROR: No git tag found. Create a tag before building: git tag <version>" >&2
  exit 1
fi

# Validate tag: only allow safe characters to prevent injection into TypeScript
if [[ ! "$TAG" =~ ^[0-9A-Za-z._-]+$ ]]; then
  echo "ERROR: Git tag '${TAG}' contains unsafe characters. Only [0-9A-Za-z._-] are allowed." >&2
  exit 1
fi

# Resolve 5-character short SHA
SHA="$(git rev-parse --short=5 HEAD)"

# Detect dirty state: staged + unstaged changes to tracked files only.
# Untracked files are excluded because git diff HEAD does not consider them.
if git diff --quiet HEAD --; then
  VERSION="${TAG}"
else
  VERSION="${TAG}-${SHA}"
fi

# Validate format before writing
if [[ ! "$VERSION" =~ ^[^[:space:]]+(-[0-9a-f]{5})?$ ]]; then
  echo "ERROR: Computed version '${VERSION}' does not match expected format." >&2
  exit 1
fi

# Write src/version.ts
VERSION_TS_PATH="${REPO_ROOT}/src/version.ts"
cat > "$VERSION_TS_PATH" <<EOF
export const APP_VERSION = '${VERSION}';
EOF

echo "$VERSION"
