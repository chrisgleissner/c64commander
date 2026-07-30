#!/usr/bin/env python3
"""Look for playback dropouts in a microphone recording of the phone's speaker.

What this detects, precisely: the signal collapsing to the room's noise floor and recovering, with
edges too abrupt to be a musical event. That is what a buffer underrun looks like from outside — the
pipeline has nothing to hand the speaker, so the speaker emits nothing.

What it does NOT detect, and must not be read as excluding:

  * **A stall that repeats audio.** If the pipeline re-plays the buffer it already has, the level
    never drops, so no level-domain detector can see it. This repo has already learned that the hard
    way (see AGENTS.md, "Detectors that do NOT work here").
  * **Glitches shorter than roughly one analysis hop**, here 5 ms, and anything a room microphone
    smears below the noise floor.
  * **The difference between a dropout and a genuine gap between tracks.** Both are silence; the
    report gives each candidate's position and duration so a track change can be recognised rather
    than silently filtered out.

Musical rests are the obvious false positive, and a bare threshold produces them freely: a SID tune's
release envelope decays to nothing many times a minute. The discriminator is the *edge*. A note's
release falls over tens of milliseconds; a pipeline that stops handing over samples falls within one
hop. So a candidate has to fall fast, stay down, and come back fast.

The analysis is band-limited to 300-6000 Hz and this is not optional. The room's noise is almost all
rumble below 300 Hz, which a phone speaker barely reproduces, so a broadband reading judges the
signal against noise it is not actually competing with: the same recording measured 11-17 dB SNR
broadband and 43-49 dB in-band, and the broadband pass produced 17 dropout candidates per file where
the band-limited pass produced 1. Sixteen of those seventeen were the floor, not the music.

Usage:
  mic_dropout_scan.py FILE [FILE ...] [--floor-dbfs -73] [--min-gap-ms 10] [--max-edge-ms 15]
"""
from __future__ import annotations

import argparse
import wave

import numpy as np
from scipy.signal import butter, sosfiltfilt

HOP_MS = 5.0
FULL_SCALE = 32768.0

# The band a phone speaker actually reproduces. The room's noise is almost all desk and fan rumble
# below 300 Hz, which the speaker barely emits, so a broadband RMS reads a ~-41 dBFS floor while the
# floor in this band is ~-73 dBFS. Judging signal-to-noise broadband understates it by more than
# 30 dB and makes a perfectly usable recording look hopeless.
BAND_LOW_HZ = 300.0
BAND_HIGH_HZ = 6000.0

# Band-limited room floor, measured 4 mm from a Pixel 4 grille in silence.
DEFAULT_FLOOR_DBFS = -73.0


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())
    if width != 2:
        raise SystemExit(f"{path}: expected 16-bit audio, got {width * 8}-bit")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples / FULL_SCALE, rate


def band_limit(samples: np.ndarray, rate: int) -> np.ndarray:
    """Keep only the band the phone speaker reproduces.

    Mandatory, not polish. Two separate reasons: a DC step through the speaker's own blocker rings
    for the best part of a second and reads as signal to an unweighted RMS (which is why ITU-R
    BS.1770 starts with a high pass), and the room's noise floor lives almost entirely below the
    speaker's usable range, so leaving it in buries the signal under noise that is not competing
    with it acoustically at all.
    """
    nyquist = rate / 2.0
    high = min(BAND_HIGH_HZ, nyquist * 0.99)
    sos = butter(4, [BAND_LOW_HZ / nyquist, high / nyquist], btype="bandpass", output="sos")
    return sosfiltfilt(sos, samples).astype(np.float32)


def envelope_dbfs(samples: np.ndarray, rate: int, hop_ms: float = HOP_MS) -> np.ndarray:
    hop = max(1, int(rate * hop_ms / 1000.0))
    usable = (len(samples) // hop) * hop
    frames = samples[:usable].reshape(-1, hop)
    rms = np.sqrt((frames.astype(np.float64) ** 2).mean(axis=1))
    return 20.0 * np.log10(np.maximum(rms, 1e-9))


def scan(path: str, floor_dbfs: float, min_gap_ms: float, max_edge_ms: float) -> dict:
    samples, rate = read_wav(path)
    filtered = band_limit(samples, rate)
    env = envelope_dbfs(filtered, rate)
    if env.size == 0:
        raise SystemExit(f"{path}: recording too short to analyse")

    signal_dbfs = float(np.percentile(env, 90))
    median_dbfs = float(np.median(env))
    quiet_dbfs = float(np.percentile(env, 5))
    snr_db = signal_dbfs - floor_dbfs

    # "Down" means indistinguishable from the room. 3 dB above the measured floor is deliberately
    # tight: anything looser starts catching quiet passages, which are music, not dropouts.
    down = env <= floor_dbfs + 3.0
    hop_ms = HOP_MS
    min_frames = max(1, int(round(min_gap_ms / hop_ms)))
    edge_frames = max(1, int(round(max_edge_ms / hop_ms)))

    candidates = []
    index = 0
    while index < len(down):
        if not down[index]:
            index += 1
            continue
        start = index
        while index < len(down) and down[index]:
            index += 1
        end = index
        if end - start < min_frames:
            continue
        # An underrun truncates; a release decays. Look at how many frames the level took to fall
        # into the gap and to climb out of it, and require both to be fast.
        before = env[max(0, start - edge_frames) : start]
        after = env[end : end + edge_frames]
        if before.size == 0 or after.size == 0:
            continue  # clipped by the recording boundary — not attributable
        fell_from = float(before.max())
        rose_to = float(after.max())
        if fell_from < floor_dbfs + 12.0 or rose_to < floor_dbfs + 12.0:
            continue  # it was already quiet either side; a rest, not a cut
        candidates.append(
            {
                "startSeconds": round(start * hop_ms / 1000.0, 3),
                "durationMs": round((end - start) * hop_ms, 1),
                "fellFromDbfs": round(fell_from, 1),
                "roseToDbfs": round(rose_to, 1),
            }
        )

    return {
        "file": path,
        "seconds": round(len(samples) / rate, 1),
        "signalDbfs": round(signal_dbfs, 1),
        "medianDbfs": round(median_dbfs, 1),
        "quietDbfs": round(quiet_dbfs, 1),
        "floorDbfs": floor_dbfs,
        "snrDb": round(snr_db, 1),
        "candidates": candidates,
        "framesBelowFloorPct": round(100.0 * float(down.mean()), 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan a mic recording for playback dropouts")
    parser.add_argument("files", nargs="+")
    parser.add_argument(
        "--floor-dbfs",
        type=float,
        default=DEFAULT_FLOOR_DBFS,
        help="band-limited room noise floor (300-6000 Hz), not a broadband figure",
    )
    parser.add_argument("--min-gap-ms", type=float, default=10.0)
    parser.add_argument("--max-edge-ms", type=float, default=15.0)
    args = parser.parse_args()

    worst_snr = None
    total_candidates = 0
    for path in args.files:
        result = scan(path, args.floor_dbfs, args.min_gap_ms, args.max_edge_ms)
        total_candidates += len(result["candidates"])
        worst_snr = result["snrDb"] if worst_snr is None else min(worst_snr, result["snrDb"])
        print(
            f"{path}: {result['seconds']}s  signal(p90) {result['signalDbfs']} dBFS"
            f"  median {result['medianDbfs']}  quiet(p5) {result['quietDbfs']}"
            f"  SNR {result['snrDb']} dB  below-floor {result['framesBelowFloorPct']}%"
            f"  dropout candidates: {len(result['candidates'])}"
        )
        for candidate in result["candidates"]:
            print(
                f"    t={candidate['startSeconds']}s  {candidate['durationMs']} ms"
                f"  fell from {candidate['fellFromDbfs']} dBFS, rose to {candidate['roseToDbfs']} dBFS"
            )
    if worst_snr is not None and worst_snr < 20.0:
        print(
            f"\nNOTE: worst SNR {worst_snr} dB is under 20 dB. Treat the gap statistics as"
            " corroborating rather than decisive — short dropouts are not separable from quiet"
            " passages at this margin."
        )
    return 1 if total_candidates else 0


if __name__ == "__main__":
    raise SystemExit(main())
