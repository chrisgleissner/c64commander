#!/usr/bin/env bash
# End-to-end harness for scripts/verify-android-apk-lzma2.sh.
#
# The script prefers apkanalyzer and falls back to scanning classes*.dex with
# `strings` when the Android cmdline-tools are absent. These cases run the real
# script with ANDROID_HOME pointed at an empty directory, so they exercise that
# fallback rather than a copy of it.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/verify-android-apk-lzma2.sh"
PASS=0
FAIL=0

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
EMPTY_SDK="$WORK_DIR/sdk"
mkdir -p "$EMPTY_SDK"

LZMA_CLASS="Lorg/tukaani/xz/LZMA2Options;"
SEVENZ_CLASS="Lorg/apache/commons/compress/archivers/sevenz/SevenZFile;"

make_apk() {
  local apk_path="$1"
  shift
  python3 - "$apk_path" "$@" <<'PY'
import sys
import zipfile

apk_path = sys.argv[1]
entries = sys.argv[2:]
with zipfile.ZipFile(apk_path, "w") as apk:
    for index in range(0, len(entries), 2):
        apk.writestr(entries[index], entries[index + 1])
PY
}

run_script() {
  ANDROID_HOME="$EMPTY_SDK" ANDROID_SDK_ROOT="$EMPTY_SDK" bash "$SCRIPT" "$@" >/dev/null 2>&1
}

assert_exit() {
  local test_name="$1"
  local expected="$2"
  shift 2
  run_script "$@"
  local actual=$?
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS: $test_name (exit=$actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name (expected exit=$expected, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "verify-android-apk-lzma2 regression tests"

PADDING="padding to keep the entry long enough for strings"

make_apk "$WORK_DIR/complete.apk" "classes.dex" "dex035 $LZMA_CLASS $SEVENZ_CLASS $PADDING"
assert_exit "accepts an APK carrying both runtime classes when apkanalyzer is absent" 0 "$WORK_DIR/complete.apk"

make_apk "$WORK_DIR/split.apk" "classes.dex" "dex035 $LZMA_CLASS $PADDING" "classes2.dex" "dex035 $SEVENZ_CLASS $PADDING"
assert_exit "scans every classes*.dex entry, not only the first" 0 "$WORK_DIR/split.apk"

make_apk "$WORK_DIR/no-lzma.apk" "classes.dex" "dex035 $SEVENZ_CLASS $PADDING"
assert_exit "rejects an APK missing the LZMA2 options class" 1 "$WORK_DIR/no-lzma.apk"

make_apk "$WORK_DIR/no-sevenz.apk" "classes.dex" "dex035 $LZMA_CLASS $PADDING"
assert_exit "rejects an APK missing the SevenZFile class" 1 "$WORK_DIR/no-sevenz.apk"

make_apk "$WORK_DIR/no-dex.apk" "AndroidManifest.xml" "not a dex entry"
assert_exit "rejects an APK with no classes*.dex entries" 1 "$WORK_DIR/no-dex.apk"

# A pipeline reader that short-circuits kills its writer with SIGPIPE, and `set -o pipefail`
# then reports the whole pipeline as failed even though the reader matched. Both cases below
# put the needle at the start of a producer's output and follow it with more than one pipe
# buffer, so `grep -q` exits while the producer is still writing.
BIG_APK="$WORK_DIR/keeps-writing.apk"
python3 - "$BIG_APK" "$LZMA_CLASS" "$SEVENZ_CLASS" <<'PY'
import sys
import zipfile

apk_path, lzma_class, sevenz_class = sys.argv[1:4]
lines = ["dex035 %s %s padding" % (lzma_class, sevenz_class)]
lines += ["filler_line_long_enough_for_strings_%06d" % index for index in range(40000)]
with zipfile.ZipFile(apk_path, "w") as apk:
    apk.writestr("classes.dex", "\n".join(lines))
PY
assert_exit "accepts an APK whose classes.dex keeps writing after the match" 0 "$BIG_APK"

assert_exit "rejects a missing APK path" 1 "$WORK_DIR/does-not-exist.apk"

assert_exit "rejects an invocation with no APK arguments" 1

# The apkanalyzer branch is preferred when the cmdline-tools are installed. These cases stub it
# so both its verdicts are covered without an Android SDK on the runner.
STUB_SDK="$WORK_DIR/stub-sdk"
mkdir -p "$STUB_SDK/cmdline-tools/latest/bin"
STUB_APKANALYZER="$STUB_SDK/cmdline-tools/latest/bin/apkanalyzer"

run_with_stub_sdk() {
  ANDROID_HOME="$STUB_SDK" ANDROID_SDK_ROOT="$STUB_SDK" bash "$SCRIPT" "$@" >/dev/null 2>&1
}

assert_stub_exit() {
  local test_name="$1"
  local expected="$2"
  shift 2
  run_with_stub_sdk "$@"
  local actual=$?
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS: $test_name (exit=$actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name (expected exit=$expected, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

make_apk "$WORK_DIR/opaque.apk" "classes.dex" "dex035 no readable class names here $PADDING"

cat > "$STUB_APKANALYZER" <<'STUB'
#!/usr/bin/env bash
echo "org.tukaani.xz.LZMA2Options"
echo "org.apache.commons.compress.archivers.sevenz.SevenZFile"
STUB
chmod +x "$STUB_APKANALYZER"
assert_stub_exit "accepts an APK apkanalyzer reports both classes for" 0 "$WORK_DIR/opaque.apk"

cat > "$STUB_APKANALYZER" <<'STUB'
#!/usr/bin/env bash
echo "org.example.Unrelated"
STUB
chmod +x "$STUB_APKANALYZER"
assert_stub_exit "rejects an APK apkanalyzer reports no runtime classes for" 1 "$WORK_DIR/complete.apk"

cat > "$STUB_APKANALYZER" <<'STUB'
#!/usr/bin/env bash
echo "org.tukaani.xz.LZMA2Options"
echo "org.apache.commons.compress.archivers.sevenz.SevenZFile"
seq 1 40000 | sed 's/^/org.example.filler.package/'
STUB
chmod +x "$STUB_APKANALYZER"
assert_stub_exit "accepts an APK apkanalyzer keeps listing packages for after the match" 0 "$WORK_DIR/opaque.apk"

echo
echo "Passed: $PASS"
echo "Failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
