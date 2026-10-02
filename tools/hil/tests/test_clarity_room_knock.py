"""A knock in the room must not split a note the phone kept playing into two.

Gate run 2026-10-02T14-51-40 failed av-clarity on "1 tones arrived out of order". The wire was in
order and the phone's timeline was intact; three knocks hit the microphone at 11.825, 11.970 and
12.060 s (peaks at and near full scale, -12 dBFS below 300 Hz, which a phone speaker at volume 3
cannot produce). The first landed inside a 1210 Hz note. Its third harmonic stayed at its plateau
through the knock, but for a 25 ms window every ladder band rose together, the note was not
identified there, and the grader read two 1210 Hz notes 45 ms apart: a "replay".
"""

import re
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio_e2e_probe import TONES_HZ, analyse, bridge_interruptions  # noqa: E402
from test_clarity_harmonics import RATE, cycle, phone_ladder, slot_start, write  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
KEPT_RUN = Path("artifacts") / "hil-bug-bash-2026-10-02" / "graders-1" / "2026-10-02T14-51-40-405Z-c64u"


def grade(path: Path, capsys) -> dict:
    code = analyse(str(path))
    out = capsys.readouterr().out
    defective = re.search(r"defective notes\s+(none|\d+) of (\d+)", out)
    return {
        "code": code,
        "bursts": int(re.search(r"bursts read\s+(\d+)", out).group(1)),
        "sequenceErrors": int(re.search(r"sequence errors (\d+)", out).group(1)),
        "defective": 0 if defective.group(1) == "none" else int(defective.group(1)),
        "out": out,
    }


def knock(signal: np.ndarray, at: int, seed: int = 11) -> np.ndarray:
    """A 40 ms thump: a decaying low-frequency body with a broadband crack, peaking near full scale."""
    width = int(RATE * 0.04)
    t = np.arange(width) / RATE
    decay = np.exp(-t / 0.015)
    crack = np.random.default_rng(seed).normal(0, 0.35, width)
    signal[at : at + width] += decay * (0.6 * np.sin(2 * np.pi * 120 * t) + crack)
    return signal


def test_short_interruptions_inside_one_note_are_bridged_and_a_repeated_note_is_not():
    note = 8
    assert bridge_interruptions(np.array([5, 5, -1, 5, 5]), note).tolist() == [5, 5, 5, 5, 5]
    assert bridge_interruptions(np.array([5, 5, 2, 2, 5]), note).tolist() == [5, 5, 5, 5, 5]
    assert bridge_interruptions(np.array([5, -1, -1, -1, 5]), note).tolist() == [5, -1, -1, -1, 5]
    assert bridge_interruptions(np.array([5, 5, -1, 6, 6]), note).tolist() == [5, 5, -1, 6, 6]
    repeated = [5] * 6 + [-1, -1] + [5] * 6
    assert bridge_interruptions(np.array(repeated), note).tolist() == repeated


def test_a_knock_inside_a_note_does_not_read_as_the_note_played_twice(tmp_path, capsys):
    # At gate volume the notes sit about 30 dB under a knock that reaches the microphone near full scale.
    signal = knock(phone_ladder(cycle(0, 26)) * 0.1, slot_start(13) + int(RATE * 0.07))
    graded = grade(write(tmp_path / "knock.wav", signal), capsys)
    assert graded["sequenceErrors"] == 0, graded["out"]


def test_the_same_note_heard_again_after_a_silent_slot_gap_is_still_a_replay(tmp_path, capsys):
    slots = cycle(0, 13) + [float(TONES_HZ[4])] + cycle(5, 12)
    graded = grade(write(tmp_path / "replay.wav", phone_ladder(slots)), capsys)
    assert graded["sequenceErrors"] >= 1
    assert graded["code"] != 0


def test_another_note_cut_into_the_middle_of_a_note_is_still_a_defect(tmp_path, capsys):
    signal = phone_ladder(cycle(0, 26))
    at, width = slot_start(13) + int(RATE * 0.06), int(RATE * 0.04)
    t = np.arange(width) / RATE
    hz = float(TONES_HZ[1])
    signal[at : at + width] = 0.12 * np.sin(2 * np.pi * hz * t) + 0.4 * np.sin(2 * np.pi * 3 * hz * t)
    graded = grade(write(tmp_path / "spliced.wav", signal), capsys)
    assert graded["defective"] >= 1
    assert graded["code"] != 0


def test_kept_recording_with_room_knocks_has_no_sequence_error(capsys):
    """10.0-14.0 s of the 14-51-40 microphone capture, decimated 2:1 to 24 kHz."""
    graded = grade(FIXTURES / "clarity-mic-2026-10-02T14-51-40-knock.wav", capsys)
    assert graded["sequenceErrors"] == 0, graded["out"]
    assert graded["bursts"] == 15
    assert graded["defective"] <= 2


def test_full_kept_recording_with_room_knocks_passes_the_gate_thresholds(capsys):
    mic = next(
        (parent / KEPT_RUN / "av-clarity" / "mic.wav" for parent in Path(__file__).resolve().parents
         if (parent / KEPT_RUN / "av-clarity" / "mic.wav").is_file()),
        None,
    )
    if mic is None:
        pytest.skip("kept run 2026-10-02T14-51-40 is not on this machine")
    graded = grade(mic, capsys)
    assert graded["sequenceErrors"] == 0
    assert graded["defective"] / graded["bursts"] <= 0.1
