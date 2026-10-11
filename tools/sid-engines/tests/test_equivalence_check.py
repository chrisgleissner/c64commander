"""The comparison measures report what they claim on signals with a known answer, and the tolerance
check fails on exactly the rows and measures outside it."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import compare_engines  # noqa: E402
import run_matrix  # noqa: E402

RATE = 48000


def notes(seconds: float = 4.0, delay_s: float = 0.0, gain: float = 1.0, pitch: float = 1.0) -> np.ndarray:
    """A stereo melody: a different note every 250 ms with a short gap, so envelopes and chroma move."""
    t = np.arange(int(seconds * RATE)) / RATE
    out = np.zeros_like(t)
    for index, start in enumerate(np.arange(0, seconds, 0.25)):
        freq = 220 * 2 ** ((index * 5 % 12) / 12) * pitch
        span = (t >= start + delay_s) & (t < start + delay_s + 0.2)
        out[span] = 0.3 * np.sign(np.sin(2 * math.pi * freq * t[span]))
    return np.stack([out * gain, out * gain], axis=1)


def test_identical_renders_compare_as_identical():
    reference = notes()
    result = compare_engines.compare(reference, reference.copy(), RATE, "same", "ref")
    assert result.start_offset_ms == 0
    assert abs(result.level_db) < 1e-9
    assert result.envelope_corr > 0.999
    assert result.chroma_sim > 0.999
    assert result.band_db_mae < 1e-6
    assert not result.silent


def test_a_late_start_is_measured_as_an_offset():
    result = compare_engines.compare(notes(), notes(delay_s=0.05), RATE, "late", "ref")
    assert result.start_offset_ms == pytest.approx(50, abs=10)
    assert result.envelope_corr > 0.95


def test_a_gain_change_is_measured_as_level_and_not_as_timbre():
    result = compare_engines.compare(notes(), notes(gain=0.5), RATE, "quiet", "ref")
    assert result.level_db == pytest.approx(-6.02, abs=0.05)
    assert result.band_db_mae < 0.01


def test_different_notes_lower_chroma_similarity():
    result = compare_engines.compare(notes(), notes(pitch=2 ** (6 / 12)), RATE, "tritone", "ref")
    assert result.chroma_sim < 0.6


def test_silence_is_flagged():
    result = compare_engines.compare(notes(), np.zeros((4 * RATE, 2)), RATE, "silent", "ref")
    assert result.silent


def test_stereo_correlation_tells_mono_from_hard_panned():
    left = notes()[:, 0]
    other = notes(pitch=1.5)[:, 0]
    assert compare_engines.stereo_correlation(np.stack([left, left], axis=1)) == pytest.approx(1.0)
    assert abs(compare_engines.stereo_correlation(np.stack([left, other], axis=1))) < 0.3


TOLERANCES = {
    "sidplayez": {
        "default": {
            "max_abs_offset_ms": 40,
            "level_db": [-1.5, 1.5],
            "min_envelope_corr": 0.85,
            "min_chroma_sim": 0.85,
            "max_band_db_mae": 2.0,
            "max_abs_stereo_delta": 0.1,
        },
        "overrides": [{"tune": "digi-8580", "level_db": [-11.5, -7.0], "reason": "test"}],
    }
}


def row(**changes) -> dict:
    base = {
        "tune": "tests/fixtures/sid-engines/waveforms-8580.sid",
        "song": 1,
        "engine": "sidplayez",
        "frames": 100,
        "reference_frames": 100,
        "start_offset_ms": -10.0,
        "level_db": 0.3,
        "envelope_corr": 0.96,
        "chroma_sim": 0.99,
        "band_db_mae": 0.1,
        "stereo_corr": 1.0,
        "reference_stereo_corr": 1.0,
        "silent": False,
    }
    return {**base, **changes}


def test_a_row_inside_every_tolerance_passes():
    assert run_matrix.check_rows([row()], TOLERANCES) == []


@pytest.mark.parametrize(
    "changes, measure",
    [
        ({"start_offset_ms": 50.0}, "start_offset_ms"),
        ({"start_offset_ms": -50.0}, "start_offset_ms"),
        ({"level_db": 1.6}, "level_db"),
        ({"level_db": -1.6}, "level_db"),
        ({"envelope_corr": 0.84}, "envelope_corr"),
        ({"chroma_sim": 0.84}, "chroma_sim"),
        ({"band_db_mae": 2.1}, "band_db_mae"),
        ({"stereo_corr": 0.02, "reference_stereo_corr": 0.86}, "stereo_delta"),
    ],
)
def test_each_measure_outside_its_tolerance_is_named(changes, measure):
    violations = run_matrix.check_rows([row(**changes)], TOLERANCES)
    assert len(violations) == 1
    assert measure in violations[0] and "waveforms-8580" in violations[0]


def test_silence_and_a_frame_count_mismatch_always_fail():
    violations = run_matrix.check_rows([row(silent=True, frames=99)], TOLERANCES)
    assert any("silence" in v for v in violations)
    assert any("99 frames" in v for v in violations)


def test_an_override_replaces_only_the_measures_it_names():
    digi = "tests/fixtures/sid-engines/digi-8580.sid"
    assert run_matrix.check_rows([row(tune=digi, level_db=-9.2)], TOLERANCES) == []
    assert run_matrix.check_rows([row(level_db=-9.2)], TOLERANCES) != []
    assert run_matrix.check_rows([row(tune=digi, level_db=-9.2, chroma_sim=0.5)], TOLERANCES) != []


def test_the_shipped_tolerances_cover_both_renderers_and_explain_every_override():
    shipped = json.loads((HERE.parent / "tolerances.json").read_text())
    measures = {key for _, _, key in run_matrix.MEASURES}
    for engine in ("sidplayez", "sidlite"):
        assert set(shipped[engine]["default"]) == measures
        for override in shipped[engine]["overrides"]:
            assert override["reason"].strip()
            assert set(override) - {"tune", "reason"} <= measures


def test_the_fixture_set_covers_every_probe_and_demo_tune():
    names = {Path(path).stem for path, _, _ in run_matrix.FIXTURE_TUNES}
    assert {"tone-ladder", "two-sid", "three-sid", "rsid-irq", "digi-6581", "digi-8580", "Kernal Panic"} <= names
    assert len(run_matrix.PROBE_TUNES) == 12
