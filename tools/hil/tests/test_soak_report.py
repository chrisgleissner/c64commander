import importlib.util
import json
import pathlib
import subprocess
import sys
import wave

import numpy as np
import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "soak_report.py"
SPEC = importlib.util.spec_from_file_location("soak_report", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

RATE = 16000
HEADER = "ts,pid,pss_total_kb,java_heap_kb,native_heap_kb,loadavg,battery_c10,media_state,media_title"
T0 = 1_792_000_000


def row(ts, pid=100, pss=200_000, java=60_000, title=""):
    pid_text = "" if pid is None else pid
    return f"{ts},{pid_text},{pss},{java},36844,1.5,340,,{title}"


def write_csv(path, rows):
    path.write_text("\n".join([HEADER, *rows]) + "\n")
    return str(path)


def samples_from(path, rows):
    return module.read_samples(write_csv(path, rows))


def run_cli(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)


def test_empty_fields_parse_as_missing_values(tmp_path):
    samples = samples_from(tmp_path / "s.csv", [f"{T0},,,,,,,,", row(T0 + 30, title="Gypsy Moth")])
    assert (samples[0].pid, samples[0].pss_kb, samples[0].java_kb, samples[0].title) == (None, None, None, "")
    assert (samples[1].ts, samples[1].pid, samples[1].pss_kb, samples[1].java_kb, samples[1].title) == (
        T0 + 30,
        100,
        200_000.0,
        60_000.0,
        "Gypsy Moth",
    )


def test_a_wrong_header_is_refused(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("ts,pid\n1,2\n")
    with pytest.raises(ValueError, match="expected header"):
        module.read_samples(str(path))


def test_tune_changes_count_title_differences_and_ignore_empty_titles(tmp_path):
    titles = ["A", "A", "", "A", "B", "B", "", "C", "B"]
    samples = samples_from(tmp_path / "s.csv", [row(T0 + 30 * i, title=t) for i, t in enumerate(titles)])
    assert module.tune_timeline(samples) == [(T0, "A"), (T0 + 120, "B"), (T0 + 210, "C"), (T0 + 240, "B")]
    report = module.build_report(samples, None, None, 5.0)
    assert report["tune_changes"] == 3
    assert report["duration_s"] == 240
    assert report["samples"] == 9
    assert report["tunes_per_hour"] == pytest.approx(45.0)


def test_pid_changes_and_absent_rows_are_located(tmp_path):
    rows = [row(T0, pid=1), row(T0 + 30, pid=1), row(T0 + 60, pid=None), row(T0 + 90, pid=2), row(T0 + 120, pid=2), row(T0 + 150, pid=None)]
    process = module.process_identity(samples_from(tmp_path / "s.csv", rows))
    assert process == {
        "distinct_pids": 2,
        "pid_changes": [{"ts": T0 + 90, "from": 1, "to": 2}],
        "absent_samples": 2,
        "first_absent_ts": T0 + 60,
    }


def growth_rows(count, java_slope_mb_per_hour, start_kb=60_000):
    rows = []
    for i in range(count):
        hours = i * 30 / 3600
        java = start_kb + java_slope_mb_per_hour * 1024 * hours
        rows.append(row(T0 + 30 * i, pss=int(200_000 + 20 * 1024 * hours), java=int(java)))
    return rows


def test_linear_growth_gives_the_slope_in_mb_per_hour(tmp_path):
    samples = samples_from(tmp_path / "s.csv", growth_rows(200, 12.0))
    heap = module.memory_series(samples, "java_kb")
    pss = module.memory_series(samples, "pss_kb")
    assert heap["slope_mb_per_hour"] == pytest.approx(12.0, rel=0.05)
    assert pss["slope_mb_per_hour"] == pytest.approx(20.0, rel=0.05)
    assert heap["last_mb"] == pytest.approx((60_000 + 12.0 * 1024 * 199 * 30 / 3600) / 1024, rel=1e-3)
    assert heap["min_mb"] == pytest.approx((60_000 + 12.0 * 1024 * 50 * 30 / 3600) / 1024, rel=1e-3)


def test_warmup_quarter_is_excluded_from_the_slope(tmp_path):
    rows = [row(T0 + 30 * i, java=10_000 + 1000 * i if i < 50 else 60_000) for i in range(200)]
    heap = module.memory_series(samples_from(tmp_path / "s.csv", rows), "java_kb")
    assert heap["slope_mb_per_hour"] == pytest.approx(0.0, abs=1e-6)
    assert heap["min_mb"] == pytest.approx(60_000 / 1024)


def test_a_flat_series_has_about_zero_slope(tmp_path):
    heap = module.memory_series(samples_from(tmp_path / "s.csv", growth_rows(100, 0.0)), "java_kb")
    assert heap["slope_mb_per_hour"] == pytest.approx(0.0, abs=0.01)


def test_fewer_than_twenty_samples_in_the_window_compute_no_slope(tmp_path):
    heap = module.memory_series(samples_from(tmp_path / "s.csv", growth_rows(25, 50.0)), "java_kb")
    assert heap["slope_mb_per_hour"] is None
    assert heap["slope_note"] == "too few samples (19 < 20)"
    enough = module.memory_series(samples_from(tmp_path / "t.csv", growth_rows(26, 50.0)), "java_kb")
    assert enough["slope_mb_per_hour"] == pytest.approx(50.0, rel=0.05)


def test_empty_heap_values_leave_no_slope_and_no_range(tmp_path):
    rows = [row(T0 + 30 * i, java="") for i in range(100)]
    heap = module.memory_series(samples_from(tmp_path / "s.csv", rows), "java_kb")
    assert heap["slope_mb_per_hour"] is None
    assert heap["slope_note"] == "too few samples (0 < 20)"
    assert heap["min_mb"] is None


def tone(seconds, level=0.3):
    t = np.arange(seconds * RATE) / RATE
    return level * np.sin(2 * np.pi * 1000 * t)


def silence(seconds):
    return np.random.default_rng(1).normal(0, 1e-5, seconds * RATE)


def write_wav(path, samples):
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())


def tune_rows():
    titles = ["First"] * 4 + ["Second"] * 4
    return [row(T0 + 30 * i, title=t) for i, t in enumerate(titles)]


def test_a_silent_run_in_a_recording_is_mapped_to_its_tune_and_offset(tmp_path):
    wav_path = tmp_path / "mic.wav"
    write_wav(wav_path, np.concatenate([tone(130), silence(10), tone(40)]))
    csv_path = write_csv(tmp_path / "s.csv", tune_rows())
    out_json = tmp_path / "out.json"

    result = run_cli(csv_path, "--wav", str(wav_path), "--json", str(out_json))

    report = json.loads(out_json.read_text())
    assert report["silent_runs"] == [
        {"wav_second": 130, "epoch": T0 + 130, "seconds": 10, "title": "Second", "approx_offset_s": 10, "in_last_45s": None}
    ]
    assert "'Second' about 10 s in" in result.stdout
    assert "FAIL: silence of 10 s at wav second 130" in result.stdout
    assert result.returncode == 1


def test_wav_start_epoch_shifts_the_mapping_and_flags_the_tail_of_a_tune(tmp_path):
    timeline = module.tune_timeline(samples_from(tmp_path / "s.csv", tune_rows()))
    mapped = module.map_silent_runs([(5, 4), (59, 4), (70, 4), (115, 4)], timeline, T0 + 10)
    assert [(m["title"], m["approx_offset_s"], m["in_last_45s"]) for m in mapped] == [
        ("First", 15, False),
        ("First", 69, False),
        ("First", 80, True),
        ("Second", 5, None),
    ]


def test_a_silence_before_any_tune_has_no_title():
    mapped = module.map_silent_runs([(0, 5)], [(T0 + 100, "Late")], T0)
    assert mapped[0]["title"] is None
    assert mapped[0]["approx_offset_s"] is None


def report_for(tmp_path, rows, runs=None, max_slope=5.0):
    return module.build_report(samples_from(tmp_path / "r.csv", rows), runs, None, max_slope)


def test_a_clean_run_passes(tmp_path):
    assert report_for(tmp_path, growth_rows(100, 1.0), runs=[(10, 7)])["failures"] == []


def test_a_pid_change_fails(tmp_path):
    rows = growth_rows(100, 0.0)
    rows[60] = row(T0 + 30 * 60, pid=999)
    assert report_for(tmp_path, rows)["failures"] == ["pid changed 2 time(s): app process restarted"]


def test_an_absent_process_fails(tmp_path):
    rows = growth_rows(100, 0.0)
    rows[99] = row(T0 + 30 * 99, pid=None)
    assert report_for(tmp_path, rows)["failures"] == [f"process absent in 1 sample(s), first at {T0 + 30 * 99}"]


def test_a_silence_of_eight_seconds_fails_and_seven_does_not(tmp_path):
    rows = growth_rows(100, 0.0)
    assert report_for(tmp_path, rows, runs=[(10, 7)])["failures"] == []
    assert report_for(tmp_path, rows, runs=[(10, 8)])["failures"] == ["silence of 8 s at wav second 10"]


def test_a_heap_slope_over_the_limit_fails_and_under_it_passes(tmp_path):
    rows = growth_rows(200, 8.0)
    failures = report_for(tmp_path, rows)["failures"]
    assert len(failures) == 1 and failures[0].startswith("java heap slope 8.0")
    assert report_for(tmp_path, rows, max_slope=10.0)["failures"] == []


def test_an_uncomputed_slope_cannot_fail_the_run(tmp_path):
    assert report_for(tmp_path, growth_rows(10, 500.0))["failures"] == []


def test_exit_status_is_zero_when_clean_and_one_for_each_failing_condition(tmp_path):
    good_rows = growth_rows(100, 0.0)
    assert run_cli(write_csv(tmp_path / "good.csv", good_rows)).returncode == 0

    pid_rows = list(good_rows)
    pid_rows[50] = row(T0 + 30 * 50, pid=7)
    pid_run = run_cli(write_csv(tmp_path / "pid.csv", pid_rows))
    assert pid_run.returncode == 1
    assert "FAIL: pid changed 2 time(s)" in pid_run.stdout

    heap_run = run_cli(write_csv(tmp_path / "heap.csv", growth_rows(200, 8.0)))
    assert heap_run.returncode == 1
    assert "FAIL: java heap slope" in heap_run.stdout
    assert run_cli(write_csv(tmp_path / "heap2.csv", growth_rows(200, 8.0)), "--max-heap-slope-mb-per-hour", "10").returncode == 0
