#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 7 ]]; then
  echo "usage: $0 <ndk-dir> <work-dir> <output-dir> <source-url> <source-sha256> <api-level> <abi> [<abi>...]" >&2
  exit 1
fi

NDK_DIR="$1"
WORK_DIR="$2"
OUTPUT_DIR="$3"
SOURCE_URL="$4"
SOURCE_SHA256="$5"
API_LEVEL="$6"
shift 6
ABIS=("$@")

TOOLCHAIN="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin"
CACHE_DIR="$WORK_DIR/cache"
SRC_ROOT="$WORK_DIR/src"
ARCHIVE_NAME="$(basename "$SOURCE_URL")"
ARCHIVE_PATH="$CACHE_DIR/$ARCHIVE_NAME"
EXTRACT_DIR="$SRC_ROOT/7zip"

mkdir -p "$CACHE_DIR" "$SRC_ROOT" "$OUTPUT_DIR"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  curl -L --fail --output "$ARCHIVE_PATH" "$SOURCE_URL"
fi

ACTUAL_SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$SOURCE_SHA256" ]]; then
  echo "7-Zip source checksum mismatch: expected $SOURCE_SHA256 got $ACTUAL_SHA256" >&2
  exit 1
fi

STAMP_PATH="$EXTRACT_DIR/.source-sha256"
if [[ ! -d "$EXTRACT_DIR" || ! -f "$STAMP_PATH" || "$(cat "$STAMP_PATH")" != "$SOURCE_SHA256" ]]; then
  rm -rf "$EXTRACT_DIR"
  mkdir -p "$EXTRACT_DIR"
  tar -xf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
  printf '%s' "$SOURCE_SHA256" > "$STAMP_PATH"
fi

sed -i -e 's/-Werror//' "$EXTRACT_DIR/CPP/7zip/7zip_gcc.mak"

resolve_compiler_prefix() {
  case "$1" in
    arm64-v8a) echo "aarch64-linux-android${API_LEVEL}" ;;
    armeabi-v7a) echo "armv7a-linux-androideabi${API_LEVEL}" ;;
    x86) echo "i686-linux-android${API_LEVEL}" ;;
    x86_64) echo "x86_64-linux-android${API_LEVEL}" ;;
    *)
      echo "Unsupported ABI: $1" >&2
      exit 1
      ;;
  esac
}

BUILD_DIR="$EXTRACT_DIR/CPP/7zip/Bundles/Alone2"
COMMON_WARN_FLAGS="-Wno-sign-conversion -Wno-implicit-int-conversion -Wno-shorten-64-to-32"

for ABI in "${ABIS[@]}"; do
  PREFIX="$(resolve_compiler_prefix "$ABI")"
  CC="$TOOLCHAIN/${PREFIX}-clang"
  CXX="$TOOLCHAIN/${PREFIX}-clang++"
  OUT_DIR="b/${ABI//-/_}_android"
  rm -rf "$BUILD_DIR/$OUT_DIR"
  mkdir -p "$BUILD_DIR/$OUT_DIR"
  make -C "$BUILD_DIR" \
    O="$OUT_DIR" \
    CC="$CC -fPIC -D_GNU_SOURCE $COMMON_WARN_FLAGS" \
    CXX="$CXX -fPIC -D_GNU_SOURCE -static-libstdc++ $COMMON_WARN_FLAGS" \
    LIB2="-ldl" \
    DISABLE_RAR=1 \
    --file ../../cmpl_clang.mak \
    --jobs "$(nproc)"

  mkdir -p "$OUTPUT_DIR/$ABI"
  cp "$BUILD_DIR/$OUT_DIR/7zz" "$OUTPUT_DIR/$ABI/lib7zz.so"
  chmod 755 "$OUTPUT_DIR/$ABI/lib7zz.so"
done
