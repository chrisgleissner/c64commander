"""The av-latency instrument must say which correlation peak it took, and offer one that cannot slip.

The barcode stimulus has the same broadband envelope in every 239.4 ms slot, so a broadband
envelope correlation has a peak per slot. These cases put a known delay into a synthetic barcode
and check that the per-tone correlation finds that delay with a single clear peak, and that the
broadband curve's neighbouring peaks really are whole slots away — the shape a bimodal 264 / 741 ms
reading would have if it were the instrument rather than the app.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio_e2e_probe import ON_MS, SLOT_MS, TONES_HZ  # noqa: E402
from mirror_audio_latency_hil import (  # noqa: E402
    bandpass,
    correlate_valid,
    envelope,
    lag_curve,
    tone_lag_curve,
    top_peaks,
)

RATE = 48000
MAX_LAG = int(RATE * 0.8)


def barcode(seconds: float, gains: list[float] | None = None) -> np.ndarray:
    slot = RATE * SLOT_MS / 1000
    on = int(RATE * ON_MS / 1000)
    out = np.zeros(int(RATE * seconds))
    t = np.arange(on) / RATE
    index = 0
    while int(index * slot) + on < len(out):
        tone = index % len(TONES_HZ)
        gain = 1.0 if gains is None else gains[tone]
        start = int(index * slot)
        out[start : start + on] = 8000 * gain * np.sin(2 * np.pi * TONES_HZ[tone] * t)
        index += 1
    return out


def delayed(signal: np.ndarray, delay_ms: float, gains_noise: float = 30.0, seed: int = 3) -> np.ndarray:
    shift = int(RATE * delay_ms / 1000)
    out = np.concatenate([np.zeros(shift), signal])[: len(signal)]
    return out + np.random.default_rng(seed).normal(0, gains_noise, len(out))


def lag_ms(index: int) -> float:
    return index * 1000.0 / RATE


def test_fft_correlation_matches_numpy_correlate():
    rng = np.random.default_rng(1)
    signal, template = rng.normal(size=500), rng.normal(size=380)
    assert np.allclose(correlate_valid(signal, template), np.correlate(signal, template, mode="valid"))


@pytest.mark.parametrize("delay", [264.0, 742.0])
def test_per_tone_correlation_finds_the_delay_with_one_clear_peak(delay):
    wire = barcode(8.0)
    mic = delayed(wire, delay)
    curve = tone_lag_curve(wire, mic, RATE, MAX_LAG)
    peaks = top_peaks(curve, RATE)
    assert lag_ms(peaks[0][0]) == pytest.approx(delay, abs=3)
    assert len(peaks) == 1 or peaks[1][1] < 0.5 * peaks[0][1]


def test_broadband_peaks_repeat_every_slot_and_are_nearly_equal():
    wire = barcode(8.0)
    mic = delayed(wire, 264.0)
    curve = lag_curve(envelope(bandpass(wire, RATE), RATE), envelope(bandpass(mic, RATE), RATE), MAX_LAG)
    peaks = top_peaks(curve, RATE)
    assert len(peaks) == 3
    lags = sorted(lag_ms(index) for index, _ in peaks)
    for left, right in zip(lags, lags[1:]):
        assert (right - left) == pytest.approx(SLOT_MS, abs=5)
    assert any(lag == pytest.approx(264.0, abs=3) for lag in lags)
    strengths = [value for _, value in peaks]
    assert min(strengths) > 0.85 * max(strengths)


def test_per_tone_lag_survives_a_speaker_that_favours_some_tones():
    """Uneven per-tone loudness is what lets broadband pick a slot at all; per-tone must not care."""
    gains = [0.2, 1.0, 0.3, 0.9, 0.25, 1.0, 0.4, 0.8]
    wire = barcode(8.0)
    mic = delayed(barcode(8.0, gains), 500.0)
    curve = tone_lag_curve(wire, mic, RATE, MAX_LAG)
    assert lag_ms(int(np.argmax(curve))) == pytest.approx(500.0, abs=3)


def test_top_peaks_keeps_peaks_apart():
    curve = np.zeros(1000)
    curve[100], curve[102], curve[500], curve[900] = 1.0, 0.99, 0.8, 0.6
    peaks = top_peaks(curve, rate=1000, count=3, separation_ms=50)
    assert [index for index, _ in peaks] == [100, 500, 900]
