#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "sim" && "${1:-}" != "device" ]]; then
  echo "usage: bash scripts/ios-build.sh [sim|device]" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS local builds require macOS and Xcode. Use the macOS CI lane for iOS build validation." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not available. Install Xcode command-line tools on macOS." >&2
  exit 1
fi

sdk="iphoneos"
if [[ "$1" == "sim" ]]; then
  sdk="iphonesimulator"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_VERSION_VALUE="${APP_VERSION:-$(node "$REPO_ROOT/scripts/resolve-build-version.mjs")}"
APP_BUILD_NUMBER_VALUE="${APP_BUILD_NUMBER:-$(git -C "$REPO_ROOT" rev-list --count HEAD 2>/dev/null || printf '1')}"

cd ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk "$sdk" -derivedDataPath build MARKETING_VERSION="$APP_VERSION_VALUE" CURRENT_PROJECT_VERSION="$APP_BUILD_NUMBER_VALUE" CODE_SIGNING_ALLOWED=NO
