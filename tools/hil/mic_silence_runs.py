#!/usr/bin/env python3
"""List the stretches of a microphone recording where the in-band level sits at the room's noise floor.

`mic_dropout_scan.py` looks for fast collapses between loud passages, which is what a buffer underrun
looks like. A stall that lasts tens of seconds is not that: the level falls once and stays down, so it
passes the edge test. On a recording of an hour of real tunes that scan reported no candidates while
two stretches of 38 s and 53 s were at the noise floor.

This tool reports every run of seconds below a level relative to the recording's own loudness, so it
finds long silences and says where they are. Real tunes contain silent passages, so a run is evidence
to compare against the music. With a constant-tone tune (`make_dropout_probe_sid.py`) any run is a fault.

Usage:
  mic_silence_runs.py FILE [--min-seconds 3] [--below-db 30] [--start-offset 0]

Exit status 1 when at least one run is found, so it can gate a run.
"""
from __future__ import annotations

import argparse
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfiltfilt

SPEAKER_BAND = (300.0, 6000.0)


def per_second_levels_db(samples: np.ndarray, rate: int) -> np.ndarray:
    sos = butter(4, SPEAKER_BAND, btype="band", fs=rate, output="sos")
    band = sosfiltfilt(sos, samples)
    seconds = len(band) // rate
    levels = np.empty(seconds)
    for index in range(seconds):
        chunk = band[index * rate : (index + 1) * rate]
        levels[index] = 20 * np.log10(np.sqrt(np.mean(chunk**2)) + 1e-9)
    return levels


def silent_runs(levels: np.ndarray, below_db: float, min_seconds: int) -> list[tuple[int, int]]:
    reference = float(np.percentile(levels, 90))
    quiet = levels < reference - below_db
    runs: list[tuple[int, int]] = []
    index = 0
    while index < len(quiet):
        if not quiet[index]:
            index += 1
            continue
        end = index
        while end < len(quiet) and quiet[end]:
            end += 1
        if end - index >= min_seconds:
            runs.append((index, end - index))
        index = end
    return runs


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path) as wav:
        if wav.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit samples, got {8 * wav.getsampwidth()}-bit")
        rate = wav.getframerate()
        channels = wav.getnchannels()
        data = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(float) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file")
    parser.add_argument("--min-seconds", type=int, default=3)
    parser.add_argument("--below-db", type=float, default=30.0, help="how far under the recording's p90 level counts as silent")
    parser.add_argument("--start-offset", type=int, default=0, help="seconds to ignore at the start (before playback began)")
    args = parser.parse_args()

    samples, rate = read_wav(args.file)
    levels = per_second_levels_db(samples, rate)
    runs = [(start, length) for start, length in silent_runs(levels, args.below_db, args.min_seconds) if start >= args.start_offset]
    print(f"{args.file}: {len(levels)} s, p90 {np.percentile(levels, 90):.1f} dBFS, {len(runs)} silent run(s) of {args.min_seconds} s or more")
    for start, length in runs:
        print(f"  {start:6d} s  for {length:4d} s")
    return 1 if runs else 0


if __name__ == "__main__":
    sys.exit(main())
