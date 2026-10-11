#!/usr/bin/env bash
#
# Builds libc64sidplayez.so: the pinned libSidplayEZ engine plus this app's JNI wrapper
# (android/app/src/main/cpp/sidplayez), one shared library per ABI.
#
# Same principles as build-upstream-7zip.sh: a pinned source archive verified by SHA-256, explicit
# flags, a stamp that skips the build when nothing changed, and 16 KB page alignment.
#
#   android <ndk-dir> <work-dir> <output-dir> <source-url> <source-sha256> <revision> <api-level> <abi>...
#   host    <work-dir> <output-dir> <source-url> <source-sha256> <revision> [<jdk-home>]
#
# `host` builds the same library for the build machine (for the JVM tests) and the C++ test
# program, the latter also with AddressSanitizer/UBSan and with ThreadSanitizer.
set -euo pipefail

MODE="${1:-}"
shift || true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_DIR="$(cd "$HERE/../app/src/main/cpp/sidplayez" && pwd)"
# This app's amendments to libSidplayEZ, applied in name order to the verified archive. Each is
# described in THIRD_PARTY_NOTICES.md.
PATCH_DIR="$WRAPPER_DIR/patches"

usage() {
  sed -n '6,12p' "${BASH_SOURCE[0]}" >&2
  exit 1
}

fetch_source() {
  local work="$1" url="$2" sha="$3" revision="$4"
  local cache="$work/cache" archive="$work/cache/libSidplayEZ-$revision.tar.gz"
  SRC_DIR="$work/src/libSidplayEZ-$revision"
  mkdir -p "$cache" "$work/src"
  if [[ ! -f "$archive" ]]; then
    curl -L --fail --retry 5 --retry-delay 10 --connect-timeout 60 --max-time 300 --output "$archive.part" "$url"
    mv "$archive.part" "$archive"
  fi
  local actual
  actual="$(sha256sum "$archive" | awk '{print $1}')"
  if [[ "$actual" != "$sha" ]]; then
    echo "libSidplayEZ source checksum mismatch: expected $sha got $actual" >&2
    rm -f "$archive"
    exit 1
  fi
  # The extracted tree is keyed by the archive and the patches, so a changed patch re-extracts.
  local tree_key
  tree_key="$(printf '%s\n' "$sha"; cat "$PATCH_DIR"/*.patch | sha256sum | awk '{print $1}')"
  if [[ ! -f "$SRC_DIR/.source-sha256" || "$(cat "$SRC_DIR/.source-sha256")" != "$tree_key" ]]; then
    rm -rf "$SRC_DIR"
    mkdir -p "$SRC_DIR"
    tar -xzf "$archive" -C "$SRC_DIR" --strip-components=1
    local patch_file
    for patch_file in "$PATCH_DIR"/*.patch; do
      patch -d "$SRC_DIR" -p1 --batch --forward --silent < "$patch_file"
    done
    printf '%s' "$tree_key" > "$SRC_DIR/.source-sha256"
  fi
  # The app packages copies of the license and credit files (android/app/src/main/nativeLicenses).
  # They must be this revision's, so a revision bump that changes them fails the build.
  local copies="$WRAPPER_DIR/../../nativeLicenses/public/licenses/libsidplayez" pair
  for pair in COPYING:COPYING AUTHORS:AUTHORS README.md:README.md src/sidplayfp/residfp/AUTHORS:residfp-AUTHORS; do
    if ! cmp -s "$SRC_DIR/${pair%%:*}" "$copies/${pair##*:}"; then
      echo "libSidplayEZ's ${pair%%:*} differs from the packaged copy $copies/${pair##*:}; update the copy" >&2
      exit 1
    fi
  done
}

# The engine sources: everything under src/ except the ultraSID application layer (src/EZ/*.cpp:
# chip profiles chosen by file path, sidid, digi selection), which this app does not use. Only
# EZ/config.h is needed, and it is header-only.
engine_sources() {
  (cd "$SRC_DIR/src" && find . -name '*.cpp' -not -path './EZ/*' | LC_ALL=C sort | sed 's#^\./##')
}

COMMON_CXXFLAGS=(-std=c++2b -fPIC -DNDEBUG -fvisibility=hidden -fvisibility-inlines-hidden
  -ffunction-sections -fdata-sections -fno-math-errno -w)

# compile <cxx> <obj-dir> <engine-flags...> -- <baseline-flags...>
compile_all() {
  local cxx="$1" obj="$2"
  shift 2
  local engine_flags=() baseline_flags=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do engine_flags+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  baseline_flags=("$@")
  mkdir -p "$obj"
  local prefix_map=(-ffile-prefix-map="$SRC_DIR"=libSidplayEZ -ffile-prefix-map="$WRAPPER_DIR"=sidplayez)
  local jobs=()
  while read -r file; do
    local out="$obj/$(sed 's#/#_#g; s#\.cpp$#.o#' <<<"$file")"
    jobs+=("$cxx ${COMMON_CXXFLAGS[*]} ${engine_flags[*]} ${prefix_map[*]} -I$SRC_DIR/src -c $SRC_DIR/src/$file -o $out")
  done < <(engine_sources)
  jobs+=("$cxx ${COMMON_CXXFLAGS[*]} ${engine_flags[*]} ${prefix_map[*]} -I$SRC_DIR/src -c $WRAPPER_DIR/ez_session.cpp -o $obj/wrapper_ez_session.o")
  jobs+=("$cxx ${COMMON_CXXFLAGS[*]} ${baseline_flags[*]} ${prefix_map[*]} -DC64C_SIDPLAYEZ_REVISION=$REVISION -c $WRAPPER_DIR/cpu_check.cpp -o $obj/wrapper_cpu_check.o")
  if [[ "${SKIP_JNI:-0}" != 1 ]]; then
    jobs+=("$cxx ${COMMON_CXXFLAGS[*]} ${baseline_flags[*]} ${prefix_map[*]} ${JNI_INCLUDES[*]:-} -c $WRAPPER_DIR/sidplayez_jni.cpp -o $obj/wrapper_jni.o")
  fi
  printf '%s\n' "${jobs[@]}" | xargs -P"$(nproc)" -I{} sh -c '{}'
}

link_shared() {
  local cxx="$1" obj="$2" out="$3"
  shift 3
  # Sorted so the link order, and therefore the output, does not depend on the file system.
  local objects
  objects="$(find "$obj" -name '*.o' -not -name 'test_*' | LC_ALL=C sort)"
  # shellcheck disable=SC2086
  "$cxx" -shared -o "$out" $objects "$@" -Wl,--gc-sections -Wl,--exclude-libs,ALL -Wl,--build-id=sha1 \
    -Wl,-soname,libc64sidplayez.so
}

case "$MODE" in
android)
  [[ $# -ge 8 ]] || usage
  NDK_DIR="$1" WORK_DIR="$2" OUTPUT_DIR="$3" SOURCE_URL="$4" SOURCE_SHA256="$5" REVISION="$6" API_LEVEL="$7"
  shift 7
  ABIS=("$@")
  TOOLCHAIN="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin"
  PAGE_FLAGS=(-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384)
  STAMP_CONTENT="$(
    {
      printf '%s\n' "$SOURCE_SHA256" "$REVISION" "$API_LEVEL" "${COMMON_CXXFLAGS[*]}" "${PAGE_FLAGS[*]}"
      "$TOOLCHAIN/clang" --version | head -n 1
      sha256sum "${BASH_SOURCE[0]}" "$WRAPPER_DIR"/*.cpp "$WRAPPER_DIR"/*.h "$PATCH_DIR"/*.patch | awk '{print $1}'
    } | sha256sum | awk '{print $1}'
  )"
  STAMP="$OUTPUT_DIR/.libsidplayez-build-config-sha256"
  all_exist=true
  for ABI in "${ABIS[@]}"; do [[ -f "$OUTPUT_DIR/$ABI/libc64sidplayez.so" ]] || all_exist=false; done
  if [[ "$all_exist" == true && -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_CONTENT" ]]; then
    echo "libSidplayEZ outputs already exist for the current build config, skipping build."
    exit 0
  fi
  # Removed before building, so an interrupted or failed build can never leave libraries from one
  # configuration under the stamp of another.
  rm -f "$STAMP"
  fetch_source "$WORK_DIR" "$SOURCE_URL" "$SOURCE_SHA256" "$REVISION"
  JNI_INCLUDES=()
  for ABI in "${ABIS[@]}"; do
    case "$ABI" in
    arm64-v8a) TRIPLE="aarch64-linux-android$API_LEVEL" ENGINE_ARCH=() ;;
    armeabi-v7a) TRIPLE="armv7a-linux-androideabi$API_LEVEL" ENGINE_ARCH=(-mfpu=neon) ;;
    # The Android x86_64 ABI guarantees SSE4.2, which the engine's resampler kernel needs.
    x86_64) TRIPLE="x86_64-linux-android$API_LEVEL" ENGINE_ARCH=(-msse4.2) ;;
    # The 32-bit x86 ABI only guarantees SSSE3. The engine is built with SSE4.1 and the JNI layer
    # refuses to create a session on a CPU without it (cpu_check.cpp), so it is never executed there.
    x86) TRIPLE="i686-linux-android$API_LEVEL" ENGINE_ARCH=(-msse4.1) ;;
    *) echo "Unsupported ABI: $ABI" >&2; exit 1 ;;
    esac
    CXX="$TOOLCHAIN/$TRIPLE-clang++"
    OBJ="$WORK_DIR/obj/$ABI"
    rm -rf "$OBJ"
    compile_all "$CXX" "$OBJ" -O3 "${ENGINE_ARCH[@]}" -- -O2
    mkdir -p "$OUTPUT_DIR/$ABI"
    link_shared "$CXX" "$OBJ" "$OUTPUT_DIR/$ABI/libc64sidplayez.so" -static-libstdc++ "${PAGE_FLAGS[@]}"
    "$TOOLCHAIN/llvm-strip" --strip-unneeded "$OUTPUT_DIR/$ABI/libc64sidplayez.so"
  done
  printf '%s' "$STAMP_CONTENT" > "$STAMP"
  ;;
host)
  [[ $# -ge 5 ]] || usage
  WORK_DIR="$1" OUTPUT_DIR="$2" SOURCE_URL="$3" SOURCE_SHA256="$4" REVISION="$5" JDK_HOME="${6:-${JAVA_HOME:-}}"
  CXX="${HOST_CXX:-clang++-18}"
  command -v "$CXX" >/dev/null || CXX=clang++
  fetch_source "$WORK_DIR" "$SOURCE_URL" "$SOURCE_SHA256" "$REVISION"
  # Every link takes all objects in its directory, so an object from a source file that a revision
  # removed must not survive from a previous build.
  rm -rf "${WORK_DIR:?}/obj"
  JNI_INCLUDES=()
  if [[ -n "$JDK_HOME" && -f "$JDK_HOME/include/jni.h" ]]; then
    JNI_INCLUDES=(-I"$JDK_HOME/include" -I"$JDK_HOME/include/linux")
  fi
  mkdir -p "$OUTPUT_DIR"
  HOST_ARCH=()
  [[ "$(uname -m)" == x86_64 ]] && HOST_ARCH=(-msse4.2)
  if [[ ${#JNI_INCLUDES[@]} -gt 0 ]]; then
    compile_all "$CXX" "$WORK_DIR/obj/host" -O2 "${HOST_ARCH[@]}" -- -O2
    link_shared "$CXX" "$WORK_DIR/obj/host" "$OUTPUT_DIR/libc64sidplayez.so" -lpthread
  else
    echo "No JDK headers found (pass <jdk-home> or set JAVA_HOME); skipping the host JNI library." >&2
  fi
  TEST_SRC="$WRAPPER_DIR/tests/ez_session_test.cpp"
  SKIP_JNI=1 compile_all "$CXX" "$WORK_DIR/obj/render" -O2 "${HOST_ARCH[@]}" -- -O2
  render_objects="$(find "$WORK_DIR/obj/render" -name '*.o' | LC_ALL=C sort)"
  # shellcheck disable=SC2086
  "$CXX" -std=c++2b -O2 "${HOST_ARCH[@]}" -I"$WRAPPER_DIR" -o "$OUTPUT_DIR/ez_render" \
    "$WRAPPER_DIR/tests/ez_render.cpp" $render_objects -lpthread
  for SAN in none address thread; do
    case "$SAN" in
    none) SAN_FLAGS=() ;;
    address) SAN_FLAGS=(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined) ;;
    thread) SAN_FLAGS=(-fsanitize=thread) ;;
    esac
    OBJ="$WORK_DIR/obj/test-$SAN"
    SKIP_JNI=1 compile_all "$CXX" "$OBJ" -O1 -g "${HOST_ARCH[@]}" "${SAN_FLAGS[@]}" -- -O1 -g "${SAN_FLAGS[@]}"
    objects="$(find "$OBJ" -name '*.o' -not -name 'test_*' | LC_ALL=C sort)"
    # shellcheck disable=SC2086
    "$CXX" -std=c++2b -O1 -g "${HOST_ARCH[@]}" "${SAN_FLAGS[@]}" -I"$WRAPPER_DIR" -o "$OUTPUT_DIR/ez_session_test-$SAN" \
      "$TEST_SRC" $objects -lpthread
    # The engine suite is single-threaded, so ThreadSanitizer adds nothing to it; the wrapper suite
    # above is the one that runs players concurrently.
    if [[ "$SAN" != thread ]]; then
      # shellcheck disable=SC2086
      "$CXX" -std=c++2b -O1 -g -w "${HOST_ARCH[@]}" "${SAN_FLAGS[@]}" -I"$SRC_DIR/src" -o "$OUTPUT_DIR/engine_test-$SAN" \
        "$WRAPPER_DIR/tests/engine_test.cpp" $objects -lpthread
    fi
  done
  ;;
*)
  usage
  ;;
esac
