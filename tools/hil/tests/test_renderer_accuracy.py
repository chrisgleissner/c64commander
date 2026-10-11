"""The renderer-accuracy grader finds a capture inside its host render, scores identical audio as
identical, and tells a wrong note from a right one on signals with a known answer."""

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import renderer_accuracy as ra  # noqa: E402

RATE = ra.RATE


def melody(seconds: float = 12.0, pitch: float = 1.0, seed: int = 1) -> np.ndarray:
    """A random note every 250 ms with a short gap; the notes are fixed and `seed` varies only the noise."""
    notes = np.random.default_rng(100)
    t = np.arange(int(seconds * RATE)) / RATE
    out = np.zeros_like(t)
    for start in np.arange(0, seconds, 0.25):
        freq = 220 * 2 ** (notes.integers(0, 12) / 12) * pitch
        span = (t >= start) & (t < start + 0.2)
        out[span] = notes.uniform(0.1, 0.35) * np.sign(np.sin(2 * math.pi * freq * t[span]))
    return out + np.random.default_rng(seed).normal(0, 1e-4, len(out))


def test_locates_an_excerpt_to_the_sample():
    reference = melody()
    start = int(3.3 * RATE) + 17
    excerpt = 0.5 * reference[start : start + 5 * RATE]
    assert ra.locate(reference, excerpt, RATE) == start


def test_a_scaled_copy_leaves_no_residual_and_reports_its_gain():
    reference = np.stack([melody(), melody(seed=2)], axis=1)
    start = int(2.0 * RATE)
    capture = 0.5 * reference[start : start + 4 * RATE]
    result = ra.digital(reference, capture, RATE)
    assert result["start_seconds"] == pytest.approx(2.0, abs=1 / RATE)
    assert result["gain_db"] == pytest.approx(-6.02, abs=0.01)
    assert result["residual_db"] < -100


def test_a_different_render_leaves_a_residual_near_its_own_level():
    reference = np.stack([melody(), melody()], axis=1)
    other = np.stack([melody(seed=3), melody(seed=3)], axis=1)
    other[:, :] += np.stack([melody(pitch=1.5)] * 2, axis=1)[: len(other)] * 0.5
    result = ra.digital(reference, other[RATE : 5 * RATE], RATE)
    assert result["residual_db"] > -10


def test_the_same_music_through_another_speaker_matches_on_notes_and_dynamics():
    take = melody()
    # A delayed, band-shaped and noisier copy, like a second microphone take in the same room.
    shaped = np.convolve(take, np.ones(8) / 8, mode="same")
    other = np.concatenate([np.zeros(int(0.37 * RATE)), 0.3 * shaped])[: len(take)]
    other += np.random.default_rng(5).normal(0, 1e-3, len(other))
    result = ra.acoustic(take, other, RATE)
    assert result["chroma_sim"] > 0.95
    assert result["envelope_corr"] > 0.9


def test_wrong_notes_score_lower_on_chroma():
    right = ra.acoustic(melody(), melody(seed=4), RATE)
    wrong = ra.acoustic(melody(), melody(pitch=2 ** (6 / 12), seed=4), RATE)
    assert wrong["chroma_sim"] < right["chroma_sim"] - 0.2


def test_resampling_keeps_the_length_in_time():
    samples = np.stack([melody(1.0), melody(1.0)], axis=1)
    resampled = ra.to_rate(samples, 44100)
    assert len(resampled) == int(len(samples) * RATE / 44100)
