"""`explain_clarity.py` has to name the fault the av-clarity verdict counted.

Each case is a synthetic tone ladder written to a WAV and read back through the grader's own
detector, with one known fault put in: a tone played twice, a tone cut out of the timeline, a tone
missing while its slot still passed, a burst whose pitch is between two ladder notes, and a burst
that is no ladder note at all. The explanation must name that fault and only that one.
"""

import sys
import wave
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio_e2e_probe import ON_MS, SLOT_MS, TONES_HZ, analyse  # noqa: E402
from explain_clarity import explain_wav, pitch_class, resolve_inputs  # noqa: E402

RATE = 48000


def ladder(slots: list[float | None], noise: float = 0.002, seed: int = 7) -> np.ndarray:
    """One slot per entry: a tone at that frequency for ON_MS then silence, or a silent slot for None."""
    slot = int(round(RATE * SLOT_MS / 1000))
    on = int(round(RATE * ON_MS / 1000))
    out = np.zeros(slot * len(slots))
    t = np.arange(on) / RATE
    ramp = np.minimum(1.0, np.minimum(np.arange(on), np.arange(on)[::-1]) / (RATE * 0.002))
    for index, hz in enumerate(slots):
        if hz is not None:
            out[index * slot : index * slot + on] = 0.4 * np.sin(2 * np.pi * hz * t) * ramp
    return out + np.random.default_rng(seed).normal(0, noise, len(out))


def cycle(start: int, count: int) -> list[float | None]:
    return [float(TONES_HZ[(start + k) % len(TONES_HZ)]) for k in range(count)]


def write(path: Path, samples: np.ndarray) -> Path:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes((np.clip(samples, -1, 1) * 32000).astype("<i2").tobytes())
    return path


def kinds(path: Path) -> list[str]:
    return [error["kind"] for error in explain_wav(path)["sequenceErrors"]]


def test_clean_ladder_has_no_sequence_errors(tmp_path):
    report = explain_wav(write(tmp_path / "clean.wav", ladder(cycle(0, 26))))
    assert len(report["bursts"]) >= 20
    assert report["sequenceErrors"] == []
    assert all(row["pitchClass"] == "ladder" for row in report["bursts"])


def test_a_tone_played_twice_is_a_replay(tmp_path):
    slots = cycle(0, 12) + [float(TONES_HZ[3])] + cycle(4, 12)
    assert kinds(write(tmp_path / "replay.wav", ladder(slots))) == ["replay"]


def test_a_two_slot_jump_back_is_a_replay(tmp_path):
    slots = cycle(0, 12) + cycle(2, 14)
    assert kinds(write(tmp_path / "replay2.wav", ladder(slots))) == ["replay"]


def test_a_tone_cut_from_the_timeline_is_dropped_audio(tmp_path):
    slots = cycle(0, 12) + cycle(5, 12)
    errors = explain_wav(write(tmp_path / "dropped.wav", ladder(slots)))["sequenceErrors"]
    assert [error["kind"] for error in errors] == ["dropped"]
    assert errors[0]["expectedHz"] == TONES_HZ[4]
    assert errors[0]["intervalSlots"] == pytest.approx(1.0, abs=0.1)


def test_a_silent_slot_that_kept_its_time_is_silence(tmp_path):
    slots = cycle(0, 12) + [None] + cycle(5, 12)
    errors = explain_wav(write(tmp_path / "silent.wav", ladder(slots)))["sequenceErrors"]
    assert [error["kind"] for error in errors] == ["silent"]
    assert errors[0]["intervalSlots"] == pytest.approx(2.0, abs=0.1)


def test_a_burst_between_ladder_notes_is_a_detector_error(tmp_path):
    slots = cycle(0, 12) + [1000.0] + cycle(5, 12)
    found = kinds(write(tmp_path / "between.wav", ladder(slots)))
    assert found[0] == "between"
    assert set(found[1:]) <= {"follow-on"}


def test_a_burst_that_is_no_ladder_note_is_room_noise(tmp_path):
    slots = cycle(0, 12) + [650.0] + cycle(5, 12)
    found = kinds(write(tmp_path / "noise.wav", ladder(slots)))
    assert found[0] == "noise"
    assert set(found[1:]) <= {"follow-on"}


def test_every_error_the_grader_counted_is_explained(tmp_path, capsys):
    """The explanation reads the grader's bursts, so its error count is the verdict's."""
    path = write(tmp_path / "mixed.wav", ladder(cycle(0, 10) + [float(TONES_HZ[1])] + cycle(2, 6) + cycle(1, 10)))
    analyse(str(path))
    printed = capsys.readouterr().out
    counted = int(printed.split("sequence errors")[1].split()[0])
    assert counted > 0
    assert len(explain_wav(path)["sequenceErrors"]) == counted


def test_pitch_class_boundaries():
    assert pitch_class(TONES_HZ[2] * 1.02) == "ladder"
    assert pitch_class(1000.0) == "between"
    assert pitch_class(650.0) == "noise"
    assert pitch_class(2500.0) == "noise"


def test_a_kept_run_directory_resolves_to_its_av_clarity_recordings(tmp_path):
    stage = tmp_path / "av-clarity"
    stage.mkdir()
    write(stage / "mic.wav", ladder(cycle(0, 14)))
    write(stage / "wire.wav", ladder(cycle(0, 14)))
    (stage / "probe.txt").write_text("VERDICT         clean\n")
    mic, wire, probe = resolve_inputs(tmp_path)
    assert (mic.name, wire.name, probe.name) == ("mic.wav", "wire.wav", "probe.txt")
