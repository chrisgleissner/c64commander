#!/usr/bin/env python3
"""Compare what actually comes out of the phone on the two playback paths.

The engine renders and the wire capture both stop short of the speaker, so neither can settle a
complaint about how the phone *sounds*. Everything after the PCM — gain staging, the WebAudio
chunk scheduler on the local path, the native AudioPipeline on the mirror path, AudioTrack, the
speaker itself — is invisible to them.

This records the same tune twice through the same microphone in the same room, minutes apart,
switching only the listen target. The room, the speaker and the mic are then common to both
recordings and cancel when the two are compared against each other.

Level is reported but NOT normalised away: if one path is simply quieter, that is a finding, and
loudness is most of what "rich and full" versus "tinny" means.

Usage:
  local_vs_mirror_mic.py --seconds 15 --out-dir /tmp/mic
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

# Where a phone speaker actually works. Below this it reproduces almost nothing, so energy down
# there says nothing about what a listener hears — see the analyser traps in audio_e2e_probe.py.
BANDS = [(120, 300), (300, 700), (700, 1500), (1500, 3000), (3000, 6000), (6000, 12000)]
SPEAKER_BAND = (300, 6000)


def record(path: Path, seconds: float, rate: int = 48000) -> np.ndarray:
    subprocess.run(
        ["arecord", "-q", "-f", "S16_LE", "-r", str(rate), "-c", "1", "-d", str(int(seconds)), str(path)],
        check=True,
    )
    with wave.open(str(path), "rb") as handle:
        return np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float64)


def analyse(samples: np.ndarray, rate: int) -> dict:
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples)))) ** 2
    freqs = np.fft.rfftfreq(len(samples), 1.0 / rate)
    speaker = spectrum[(freqs >= SPEAKER_BAND[0]) & (freqs < SPEAKER_BAND[1])]
    total = float(np.sum(speaker)) or 1.0
    shares = {}
    for lo, hi in BANDS:
        band = spectrum[(freqs >= lo) & (freqs < hi)]
        shares[f"{lo}-{hi}"] = 100.0 * float(np.sum(band)) / total
    # Loudness in the band the speaker reproduces, which is what a listener judges.
    band_rms = float(np.sqrt(np.sum(speaker) / len(samples)))
    return {"shares": shares, "speaker_db": 20.0 * np.log10(band_rms + 1e-9), "peak": float(np.max(np.abs(samples)))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seconds", type=float, default=15.0)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--label", default="capture")
    parser.add_argument("--rate", type=int, default=48000)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    path = args.out_dir / f"{args.label}.wav"
    samples = record(path, args.seconds, args.rate)
    stats = analyse(samples, args.rate)

    print(f"{args.label}: peak {stats['peak']:.0f}, level in 300-6000 Hz {stats['speaker_db']:+.1f} dB")
    for band, share in stats["shares"].items():
        print(f"  {band:>10} Hz  {share:6.2f}%")
    if stats["peak"] < 200:
        print("  (near the noise floor — is anything playing?)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
