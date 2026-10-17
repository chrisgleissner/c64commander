import importlib.util
import pathlib
import wave

import numpy as np
import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "soak_reference_diff.py"
SPEC = importlib.util.spec_from_file_location("soak_reference_diff", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

RATE = 16000
HEADER = "ts,pid,pss_total_kb,java_heap_kb,native_heap_kb,loadavg,battery_c10,media_state,media_title"
T0 = 1_792_000_000
TITLE = "Aurora Dreams-Sequence 2"
TUNE_PATTERN = [(10, 0.3), (10, 0.1), (8, 0.0), (12, 0.2), (10, 0.05), (10, 0.3)]
LEAD_IN_PATTERN = [(7, 0.2), (6, 0.05), (7, 0.3)]


def signal(pattern):
    parts = []
    for seconds, amplitude in pattern:
        t = np.arange(seconds * RATE) / RATE
        noise = np.random.default_rng(seconds).normal(0, 1e-5, seconds * RATE)
        parts.append(amplitude * np.sin(2 * np.pi * 1000 * t) + noise)
    return np.concatenate(parts)


def write_wav(path, samples):
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())


def levels_of(samples):
    return module.mic.per_second_levels_db(samples, RATE)


def psid(path, name):
    header = bytearray(0x7C)
    header[0:4] = b"PSID"
    header[0x16 : 0x16 + len(name)] = name.encode("latin-1")
    path.write_bytes(bytes(header))


def make_hvsc(tmp_path, files):
    root = tmp_path / "C64Music"
    (root / "MUSICIANS").mkdir(parents=True)
    for filename, name in files.items():
        psid(root / "MUSICIANS" / filename, name)
    return root


def fake_renderer(signal_by_stem):
    def render(sid_path, seconds, out_path, sidplayfp):
        samples = signal_by_stem.get(sid_path.stem)
        if samples is None:
            raise module.RenderError("no such tune")
        write_wav(out_path, samples)

    return render


def sampler(tmp_path, titles, start=T0):
    rows = [f"{start + 30 * i},1,2,3,4,5,6,,{title}" for i, title in enumerate(titles)]
    path = tmp_path / "s.csv"
    path.write_text("\n".join([HEADER, *rows]) + "\n")
    return module.soak.read_samples(str(path))


def run(tmp_path, samples, recording_samples, index, renderer, below_db=30.0, min_seconds=3):
    render_dir = tmp_path / "renders"
    render_dir.mkdir(exist_ok=True)
    return module.build_report(
        samples, levels_of(recording_samples), T0, index, renderer, render_dir, "sidplayfp", below_db, min_seconds
    )


def one_tune_setup(tmp_path):
    root = make_hvsc(tmp_path, {"Aurora_Dreams-Sequence_2.sid": "Something Else"})
    index = module.build_index(str(root))
    renderer = fake_renderer({"Aurora_Dreams-Sequence_2": signal(TUNE_PATTERN)})
    return index, renderer, sampler(tmp_path, [TITLE, TITLE])


def test_silence_where_the_reference_is_silent_is_content_and_not_a_defect(tmp_path):
    index, renderer, samples = one_tune_setup(tmp_path)
    report = run(tmp_path, samples, signal(TUNE_PATTERN), index, renderer)
    tune = report["tunes"][0]
    assert tune["status"] == "graded"
    assert tune["offset_s"] == 0
    assert tune["correlation"] > 0.99
    assert tune["defects"] == []
    assert tune["content_silences"] == [{"tune_second": 20, "seconds": 8}]
    assert report["totals"]["defects"] == 0


def test_silence_where_the_reference_is_audible_is_a_defect_at_its_tune_position(tmp_path):
    index, renderer, samples = one_tune_setup(tmp_path)
    recording = signal([(10, 0.3), (10, 0.1), (8, 0.0), (5, 0.2), (6, 0.0), (1, 0.2), (10, 0.05), (10, 0.3)])
    report = run(tmp_path, samples, recording, index, renderer)
    tune = report["tunes"][0]
    assert tune["status"] == "graded"
    assert tune["defects"] == [{"tune_second": 33, "seconds": 6, "wav_second": 33}]
    assert tune["content_silences"] == [{"tune_second": 20, "seconds": 8}]
    assert report["defects"] == [{"title": TITLE, "tune_second": 33, "seconds": 6, "wav_second": 33}]


def test_an_unmatched_title_is_listed_and_does_not_fail_the_run(tmp_path):
    index, renderer, _ = one_tune_setup(tmp_path)
    samples = sampler(tmp_path, ["Nothing Like This", "Nothing Like This"])
    report = run(tmp_path, samples, signal(TUNE_PATTERN), index, renderer)
    assert report["tunes"][0]["status"] == "unmatched"
    assert report["totals"]["unmatched"] == 1
    assert report["defects"] == []
    assert "Nothing Like This: window 60 s, unmatched" in module.format_report(report)[0]


def test_a_render_failure_is_reported_as_unrenderable_with_its_error(tmp_path):
    index, _, samples = one_tune_setup(tmp_path)
    report = run(tmp_path, samples, signal(TUNE_PATTERN), index, fake_renderer({}))
    assert report["tunes"][0]["status"] == "unrenderable"
    assert "no such tune" in report["tunes"][0]["error"]


def test_a_recording_shifted_twenty_seconds_from_the_sampler_estimate_is_still_aligned(tmp_path):
    index, renderer, samples = one_tune_setup(tmp_path)
    recording = np.concatenate([signal(LEAD_IN_PATTERN), signal(TUNE_PATTERN), signal([(5, 0.2)])])
    report = run(tmp_path, samples, recording, index, renderer)
    tune = report["tunes"][0]
    assert tune["offset_s"] == 20
    assert tune["correlation"] > 0.99
    assert tune["defects"] == []
    assert tune["content_silences"] == [{"tune_second": 20, "seconds": 8}]


def test_an_unrelated_recording_is_marked_weak_alignment_and_not_graded(tmp_path):
    index, renderer, samples = one_tune_setup(tmp_path)
    flat = signal([(80, 0.2)])
    report = run(tmp_path, samples, flat, index, renderer)
    assert report["tunes"][0]["status"] == "weak alignment"
    assert report["tunes"][0]["defects"] == []


def test_file_names_match_titles_with_underscores_and_case_ignored(tmp_path):
    root = make_hvsc(tmp_path, {"Aurora_Dreams-Sequence_2.sid": "Other", "Plain.sid": "Another"})
    index = module.build_index(str(root))
    expected = root / "MUSICIANS" / "Aurora_Dreams-Sequence_2.sid"
    assert index[module.title_key("AURORA dreams-Sequence 2")] == [expected]
    assert module.title_key("Aurora_Dreams-Sequence_2") == "aurora dreams-sequence 2"
    assert TITLE.lower() in index


def test_header_name_field_matches_when_the_file_name_differs(tmp_path):
    root = make_hvsc(tmp_path, {"x123.sid": "Gypsy Moth"})
    index = module.build_index(str(root))
    path = root / "MUSICIANS" / "x123.sid"
    assert module.header_name(path) == "Gypsy Moth"
    assert index[module.title_key("gypsy moth")] == [path]


@pytest.mark.parametrize("good_folder", ["A", "B"])
def test_the_candidate_that_follows_the_recording_is_chosen_among_same_named_files(tmp_path, good_folder):
    root = tmp_path / "C64Music"
    for folder in ("A", "B"):
        (root / folder).mkdir(parents=True)
        psid(root / folder / "Aurora_Dreams-Sequence_2.sid", "x")
    other = signal([(30, 0.1), (30, 0.3)])

    def render(sid_path, seconds, out_path, sidplayfp):
        write_wav(out_path, signal(TUNE_PATTERN) if sid_path.parent.name == good_folder else other)

    index = module.build_index(str(root))
    _, _, samples = one_tune_setup(tmp_path)
    report = run(tmp_path, samples, signal(TUNE_PATTERN), index, render)
    assert report["tunes"][0]["file"].endswith(f"{good_folder}/Aurora_Dreams-Sequence_2.sid")


def test_exit_status_is_one_only_when_a_defect_exists(tmp_path):
    import subprocess
    import sys

    index, renderer, samples = one_tune_setup(tmp_path)
    assert run(tmp_path, samples, signal(TUNE_PATTERN), index, renderer)["totals"]["defects"] == 0
    root = make_hvsc(tmp_path / "x", {"Aurora_Dreams-Sequence_2.sid": "n"})
    csv_path = tmp_path / "s.csv"
    wav_path = tmp_path / "mic.wav"
    write_wav(wav_path, signal(TUNE_PATTERN))
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(csv_path), "--wav", str(wav_path), "--wav-start-epoch", str(T0), "--hvsc-root", str(root), "--sidplayfp", "/nonexistent/sidplayfp"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "unrenderable" in result.stdout
