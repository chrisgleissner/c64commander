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


def write_wav(path, samples: np.ndarray, channels: int = 1) -> None:
    import wave

    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    if channels > 1:
        pcm = np.repeat(pcm[:, None], channels, axis=1).reshape(-1)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())


def test_a_silence_that_crosses_a_processing_block_boundary_is_found_whole(tmp_path):
    # Blocks are 60 s: this silence runs from 50 s to 70 s, across the first boundary, and the
    # recording ends partway into a block.
    path = tmp_path / "long.wav"
    write_wav(path, np.concatenate([tone(50), silence(20), tone(55)]))

    rate, blocks = module.read_wav_blocks(str(path))
    levels = module.stream_levels_db(blocks, rate)

    assert len(levels) == 125
    assert module.silent_runs(levels, below_db=30.0, min_seconds=3) == [(50, 20)]


def test_a_stereo_recording_is_mixed_to_mono(tmp_path):
    path = tmp_path / "stereo.wav"
    write_wav(path, np.concatenate([tone(10), silence(8), tone(10)]), channels=2)

    rate, blocks = module.read_wav_blocks(str(path))
    levels = module.stream_levels_db(blocks, rate)

    assert module.silent_runs(levels, below_db=30.0, min_seconds=3) == [(10, 8)]


def test_a_recording_that_is_not_sixteen_bit_is_refused(tmp_path):
    import wave

    path = tmp_path / "wide.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(1)
        wav.setframerate(RATE)
        wav.writeframes(bytes(RATE))

    try:
        module.read_wav_blocks(str(path))
    except ValueError as error:
        assert "expected 16-bit" in str(error)
    else:
        raise AssertionError("an 8-bit recording was accepted")
