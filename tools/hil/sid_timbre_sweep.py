#!/usr/bin/env python3
"""Find the libsidplayfp settings whose timbre matches the Ultimate's own SID output.

Local playback was reported as "tinny, lacking definition" next to the same tune rendered by
the C64 and streamed over. That is a statement about where the energy sits, so it is settled
by measuring where the energy sits — not by listening and arguing.

The reference is a wire capture of the Ultimate's mirrored audio (`capture_mirror_pcm.py`),
which is the machine's own output before any speaker or room touches it. Each candidate
configuration renders the same tune with `sidplayfp` and is scored on how closely its
long-term spectrum matches.

ALIGNMENT. The capture starts at an arbitrary point in the tune, so a render is slid over it
and the best-matching offset is used. Long-term band energies are fairly stable within a
tune, but not stable enough to skip this: a quiet intro compared against a busy chorus
scores badly for reasons that have nothing to do with the filter.

SCORE. Spectral distance in dB across log-spaced bands, level-normalised. Level is removed
deliberately — the Ultimate's mixer gain is not a property of the SID emulation, and leaving
it in would rank every candidate by volume.

Usage:
  sid_timbre_sweep.py --reference ref.wav --sid /path/to/Tune.sid [--seconds 20]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

# Log-spaced edges from where a SID actually has content up to the top of its range. Fine
# enough to separate a filter change, coarse enough not to chase individual notes.
BAND_EDGES = [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360]


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float64)
    if channels > 1:
        frames = frames.reshape(-1, channels).mean(axis=1)
    return frames, rate


def band_energies(samples: np.ndarray, rate: int) -> np.ndarray:
    """Energy per band in dB, with the overall level removed."""
    if len(samples) < 1024:
        return np.full(len(BAND_EDGES) - 1, -120.0)
    window = np.hanning(len(samples))
    spectrum = np.abs(np.fft.rfft(samples * window)) ** 2
    freqs = np.fft.rfftfreq(len(samples), 1.0 / rate)
    out = []
    for lo, hi in zip(BAND_EDGES, BAND_EDGES[1:]):
        band = spectrum[(freqs >= lo) & (freqs < hi)]
        out.append(10.0 * np.log10(float(np.sum(band)) + 1e-9))
    energies = np.array(out)
    return energies - energies.mean()


def render(sid: Path, seconds: float, args: list[str]) -> tuple[np.ndarray, int]:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "render.wav"
        command = ["sidplayfp", "-q", f"-t{int(seconds)}", f"-w{out}", *args, str(sid)]
        result = subprocess.run(command, capture_output=True, text=True)
        if not out.exists():
            raise RuntimeError(f"sidplayfp produced nothing: {result.stderr.strip()[:300]}")
        return read_wav_mono(out)


def best_match(reference: np.ndarray, ref_rate: int, candidate: np.ndarray, cand_rate: int, seconds: float) -> float:
    """Lowest spectral distance over every plausible offset of the render."""
    ref_band = band_energies(reference, ref_rate)
    width = int(seconds * cand_rate)
    if len(candidate) <= width:
        return float(np.sqrt(np.mean((band_energies(candidate, cand_rate) - ref_band) ** 2)))
    best = float("inf")
    step = max(1, int(0.5 * cand_rate))
    for start in range(0, len(candidate) - width, step):
        window = candidate[start : start + width]
        distance = float(np.sqrt(np.mean((band_energies(window, cand_rate) - ref_band) ** 2)))
        best = min(best, distance)
    return best


# The candidates. `-m` picks the chip model (o=6581, n=8580, trailing f forces it over the
# tune's own declaration); `--fcurve` is the reSIDfp filter curve; `-r` the resampling.
CANDIDATES: list[tuple[str, list[str]]] = [
    ("default (tune's model, auto curve)", []),
    ("6581", ["-mo"]),
    ("6581 forced", ["-mof"]),
    ("8580", ["-mn"]),
    ("8580 forced", ["-mnf"]),
    ("6581 forced, curve 0.0", ["-mof", "--fcurve=0.0"]),
    ("6581 forced, curve 0.5", ["-mof", "--fcurve=0.5"]),
    ("6581 forced, curve 1.0", ["-mof", "--fcurve=1.0"]),
    ("8580 forced, curve 0.0", ["-mnf", "--fcurve=0.0"]),
    ("8580 forced, curve 0.5", ["-mnf", "--fcurve=0.5"]),
    ("8580 forced, curve 1.0", ["-mnf", "--fcurve=1.0"]),
    ("8580 forced, digiboost", ["-mnf", "--digiboost"]),
    ("no filter emulation", ["-nf"]),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--sid", required=True, type=Path)
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument("--render-seconds", type=float, default=90.0)
    args = parser.parse_args()

    reference, ref_rate = read_wav_mono(args.reference)
    reference = reference[: int(args.seconds * ref_rate)]
    ref_band = band_energies(reference, ref_rate)

    print("reference band energies (dB, level removed):")
    for (lo, hi), value in zip(zip(BAND_EDGES, BAND_EDGES[1:]), ref_band):
        print(f"  {lo:>6}-{hi:<6} Hz  {value:+7.2f}")
    print()

    results = []
    for name, extra in CANDIDATES:
        try:
            samples, rate = render(args.sid, args.render_seconds, extra)
        except (RuntimeError, FileNotFoundError) as error:
            print(f"{name:<38} SKIPPED ({error})")
            continue
        score = best_match(reference, ref_rate, samples, rate, args.seconds)
        results.append((score, name))
        print(f"{name:<38} distance {score:6.3f} dB")

    if results:
        results.sort()
        print(f"\nclosest to the Ultimate: {results[0][1]} ({results[0][0]:.3f} dB)")
        print(f"furthest:                {results[-1][1]} ({results[-1][0]:.3f} dB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
