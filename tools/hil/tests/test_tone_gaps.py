import importlib.util
import pathlib

import numpy as np

SPEC = importlib.util.spec_from_file_location("tone_gaps", pathlib.Path(__file__).resolve().parents[1] / "tone_gaps.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

RATE = 16000


def tone(seconds: float, hz: float = 1000.0) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return 0.3 * np.sin(2 * np.pi * hz * t)


def silence(seconds: float) -> np.ndarray:
    return np.random.default_rng(1).normal(0, 1e-5, int(seconds * RATE))


def test_a_gap_of_a_few_hundred_milliseconds_between_two_tones_is_found_to_the_frame():
    samples = np.concatenate([tone(10, 550), silence(0.4), tone(10, 900)])
    gaps = module.find_gaps(module.frame_levels_db(samples, RATE), below_db=15.0, min_ms=60.0)
    assert len(gaps) == 1
    start, length_ms = gaps[0]
    assert abs(start - 10.0) < 0.1
    assert 360 <= length_ms <= 440


def test_two_tones_that_join_without_a_gap_report_none():
    samples = np.concatenate([tone(10, 550), tone(10, 900)])
    assert module.find_gaps(module.frame_levels_db(samples, RATE), below_db=15.0, min_ms=60.0) == []


def test_each_change_names_the_longest_gap_that_starts_within_its_window():
    gaps = [(10.1, 80.0), (10.9, 300.0), (40.0, 100.0)]
    report = module.gap_after_each_change(gaps, [10.0, 25.0], window=4.0)
    assert report[0]["gap_ms"] == 300 and report[0]["gap_at_s"] == 10.9
    assert report[1]["gap_ms"] == 0 and report[1]["gap_at_s"] is None
