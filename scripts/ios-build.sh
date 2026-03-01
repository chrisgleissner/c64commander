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

cd ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk "$sdk" -derivedDataPath build CODE_SIGNING_ALLOWED=NO
