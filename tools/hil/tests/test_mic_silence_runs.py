import importlib.util
import pathlib

import numpy as np

SPEC = importlib.util.spec_from_file_location(
    "mic_silence_runs", pathlib.Path(__file__).resolve().parents[1] / "mic_silence_runs.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

RATE = 16000


def tone(seconds: int, level: float = 0.3) -> np.ndarray:
    t = np.arange(seconds * RATE) / RATE
    return level * np.sin(2 * np.pi * 1000 * t)


def silence(seconds: int) -> np.ndarray:
    return np.random.default_rng(1).normal(0, 1e-5, seconds * RATE)


def test_a_long_silence_between_tones_is_reported_with_its_position_and_length():
    samples = np.concatenate([tone(20), silence(12), tone(20)])
    levels = module.per_second_levels_db(samples, RATE)
    assert module.silent_runs(levels, below_db=30.0, min_seconds=3) == [(20, 12)]


def test_a_continuous_tone_has_no_silent_run():
    levels = module.per_second_levels_db(tone(30), RATE)
    assert module.silent_runs(levels, below_db=30.0, min_seconds=3) == []


def test_a_gap_shorter_than_the_minimum_is_ignored():
    samples = np.concatenate([tone(20), silence(2), tone(20)])
    levels = module.per_second_levels_db(samples, RATE)
    assert module.silent_runs(levels, below_db=30.0, min_seconds=3) == []
