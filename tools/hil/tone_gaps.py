#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
"""List every gap in a recording of constant-level tones, and match them to known tune changes.

The recording holds two steady tones played one after the other. Any stretch where the in-band level
falls well below the tone's own level is a gap, whichever tone is playing, so a gap at a tune change
can be measured to the frame instead of to the second (`mic_silence_runs.py` works in whole seconds).

Level is the 300-6000 Hz band in 20 ms frames, as in the other graders. A frame is absent when it sits
more than --below-db under the recording's 90th percentile. Gaps shorter than --min-ms are ignored.

Usage:
  tone_gaps.py FILE [--below-db 15] [--min-ms 60] [--changes 25.0,50.0,...] [--window 4] [--json]

--changes are the times, in seconds from the start of the recording, at which the app was told to
change tune. For each one the report names the longest gap starting within --window seconds after it.
"""
from __future__ import annotations

import argparse
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SPEAKER_BAND = (300.0, 6000.0)
FRAME_SECONDS = 0.02


def read_mono(path: str) -> tuple[int, np.ndarray]:
    with wave.open(path) as wav:
        if wav.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit samples, got {8 * wav.getsampwidth()}-bit")
        rate, channels = wav.getframerate(), wav.getnchannels()
        data = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(float) / 32768.0
    return rate, data.reshape(-1, channels).mean(axis=1) if channels > 1 else data


def frame_levels_db(samples: np.ndarray, rate: int) -> np.ndarray:
    band = sosfilt(butter(4, SPEAKER_BAND, btype="band", fs=rate, output="sos"), samples)
    size = int(rate * FRAME_SECONDS)
    count = len(band) // size
    frames = band[: count * size].reshape(count, size)
    return 20 * np.log10(np.sqrt(np.mean(frames**2, axis=1)) + 1e-9)


def find_gaps(levels: np.ndarray, below_db: float, min_ms: float) -> list[tuple[float, float]]:
    """(start_seconds, length_ms) of every run of absent frames at least `min_ms` long."""
    absent = levels < float(np.percentile(levels, 90)) - below_db
    gaps: list[tuple[float, float]] = []
    index = 0
    while index < len(absent):
        if not absent[index]:
            index += 1
            continue
        end = index
        while end < len(absent) and absent[end]:
            end += 1
        length_ms = (end - index) * FRAME_SECONDS * 1000
        if length_ms >= min_ms:
            gaps.append((index * FRAME_SECONDS, length_ms))
        index = end
    return gaps


def gap_after_each_change(gaps: list[tuple[float, float]], changes: list[float], window: float) -> list[dict]:
    report = []
    for change in changes:
        inside = [gap for gap in gaps if change <= gap[0] < change + window]
        longest = max(inside, key=lambda gap: gap[1], default=None)
        report.append({"change_s": change, "gap_ms": round(longest[1]) if longest else 0,
                       "gap_at_s": round(longest[0], 2) if longest else None})
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file")
    parser.add_argument("--below-db", type=float, default=15.0)
    parser.add_argument("--min-ms", type=float, default=60.0)
    parser.add_argument("--changes", default="")
    parser.add_argument("--window", type=float, default=4.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    rate, samples = read_mono(args.file)
    levels = frame_levels_db(samples, rate)
    gaps = find_gaps(levels, args.below_db, args.min_ms)
    changes = [float(value) for value in args.changes.split(",") if value]
    per_change = gap_after_each_change(gaps, changes, args.window)
    matched = {entry["gap_at_s"] for entry in per_change if entry["gap_at_s"] is not None}
    result = {
        "seconds": round(len(levels) * FRAME_SECONDS, 1),
        "p90_dbfs": round(float(np.percentile(levels, 90)), 1),
        "gaps": len(gaps),
        "longest_gap_ms": round(max((gap[1] for gap in gaps), default=0)),
        "gaps_away_from_a_change": [{"at_s": round(s, 2), "ms": round(ms)} for s, ms in gaps if round(s, 2) not in matched
                                    and not any(c <= s < c + args.window for c in changes)],
        "after_each_change": per_change,
    }
    print(json.dumps(result, indent=1) if args.json else json.dumps(result))
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
