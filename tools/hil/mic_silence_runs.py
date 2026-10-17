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
from scipy.signal import butter, sosfilt, sosfilt_zi

SPEAKER_BAND = (300.0, 6000.0)


BLOCK_SECONDS = 60


def stream_levels_db(blocks, rate: int) -> np.ndarray:
    """Per-second band-limited level of consecutive sample blocks, each a whole number of seconds long.

    The filter state carries across blocks, so a four-hour recording is processed without holding it
    in memory. Causal filtering is enough here: only the level per second matters, not the phase.
    """
    sos = butter(4, SPEAKER_BAND, btype="band", fs=rate, output="sos")
    state = None
    levels: list[float] = []
    for block in blocks:
        if state is None:
            state = (sosfilt_zi(sos) * block[0], sosfilt_zi(sos) * block[0])
        band, first_state = sosfilt(sos, block, zi=state[0])
        band, second_state = sosfilt(sos, band, zi=state[1])
        state = (first_state, second_state)
        for index in range(len(band) // rate):
            chunk = band[index * rate : (index + 1) * rate]
            levels.append(20 * np.log10(np.sqrt(np.mean(chunk**2)) + 1e-9))
    return np.array(levels)


def per_second_levels_db(samples: np.ndarray, rate: int) -> np.ndarray:
    step = BLOCK_SECONDS * rate
    return stream_levels_db((samples[start : start + step] for start in range(0, len(samples), step)), rate)


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


def read_wav_blocks(path: str):
    """Yield (rate, blocks): mono float blocks of BLOCK_SECONDS seconds, the last one possibly shorter."""
    wav = wave.open(path)
    if wav.getsampwidth() != 2:
        width = 8 * wav.getsampwidth()
        wav.close()
        raise ValueError(f"{path}: expected 16-bit samples, got {width}-bit")
    rate = wav.getframerate()
    channels = wav.getnchannels()

    def blocks():
        try:
            while True:
                raw = wav.readframes(BLOCK_SECONDS * rate)
                if not raw:
                    return
                data = np.frombuffer(raw, dtype=np.int16).astype(float) / 32768.0
                yield data.reshape(-1, channels).mean(axis=1) if channels > 1 else data
        finally:
            wav.close()

    return rate, blocks()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file")
    parser.add_argument("--min-seconds", type=int, default=3)
    parser.add_argument("--below-db", type=float, default=30.0, help="how far under the recording's p90 level counts as silent")
    parser.add_argument("--start-offset", type=int, default=0, help="seconds to ignore at the start (before playback began)")
    args = parser.parse_args()

    rate, blocks = read_wav_blocks(args.file)
    levels = stream_levels_db(blocks, rate)
    runs = [(start, length) for start, length in silent_runs(levels, args.below_db, args.min_seconds) if start >= args.start_offset]
    print(f"{args.file}: {len(levels)} s, p90 {np.percentile(levels, 90):.1f} dBFS, {len(runs)} silent run(s) of {args.min_seconds} s or more")
    for start, length in runs:
        print(f"  {start:6d} s  for {length:4d} s")
    return 1 if runs else 0


if __name__ == "__main__":
    sys.exit(main())
