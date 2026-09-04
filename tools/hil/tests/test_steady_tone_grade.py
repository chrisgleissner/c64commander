"""The tone grader has to see the waveform the merge gate actually generates.

`docs/testing/hil-merge-gate.md` tells you to generate the graded tunes as a sawtooth,
because a triangle at 550 Hz is too quiet for the microphone. A sawtooth puts energy at
every multiple of its pitch, all of it inside the grader's 300-6000 Hz band. Counting
those overtones as room noise made the 12 dB signal-to-noise margin unreachable however
loud the tone was, and a recording whose fundamental was the loudest thing in the room
graded as NO TONE.

These are synthetic signals rather than recordings, so they run anywhere and need no rig.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from steady_tone_grade import _dump_json, grade, verdict_for  # noqa: E402

RATE = 48000
SECONDS = 3.0
HZ = 550.0


def write_wav(path: Path, samples: np.ndarray) -> Path:
    import wave

    clipped = np.clip(samples, -1.0, 1.0)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes((clipped * 32000).astype("<i2").tobytes())
    return path


def signal(kind: str, amplitude: float, seed: int = 7) -> np.ndarray:
    t = np.arange(int(RATE * SECONDS)) / RATE
    rng = np.random.default_rng(seed)
    room = rng.normal(0.0, 0.002, t.shape)
    if kind == "silence":
        return room
    if kind == "sine":
        return amplitude * np.sin(2 * np.pi * HZ * t) + room
    # A sawtooth: every overtone present, decaying as 1/n, which is the gate's own stimulus.
    phase = (HZ * t) % 1.0
    return amplitude * (2 * phase - 1.0) + room


def graded(tmp_path: Path, kind: str, amplitude: float = 0.3) -> dict:
    path = write_wav(tmp_path / f"{kind}.wav", signal(kind, amplitude))
    result = grade(str(path), HZ)
    return {**result, "verdict": verdict_for(result)}


@pytest.mark.parametrize("kind", ["sawtooth", "sine"])
def test_a_steady_tone_is_graded_clean(tmp_path: Path, kind: str) -> None:
    result = graded(tmp_path, kind)
    assert result["verdict"] == "clean", result["faults"]
    assert result["present_fraction"] == pytest.approx(1.0, abs=0.02)
    assert abs(result["cents"]) < 50


def test_an_empty_room_is_still_refused(tmp_path: Path) -> None:
    # The margin exists to stop a room being reported as a quiet, slightly detuned tune.
    # Excluding the overtones must not cost that.
    result = graded(tmp_path, "silence")
    assert result["verdict"] == "NO TONE"


def _reject_non_finite(token: str) -> None:
    raise ValueError(f"not valid JSON: {token}")


def test_an_empty_room_still_serializes_as_strict_json(tmp_path: Path) -> None:
    # No tone measured means "cents" is float("nan"). json.dumps's default behaviour emits the
    # bare token NaN, which merge_gate.mjs's JSON.parse (a strict parser) rejects outright,
    # turning a refusal-to-grade into a crash instead of a reported verdict.
    result = graded(tmp_path, "silence")
    assert result["cents"] != result["cents"]  # nan != nan
    dumped = _dump_json(result)
    parsed = json.loads(dumped, parse_constant=_reject_non_finite)
    assert parsed["cents"] is None


def test_a_gap_in_the_middle_is_found(tmp_path: Path) -> None:
    samples = signal("sawtooth", 0.3)
    start = int(RATE * 1.0)
    samples[start : start + int(RATE * 0.4)] = 0.0
    path = write_wav(tmp_path / "gap.wav", samples)
    result = grade(str(path), HZ)
    assert result["longest_gap_ms"] >= 300
    assert verdict_for(result) != "clean"


FIXTURE = Path(__file__).parent / "fixtures" / "tone-low-through-phone-speaker.wav"


def test_the_recording_that_a_synthetic_sawtooth_does_not_reproduce() -> None:
    """Two seconds of the gate's own Tone-Low, off the Pixel's speaker, through the room mic.

    A mathematical sawtooth is not enough to catch this. Its overtones fall away as 1/n and
    the noise estimate is an RMS over thousands of near-empty bins, so the margin is cleared
    comfortably either way. A phone speaker rolls off hard at 550 Hz and passes the
    overtones, and the tone is not perfectly steady, so its energy smears across neighbouring
    bins: measured against this recording the second and third overtones sit 2-3 dB below the
    fundamental. Before the overtones were excluded from the noise estimate this graded
    NO TONE at 0% present, while its 550 Hz fundamental was the loudest thing in the room.
    """
    result = grade(str(FIXTURE), HZ)
    assert verdict_for(result) == "clean"
    assert result["present_fraction"] == pytest.approx(1.0, abs=0.01)
    assert result["peak_dbfs"] > -60
