#!/usr/bin/env bash
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
#
# Licensed under the GNU General Public License v3.0 or later.
# See <https://www.gnu.org/licenses/> for details.
#
# Live View frame-progression measurement (the c64stream "record the stream + analyze frame
# progression" approach, adapted for the on-device app). The native StreamUdp plugin logs one
# per-second progression line to logcat:
#
#   StreamUdpPlugin: progression name=video mode=assembled fps=50.1 pkts/s=3406 dropped=0
#
# This captures those lines for a window, writes them to a CSV, and prints a min/avg/max fps
# summary — so a before/after (native assembly on vs off) comparison is a single number.
#
# Usage:
#   scripts/measure-live-view-fps.sh [seconds] [device-id]
#
# Prerequisites: the app is streaming Live View video (video toggle on, connected to a device).
# Toggle "Fast video (native assembly)" in Settings → streams to A/B the two paths.

set -euo pipefail

SECONDS_TO_CAPTURE="${1:-20}"
DEVICE_ID="${2:-}"
ADB=(adb)
if [[ -n "$DEVICE_ID" ]]; then ADB=(adb -s "$DEVICE_ID"); fi

TAG="StreamUdpPlugin"
OUT_DIR="${OUT_DIR:-artifacts/live-view-fps}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
CSV="$OUT_DIR/progression_$STAMP.csv"
RAW="$OUT_DIR/progression_$STAMP.log"

echo "Capturing $SECONDS_TO_CAPTURE s of '$TAG' progression from device ${DEVICE_ID:-<auto>} ..."
"${ADB[@]}" logcat -c || true
timeout "$SECONDS_TO_CAPTURE" "${ADB[@]}" logcat -s "$TAG:I" > "$RAW" 2>/dev/null || true

echo "elapsed_index,name,mode,fps,pkts_per_s,dropped,lost" > "$CSV"
awk '
  /progression / {
    name=""; mode=""; fps=""; pkts=""; dropped=""; lost="";
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^name=/)    { sub(/^name=/, "", $i); name = $i }
      if ($i ~ /^mode=/)    { sub(/^mode=/, "", $i); mode = $i }
      if ($i ~ /^fps=/)     { sub(/^fps=/, "", $i); fps = $i }
      if ($i ~ /^pkts\/s=/) { sub(/^pkts\/s=/, "", $i); pkts = $i }
      if ($i ~ /^dropped=/) { sub(/^dropped=/, "", $i); dropped = $i }
      if ($i ~ /^lost=/)    { sub(/^lost=/, "", $i); lost = $i }
    }
    if (fps != "") { printf "%d,%s,%s,%s,%s,%s,%s\n", ++n, name, mode, fps, pkts, dropped, lost }
  }
' "$RAW" >> "$CSV"

echo "Wrote $CSV"
echo
awk -F, 'NR>1 && $2=="video" {
  c++; sum+=$4; if (min=="" || $4<min) min=$4; if ($4>max) max=$4;
  psum+=$5; d=$6; l=$7;
}
END {
  if (c==0) { print "No video progression samples captured. Is Live View video streaming?"; exit 0 }
  printf "video frame-progression over %d samples:\n", c;
  printf "  fps     min=%.1f avg=%.1f max=%.1f\n", min, sum/c, max;
  printf "  pkts/s  avg=%.0f\n", psum/c;
  printf "  dropped (cumulative packets, last sample)=%s\n", d;
  printf "  lost    (cumulative FRAMES, last sample)=%s\n", l;
}' "$CSV"
