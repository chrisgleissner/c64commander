#!/usr/bin/env bash
set -euo pipefail

# Creates a synthetic archive that mimics HVSC_Update_84.7z's codec structure:
# - Solid = +
# - Blocks = 3
# - Methods include PPMD:o11:mem28, PPMD:o11:mem16, and BCJ2+LZMA:d=9m
#
# Output:
#   android/app/src/test/fixtures/HVSC_Update_mock.7z

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="$ROOT_DIR/android/app/src/test/fixtures"
WORK_DIR="$ROOT_DIR/.tmp/hvsc_fixture_work"
CONTENT_DIR="$WORK_DIR/content"

ARCHIVE_NAME="HVSC_Update_mock.7z"
ARCHIVE_PATH="$FIXTURES_DIR/$ARCHIVE_NAME"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing required command: $1" >&2
    exit 1
  }
}

require_cmd 7z
require_cmd python3

mkdir -p "$FIXTURES_DIR"
rm -rf "$WORK_DIR"
mkdir -p "$CONTENT_DIR"

# ---------------------------------------------------------------------------
# 1) Create HVSC-like folder structure
# ---------------------------------------------------------------------------
mkdir -p "$CONTENT_DIR/update/DOCUMENTS/Update_Announcements"
mkdir -p "$CONTENT_DIR/update/fix/MUSICIANS/A/Adrock_and_Deadeye"
mkdir -p "$CONTENT_DIR/update/fix/MUSICIANS/B/Bjerregaard_Johannes"

# ---------------------------------------------------------------------------
# 2) Text-heavy files for PPMD
# ---------------------------------------------------------------------------
python3 - <<'PY' "$CONTENT_DIR/update/DOCUMENTS/BUGlist.txt"
import sys
p = sys.argv[1]
lines = []
for i in range(30000):
    lines.append(
        f"ERROR [HVSC] Entry {i:06d}: synthetic repetitive text for PPMD testing "
        f"HVSC HVSC HVSC Update_84 PPMD Solid BCJ2 LZMA\n"
    )
with open(p, "w", encoding="utf-8") as f:
    f.writelines(lines)
PY

python3 - <<'PY' "$CONTENT_DIR/update/DOCUMENTS/Update_Announcements/20251225.txt"
import sys
p = sys.argv[1]
with open(p, "w", encoding="utf-8") as f:
    for i in range(12000):
        f.write(f"Announcement {i}: synthetic HVSC fixture exercising PPMD\n")
PY

python3 - <<'PY' "$CONTENT_DIR/update/DOCUMENTS/Songlengths.txt"
import sys
p = sys.argv[1]
with open(p, "w", encoding="utf-8") as f:
  f.write("/MUSICIANS/A/Adrock_and_Deadeye/James_Bond.sid=0:32\n")
  f.write("/MUSICIANS/B/Bjerregaard_Johannes/Cute_Tune.sid=1:05\n")
PY

python3 - <<'PY' "$CONTENT_DIR/update/DOCUMENTS/Delete_files.txt"
import sys
p = sys.argv[1]
with open(p, "w", encoding="utf-8") as f:
  f.write("/MUSICIANS/B/Bjerregaard_Johannes/Old_Tune.sid\n")
  f.write("/MUSICIANS/B/Bjerregaard_Johannes/Gone.sid\n")
PY

python3 - <<'PY' "$CONTENT_DIR/readme.1st"
import sys
p = sys.argv[1]
with open(p, "w", encoding="utf-8") as f:
    f.write("Synthetic HVSC fixture archive.\n")
    f.write("PPMD + BCJ2 + LZMA, solid, 3 blocks.\n")
PY

# ---------------------------------------------------------------------------
# 3) Binary payloads for BCJ2 + LZMA (FORCED ≥ 12 MiB EACH)
# ---------------------------------------------------------------------------

python3 - <<'PY' "$CONTENT_DIR/update/fix/MUSICIANS/A/Adrock_and_Deadeye/James_Bond.sid"
import sys
size = 12 * 1024 * 1024
buf = bytearray()
while len(buf) < size:
  buf += b"\xE8\x01\x00\x00\x00"  # CALL rel32
  buf += b"\x90\x90\x90"          # NOPs
with open(sys.argv[1], "wb") as f:
  f.write(buf[:size])
PY

python3 - <<'PY' "$CONTENT_DIR/update/fix/MUSICIANS/B/Bjerregaard_Johannes/Cute_Tune.sid"
import sys
size = 12 * 1024 * 1024
with open(sys.argv[1], "wb") as f:
  f.write(b"CUTE_TUNE_X86_" * (size // 14))
PY

python3 - <<'PY' "$CONTENT_DIR/update/fix/MUSICIANS/B/Bjerregaard_Johannes/Fat_6.sid"
import sys, random
size = 12 * 1024 * 1024
random.seed(6006)
buf = bytearray(random.getrandbits(8) for _ in range(size))
for i in range(0, size, 4096):
  buf[i:i+8] = b"FAT_6___"
with open(sys.argv[1], "wb") as f:
  f.write(buf)
PY

# ---------------------------------------------------------------------------
# 4) Build archive in 3 passes to force 3 blocks
# ---------------------------------------------------------------------------

rm -f "$ARCHIVE_PATH"
pushd "$CONTENT_DIR" >/dev/null

# Block 0: PPMD mem28 (force its own solid block)
7z a -t7z -mx=9 -ms=32m \
  -m0=PPMd:o=11:mem=28m \
  "$ARCHIVE_PATH" \
  update/DOCUMENTS/BUGlist.txt \
  update/DOCUMENTS/Update_Announcements/20251225.txt

# Block 1: PPMD mem16 (force new block by solid reset)
7z u -t7z -mx=9 -ms=8m \
  -m0=PPMd:o=11:mem=16m \
  "$ARCHIVE_PATH" \
  readme.1st \
  update/DOCUMENTS/Songlengths.txt \
  update/DOCUMENTS/Delete_files.txt

# Block 2: BCJ2 + LZMA:9m (forced separate solid block)
7z u -t7z -mx=9 -ms=64m \
  -m0=BCJ2 \
  -m1=LZMA:d=9m \
  "$ARCHIVE_PATH" \
  update/fix/MUSICIANS/A/Adrock_and_Deadeye/James_Bond.sid \
  update/fix/MUSICIANS/B/Bjerregaard_Johannes/Cute_Tune.sid \
  update/fix/MUSICIANS/B/Bjerregaard_Johannes/Fat_6.sid

popd >/dev/null

# ---------------------------------------------------------------------------
# 5) Verify structure
# ---------------------------------------------------------------------------
echo "Created: $ARCHIVE_PATH"
echo
7z l -slt "$ARCHIVE_PATH" | grep -E '^(Method|Solid|Blocks)'
