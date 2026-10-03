"""av-latency must report the per-tone lag, and flag a broadband peak in another slot as a warning.

Run 2026-10-02T13-54-22 reported 750 ms (broadband correlation 0.457) while the per-tone lag of the
same capture was 272 ms, and the five other runs that day agreed at 271-284 ms. 750 - 272 = 478 ms is
two barcode slots: the broadband envelope repeats every 239.4 ms and its correlation took a
neighbouring peak. The fixtures are the correlation curves kept by that run and by a run whose two
curves agreed.
"""

import csv
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio_e2e_probe import SLOT_MS  # noqa: E402
from mirror_audio_latency_hil import (  # noqa: E402
    MIN_TONE_SCORE,
    bandpass,
    envelope,
    lag_curve,
    latency_reading,
    tone_lag_curve,
)
from test_mirror_latency_peaks import RATE, MAX_LAG, barcode, delayed  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def kept_curves(name: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with open(FIXTURES / name) as handle:
        rows = list(csv.DictReader(handle))
    column = lambda key: np.array([float(row[key]) for row in rows])  # noqa: E731
    return column("lag_ms"), column("broadband"), column("per_tone")


def test_a_broadband_peak_two_slots_out_is_a_warning_and_the_per_tone_lag_is_the_reading():
    reading = latency_reading(*kept_curves("latency-correlation-2026-10-02T13-54-22.csv"))
    assert reading["latencyMs"] == pytest.approx(272, abs=2)
    assert reading["source"] == "per-tone"
    assert reading["broadbandLagMs"] == pytest.approx(750, abs=2)
    assert reading["broadbandMinusToneSlots"] == pytest.approx(2.0, abs=0.05)
    assert reading["warning"] is not None and "+2.00 slots" in reading["warning"]


def test_agreeing_curves_give_the_same_reading_and_no_warning():
    reading = latency_reading(*kept_curves("latency-correlation-2026-10-02T13-52-51.csv"))
    assert reading["latencyMs"] == pytest.approx(272, abs=2)
    assert reading["broadbandLagMs"] == pytest.approx(271, abs=2)
    assert reading["warning"] is None


def test_a_capture_whose_broadband_peak_slips_a_slot_still_reads_the_true_delay():
    """Synthetic: a speaker that favours one tone puts the broadband maximum a slot away from the truth."""
    gains = [0.15, 0.15, 0.15, 0.15, 1.0, 0.15, 0.15, 0.15]
    wire = barcode(8.0, gains)
    mic = delayed(barcode(8.0, gains[1:] + gains[:1]), 300.0)
    lags = np.arange(MAX_LAG + 1) * 1000.0 / RATE
    broadband = lag_curve(envelope(bandpass(wire, RATE), RATE), envelope(bandpass(mic, RATE), RATE), MAX_LAG)
    per_tone = tone_lag_curve(wire, mic, RATE, MAX_LAG)
    assert abs(lags[int(np.argmax(broadband))] - 300.0) > SLOT_MS / 2
    reading = latency_reading(lags, broadband, per_tone)
    assert reading["latencyMs"] == pytest.approx(300.0, abs=3)
    assert reading["warning"] is not None


def test_without_the_barcode_the_reading_falls_back_to_broadband_and_says_so():
    lags = np.arange(800, dtype=float)
    broadband = np.zeros(800)
    broadband[410] = 0.8
    per_tone = np.full(800, 0.02)
    per_tone[100] = MIN_TONE_SCORE / 2
    reading = latency_reading(lags, broadband, per_tone)
    assert reading["latencyMs"] == 410
    assert reading["source"] == "broadband"
    assert "per-tone correlation is weak" in reading["warning"]
