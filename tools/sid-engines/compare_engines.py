#!/usr/bin/env python3
"""Compare renders of one tune by several SID engines.

The engines cannot be compared sample by sample. reSIDfp in libsidplayfp-wasm and libSidplayEZ
share an emulator ancestry but differ in analogue tuning and in start-up handling, and SIDLite is a
different emulation altogether. So each render is reduced to properties a listener hears, and those
are compared against a reference render (reSIDfp):

  start_offset_ms   lag that best aligns the two loudness envelopes (positive: later than the
                    reference). A large offset means the tune starts at a different point.
  level_db          difference in RMS level after a 60 Hz high-pass (a DC step from gating the
                    SID would otherwise dominate the reading).
  envelope_corr     Pearson correlation of the aligned dB envelopes (10 ms frames). Low values
                    mean notes start, stop or swell at different times.
  chroma_sim        mean cosine similarity of aligned 12-bin chroma vectors. Low values mean
                    different notes are being played.
  band_db_mae       mean absolute difference of third-octave band levels, 63 Hz-12.5 kHz, after
                    removing the overall level difference: the spectral balance (timbre).
  stereo_corr       L/R correlation of each render, so a mono render where the reference is
                    stereo (or the reverse) shows up.
  frames            sample frames rendered, which must match exactly.

Everything is computed after aligning by start_offset_ms, over the overlapping span.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import asdict, dataclass

import numpy as np

FRAME_SECONDS = 0.010
HIGHPASS_HZ = 60.0
THIRD_OCTAVE_CENTRES = [63 * 2 ** (i / 3) for i in range(0, 24)]
MAX_LAG_SECONDS = 1.0
SILENCE_DBFS = -70.0


def load_raw(path: str, channels: int = 2) -> np.ndarray:
    data = np.fromfile(path, dtype="<i2").astype(np.float64) / 32768.0
    return data.reshape(-1, channels)


def highpass(x: np.ndarray, rate: int, fc: float = HIGHPASS_HZ) -> np.ndarray:
    """Second-order Butterworth high-pass, direct form, no SciPy dependency."""
    w = math.tan(math.pi * fc / rate)
    k = 1.0 / (1.0 + math.sqrt(2.0) * w + w * w)
    b0, b1, b2 = k, -2.0 * k, k
    a1 = 2.0 * (w * w - 1.0) * k
    a2 = (1.0 - math.sqrt(2.0) * w + w * w) * k
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, xi in enumerate(x):
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, xi, y1, yi
        y[i] = yi
    return y


def highpass_fast(x: np.ndarray, rate: int) -> np.ndarray:
    try:
        from scipy.signal import butter, sosfilt  # type: ignore

        return sosfilt(butter(2, HIGHPASS_HZ, btype="highpass", fs=rate, output="sos"), x)
    except ImportError:
        return highpass(x, rate)


def envelope_db(mono: np.ndarray, rate: int) -> np.ndarray:
    hop = int(rate * FRAME_SECONDS)
    n = len(mono) // hop
    frames = mono[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(frames * frames, axis=1)) + 1e-9
    return 20 * np.log10(rms)


def best_lag(ref_env: np.ndarray, env: np.ndarray) -> int:
    max_lag = int(MAX_LAG_SECONDS / FRAME_SECONDS)
    a = np.maximum(ref_env, SILENCE_DBFS) - SILENCE_DBFS
    b = np.maximum(env, SILENCE_DBFS) - SILENCE_DBFS
    best, best_score = 0, -np.inf
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            x, y = a[: len(a) - lag], b[lag:]
        else:
            x, y = a[-lag:], b[: len(b) + lag]
        n = min(len(x), len(y))
        if n < 10:
            continue
        x, y = x[:n] - x[:n].mean(), y[:n] - y[:n].mean()
        denom = np.sqrt((x * x).sum() * (y * y).sum())
        score = (x * y).sum() / denom if denom > 0 else -np.inf
        if score > best_score:
            best, best_score = lag, score
    return best


def chroma(mono: np.ndarray, rate: int, window: int = 8192, hop: int = 4800) -> np.ndarray:
    freqs = np.fft.rfftfreq(window, 1.0 / rate)
    valid = (freqs > 50) & (freqs < 5000)
    pitch_class = np.round(12 * np.log2(freqs[valid] / 440.0)).astype(int) % 12
    win = np.hanning(window)
    rows = []
    for start in range(0, len(mono) - window, hop):
        spectrum = np.abs(np.fft.rfft(mono[start : start + window] * win))[valid] ** 2
        bins = np.bincount(pitch_class, weights=spectrum, minlength=12)
        rows.append(bins)
    return np.array(rows) if rows else np.zeros((0, 12))


def band_levels_db(mono: np.ndarray, rate: int) -> np.ndarray:
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    freqs = np.fft.rfftfreq(len(mono), 1.0 / rate)
    out = []
    for centre in THIRD_OCTAVE_CENTRES:
        lo, hi = centre / 2 ** (1 / 6), centre * 2 ** (1 / 6)
        sel = (freqs >= lo) & (freqs < hi)
        out.append(10 * np.log10(spectrum[sel].sum() + 1e-20))
    return np.array(out)


@dataclass
class Comparison:
    engine: str
    reference: str
    frames: int
    reference_frames: int
    start_offset_ms: float
    level_db: float
    envelope_corr: float
    chroma_sim: float
    band_db_mae: float
    stereo_corr: float
    reference_stereo_corr: float
    silent: bool


def stereo_correlation(stereo: np.ndarray) -> float:
    l, r = stereo[:, 0] - stereo[:, 0].mean(), stereo[:, 1] - stereo[:, 1].mean()
    denom = math.sqrt(float((l * l).sum() * (r * r).sum()))
    return float((l * r).sum() / denom) if denom > 0 else 1.0


def compare(reference: np.ndarray, render: np.ndarray, rate: int, engine: str, reference_name: str) -> Comparison:
    ref_mono = highpass_fast(reference.mean(axis=1), rate)
    mono = highpass_fast(render.mean(axis=1), rate)
    ref_env, env = envelope_db(ref_mono, rate), envelope_db(mono, rate)
    lag = best_lag(ref_env, env)
    hop = int(rate * FRAME_SECONDS)
    shift = lag * hop
    if shift >= 0:
        a, b = ref_mono[: len(ref_mono) - shift], mono[shift:]
        ea, eb = ref_env[: len(ref_env) - lag], env[lag:]
    else:
        a, b = ref_mono[-shift:], mono[: len(mono) + shift]
        ea, eb = ref_env[-lag:], env[: len(env) + lag]
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    m = min(len(ea), len(eb))
    ea, eb = np.maximum(ea[:m], SILENCE_DBFS), np.maximum(eb[:m], SILENCE_DBFS)
    env_corr = float(np.corrcoef(ea, eb)[0, 1]) if ea.std() > 0 and eb.std() > 0 else 1.0
    rms_a = math.sqrt(float(np.mean(a * a))) + 1e-12
    rms_b = math.sqrt(float(np.mean(b * b))) + 1e-12
    ca, cb = chroma(a, rate), chroma(b, rate)
    k = min(len(ca), len(cb))
    if k:
        dots = (ca[:k] * cb[:k]).sum(axis=1)
        norms = np.linalg.norm(ca[:k], axis=1) * np.linalg.norm(cb[:k], axis=1)
        loud = norms > 0
        chroma_sim = float(np.mean(dots[loud] / norms[loud])) if loud.any() else 1.0
    else:
        chroma_sim = 1.0
    bands_a, bands_b = band_levels_db(a, rate), band_levels_db(b, rate)
    offset = np.median(bands_b - bands_a)
    audible = bands_a > bands_a.max() - 60
    band_mae = float(np.mean(np.abs(bands_b - bands_a - offset)[audible])) if audible.any() else 0.0
    return Comparison(
        engine=engine,
        reference=reference_name,
        frames=len(render),
        reference_frames=len(reference),
        start_offset_ms=lag * FRAME_SECONDS * 1000,
        level_db=20 * math.log10(rms_b / rms_a),
        envelope_corr=env_corr,
        chroma_sim=chroma_sim,
        band_db_mae=band_mae,
        stereo_corr=stereo_correlation(render),
        reference_stereo_corr=stereo_correlation(reference),
        silent=20 * math.log10(rms_b) < SILENCE_DBFS,
    )


def main(argv: list[str]) -> int:
    if len(argv) < 5:
        print("usage: compare_engines.py <rate> <reference-name>=<ref.raw> <name>=<render.raw>...", file=sys.stderr)
        return 2
    rate = int(argv[1])
    ref_name, ref_path = argv[2].split("=", 1)
    reference = load_raw(ref_path)
    results = []
    for item in argv[3:]:
        name, path = item.split("=", 1)
        results.append(asdict(compare(reference, load_raw(path), rate, name, ref_name)))
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
