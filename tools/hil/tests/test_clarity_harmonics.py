"""av-clarity must grade a note the phone's speaker carries mostly on its third harmonic.

At gate volume the Pixel 4's speaker can put a ladder note's third harmonic above the note itself
(1210 Hz read as 3632 Hz, 1350 Hz as 4054 Hz). The grader listened only at the fundamental, so the
room's rumble and a low-frequency knock decided where those notes began and ended, and whether
they were found at all: run 2026-10-02T13-55-53 failed on "1 tones arrived out of order" and run
2026-10-02T13-57-24 on "15 of 82 notes defective", while the wire captured over the same 20 s was
clean and every tone was in the recording, in order and on its slot.

These cases build such a ladder synthetically, re-grade excerpts of the two kept recordings, and
check that the change did not teach the grader to pass a wrong, missing, reordered or broken note.
"""

import re
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio_e2e_probe import ON_MS, SLOT_MS, TONES_HZ, analyse  # noqa: E402
from explain_clarity import explain_wav  # noqa: E402

RATE = 48000
FIXTURES = Path(__file__).resolve().parent / "fixtures"
KEPT_RUNS_DIR = Path("artifacts") / "hil-bug-bash-2026-10-02" / "leads" / "gate-runs"


def kept_run(run: str) -> Path | None:
    """The kept av-clarity recording, in this checkout or the main one a worktree hangs off."""
    for parent in Path(__file__).resolve().parents:
        mic = parent / KEPT_RUNS_DIR / run / "av-clarity" / "mic.wav"
        if mic.is_file():
            return mic
    return None


def phone_ladder(
    slots: list[float | None],
    fundamental: float = 0.12,
    third: float = 0.4,
    rumble: float = 0.1,
    seed: int = 7,
) -> np.ndarray:
    """A ladder as a quiet phone speaker plays it: weak fundamental, strong third harmonic, room rumble."""
    slot = int(round(RATE * SLOT_MS / 1000))
    on = int(round(RATE * ON_MS / 1000))
    out = np.zeros(slot * len(slots))
    t = np.arange(on) / RATE
    ramp = np.minimum(1.0, np.minimum(np.arange(on), np.arange(on)[::-1]) / (RATE * 0.002))
    for index, hz in enumerate(slots):
        if hz is not None:
            note = fundamental * np.sin(2 * np.pi * hz * t) + third * np.sin(2 * np.pi * 3 * hz * t)
            out[index * slot : index * slot + on] = note * ramp
    rng = np.random.default_rng(seed)
    n = np.arange(len(out)) / RATE
    for hz in (50, 97, 143, 211, 260):
        out += rumble * rng.uniform(0.5, 1.0) * np.sin(2 * np.pi * hz * n + rng.uniform(0, 2 * np.pi))
    return out + rng.normal(0, 0.002, len(out))


def cycle(start: int, count: int) -> list[float | None]:
    return [float(TONES_HZ[(start + k) % len(TONES_HZ)]) for k in range(count)]


def write(path: Path, samples: np.ndarray) -> Path:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes((np.clip(samples, -1, 1) * 32000).astype("<i2").tobytes())
    return path


def grade(path: Path, capsys) -> dict:
    code = analyse(str(path))
    out = capsys.readouterr().out
    defective = re.search(r"defective notes\s+(none|\d+) of (\d+)", out)
    return {
        "code": code,
        "bursts": int(re.search(r"bursts read\s+(\d+)", out).group(1)),
        "sequenceErrors": int(re.search(r"sequence errors (\d+)", out).group(1)),
        "defective": 0 if defective.group(1) == "none" else int(defective.group(1)),
        "dropoutPct": float(re.search(r"DROPOUTS\s+([\d.]+)%", out).group(1)),
        "out": out,
    }


def slot_start(index: int) -> int:
    return int(round(RATE * SLOT_MS / 1000)) * index


def test_a_ladder_carried_on_its_third_harmonic_over_room_rumble_grades_clean(tmp_path, capsys):
    graded = grade(write(tmp_path / "phone.wav", phone_ladder(cycle(0, 26))), capsys)
    assert graded["bursts"] >= 22
    assert graded["sequenceErrors"] == 0
    assert graded["defective"] == 0, graded["out"]
    assert graded["code"] == 0


def test_a_low_knock_over_a_weak_fundamental_does_not_lose_the_note(tmp_path, capsys):
    """Run 13-55's sequence error: energy at 700-800 Hz drowned 1080 Hz's fundamental, not its harmonic."""
    signal = phone_ladder(cycle(0, 26))
    knock_at = slot_start(12) + int(RATE * 0.03)
    width = int(RATE * 0.1)
    t = np.arange(width) / RATE
    signal[knock_at : knock_at + width] += 0.1 * (np.sin(2 * np.pi * 705 * t) + np.sin(2 * np.pi * 778 * t))
    graded = grade(write(tmp_path / "knock.wav", signal), capsys)
    assert graded["sequenceErrors"] == 0, graded["out"]


def test_explain_reads_a_third_harmonic_burst_as_its_ladder_note(tmp_path):
    report = explain_wav(write(tmp_path / "phone.wav", phone_ladder(cycle(0, 26), rumble=0.0)))
    assert report["sequenceErrors"] == []
    rows = [row for row in report["bursts"] if row["toneHz"] == 1210]
    assert rows and all(row["pitchClass"] == "ladder" and row["partial"] == 3 for row in rows)
    assert all(abs(row["measuredHz"] - 1210) < 1210 * 0.01 for row in rows)


def test_a_substituted_wrong_ladder_note_is_still_a_sequence_error(tmp_path, capsys):
    slots = cycle(0, 26)
    slots[13] = float(TONES_HZ[2])  # 870 Hz where 1210 Hz belongs, in the same timbre
    graded = grade(write(tmp_path / "wrong.wav", phone_ladder(slots)), capsys)
    assert graded["sequenceErrors"] >= 1
    assert graded["code"] != 0


def test_a_lone_third_harmonic_without_its_fundamental_is_not_read_as_the_note(tmp_path, capsys):
    slots = cycle(0, 26)
    slots[13] = 3 * float(TONES_HZ[5])  # 3630 Hz alone, where 1210 Hz belongs
    graded = grade(write(tmp_path / "harmonic-only.wav", phone_ladder(slots, rumble=0.0)), capsys)
    assert graded["sequenceErrors"] >= 1
    assert graded["code"] != 0


def test_notes_played_out_of_order_are_still_caught(tmp_path, capsys):
    slots = cycle(0, 26)
    slots[12], slots[13] = slots[13], slots[12]
    graded = grade(write(tmp_path / "swapped.wav", phone_ladder(slots)), capsys)
    assert graded["sequenceErrors"] >= 2
    assert graded["code"] != 0


def test_a_hole_inside_a_weak_fundamental_note_is_still_a_defect(tmp_path, capsys):
    signal = phone_ladder(cycle(0, 26))
    hole_at = slot_start(13) + int(RATE * 0.06)
    signal[hole_at : hole_at + int(RATE * 0.02)] = 0.0
    graded = grade(write(tmp_path / "hole.wav", signal), capsys)
    assert graded["defective"] >= 1
    assert graded["code"] != 0


# Four-second excerpts of the kept recordings, decimated 2:1 to 24 kHz to stay under 200 KB. Each held
# notes the old grader failed (13-55: 1 sequence error and 7 of 14 defective; 13-57: 6 of 14 defective).
@pytest.mark.parametrize(
    "name", ["clarity-mic-2026-10-02T13-55-53.wav", "clarity-mic-2026-10-02T13-57-24.wav"]
)
def test_kept_phone_recordings_grade_clean(name, capsys):
    graded = grade(FIXTURES / name, capsys)
    assert graded["bursts"] >= 13
    assert graded["sequenceErrors"] == 0
    assert graded["defective"] == 0, graded["out"]
    assert graded["dropoutPct"] == 0.0


@pytest.mark.parametrize("run", ["2026-10-02T13-55-53-187Z-c64u", "2026-10-02T13-57-24-456Z-c64u"])
def test_full_kept_recordings_pass_the_gate_thresholds(run, capsys):
    mic = kept_run(run)
    if mic is None:
        pytest.skip(f"kept run {run} is not on this machine")
    graded = grade(mic, capsys)
    assert graded["bursts"] >= 80
    assert graded["sequenceErrors"] == 0
    assert graded["defective"] / graded["bursts"] <= 0.1
    assert graded["dropoutPct"] <= 1.0
