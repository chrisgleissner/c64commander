#!/usr/bin/env python3
"""
Detect audio dropouts in a microphone recording of a phone speaker.

## The mistake this script exists to avoid

A broadband RMS envelope is the obvious way to measure level and it is wrong here. The room's
noise is almost entirely below 300 Hz — desk and fan rumble — while a phone speaker reproduces
essentially nothing down there. Measured with the microphone 4 mm from a Pixel 4 grille, in silence:

    0-120 Hz    -40.8 dBFS      <- the rumble that dominates a broadband reading
    120-300 Hz  -46.7 dBFS
    300-700 Hz  -83.9 dBFS
    3-6 kHz     -77.1 dBFS

So the broadband floor reads -41 dBFS while the floor *in the band the speaker actually uses* is
-73 dBFS. Judging signal-to-noise broadband therefore understates it by more than 30 dB, and led me
to conclude the microphone could not detect a dropout at a comfortable listening volume. It can:
band-limited, at phone volume 10 of 25, the measured spread is about 28 dB.

`tools/hil/local_vs_mirror_mic.py` already band-limits to 300-6000 Hz for exactly this reason.

## What counts as a dropout

Level alone still cannot separate "the audio stopped" from "the tune is quiet here", because SID
music has real rests. Speed can. An underrun is a step: output falls to the floor within about a
buffer period and returns just as abruptly. A musical decay is exponential over tens to hundreds of
milliseconds. So a candidate must show a fast collapse, a fast recovery, loud music either side, and
a duration in the range a dropout occupies.

## What it still misses

A dropout inside an already-quiet passage; one shorter than two frames; and anything at all if the
in-band SNR is poor, which is why the script reports the SNR and refuses when it is too low.
"""

import sys

import numpy as np

RATE = 48_000
FRAME_MS = 5
BAND = (300, 6000)
COLLAPSE_DB = 12.0
EDGE_FRAMES = 2
MIN_GAP_MS, MAX_GAP_MS = 15, 400
CONTEXT_MS = 200
MIN_USABLE_SNR_DB = 12.0


def band_envelope_db(samples: np.ndarray) -> np.ndarray:
    width = RATE * FRAME_MS // 1000
    count = len(samples) // width
    frames = samples[: count * width].reshape(count, width) * np.hanning(width)
    spectrum = np.fft.rfft(frames, axis=1)
    freqs = np.fft.rfftfreq(width, 1 / RATE)
    mask = (freqs >= BAND[0]) & (freqs <= BAND[1])
    energy = np.sqrt((np.abs(spectrum[:, mask]) ** 2).sum(axis=1)) / (width / 2)
    return 20 * np.log10(np.maximum(energy, 1e-9) / 32768)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    samples = np.fromfile(sys.argv[1], dtype="<i2").astype(np.float64)
    floor_db = float(sys.argv[2]) if len(sys.argv) > 2 else -73.3
    env = band_envelope_db(samples)
    if len(env) < 100:
        print("recording too short")
        return 1

    ordered = np.sort(env)
    median = ordered[len(ordered) // 2]
    p95 = ordered[int(len(ordered) * 0.95)]
    print(f"{len(samples) / RATE:.1f}s, {len(env)} frames of {FRAME_MS} ms, band {BAND[0]}-{BAND[1]} Hz")
    print(f"in-band floor {floor_db:.1f} dBFS")
    print(f"median {median:.1f} dBFS (SNR {median - floor_db:.0f} dB), "
          f"p95 {p95:.1f} dBFS (SNR {p95 - floor_db:.0f} dB)")

    if p95 - floor_db < MIN_USABLE_SNR_DB:
        print(f"\nLoud passages are only {p95 - floor_db:.0f} dB above the floor. A collapse cannot be")
        print("measured. NOT REPORTING candidates.")
        return 1

    near_floor = floor_db + 6.0
    loud = floor_db + 12.0
    context = CONTEXT_MS // FRAME_MS
    min_gap, max_gap = MIN_GAP_MS // FRAME_MS, MAX_GAP_MS // FRAME_MS

    found = []
    index = context
    while index < len(env) - context:
        if env[index] > near_floor:
            index += 1
            continue
        start = index
        while index < len(env) and env[index] <= near_floor:
            index += 1
        length = index - start
        if not (min_gap <= length <= max_gap):
            continue
        if start - EDGE_FRAMES < 0 or index + EDGE_FRAMES >= len(env):
            continue
        fall = env[start - EDGE_FRAMES] - env[start]
        rise = env[min(index + EDGE_FRAMES, len(env) - 1)] - env[index - 1]
        if fall < COLLAPSE_DB or rise < COLLAPSE_DB:
            continue
        before = np.median(env[max(0, start - context):start])
        after = np.median(env[index:index + context])
        if before < loud or after < loud:
            continue
        found.append((start * FRAME_MS / 1000, length * FRAME_MS, fall, rise))

    print(f"\n{len(found)} dropout(s):")
    for at, ms, fall, rise in found:
        print(f"   {at:8.3f}s   {ms:4d} ms   fall {fall:.0f} dB   recover {rise:.0f} dB")
    if not found:
        print("   (none)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
