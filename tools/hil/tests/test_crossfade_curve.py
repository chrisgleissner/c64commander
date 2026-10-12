# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
# See <https://www.gnu.org/licenses/> for details.

import sys
import wave
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crossfade_curve import grade_mic, synthetic  # noqa: E402


def grade_signal(tmp_path: Path, samples: np.ndarray, rate: int, fade_ms: int) -> dict:
    path = tmp_path / "transition.wav"
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((np.clip(samples, -1, 1) * 32000).astype("<i2").tobytes())
    return grade_mic(str(path), fade_ms, 550.0, 900.0)


@pytest.mark.parametrize("fade_ms", [0, 1500])
@pytest.mark.parametrize("startup_seconds", [0.25, 1.0])
def test_microphone_startup_silence_is_not_the_outgoing_tune_ending(
    tmp_path: Path, fade_ms: int, startup_seconds: float
) -> None:
    samples, rate = synthetic(fade_ms)
    samples = np.concatenate([np.zeros(int(startup_seconds * rate)), samples])
    result = grade_signal(tmp_path, samples, rate, fade_ms)
    assert result["verdict"] == "SMOOTH", result
    assert result["gap_ms"] == 0


@pytest.mark.parametrize("dropout_seconds", [2.0, 6.5])
def test_startup_silence_does_not_hide_a_dropout_after_either_tune_has_started(
    tmp_path: Path, dropout_seconds: float
) -> None:
    samples, rate = synthetic(1500)
    samples[int(dropout_seconds * rate) : int((dropout_seconds + 0.4) * rate)] = 0
    samples = np.concatenate([np.zeros(rate // 4), samples])
    result = grade_signal(tmp_path, samples, rate, 1500)
    assert result["verdict"] == "FAULTY", result


@pytest.mark.parametrize("missing", ["outgoing", "incoming", "both"])
def test_startup_handling_still_refuses_a_recording_without_both_tunes(tmp_path: Path, missing: str) -> None:
    samples, rate = synthetic(0)
    if missing in ("outgoing", "both"):
        samples[: 4 * rate] = 0
    if missing in ("incoming", "both"):
        samples[4 * rate :] = 0
    result = grade_signal(tmp_path, samples, rate, 0)
    assert result["verdict"] == "NO TRANSITION", result
