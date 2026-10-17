#!/usr/bin/env python3
"""Summarise an on-device soak: sampler CSV plus an optional microphone recording.

The CSV has one row about every 30 s with the header
  ts,pid,pss_total_kb,java_heap_kb,native_heap_kb,loadavg,battery_c10,media_state,media_title
and reports tune changes, app process restarts, memory slope over the last 75 percent of the samples,
and (with --wav) every run of silence mapped to the tune that was playing and its offset into it.

Usage:
  soak_report.py SAMPLES.csv [--wav FILE] [--wav-start-epoch N] [--min-seconds 3] [--below-db 30]
                 [--max-heap-slope-mb-per-hour 5] [--json FILE]

Exit status 1 when the pid changed or vanished, a silence of 8 s or more exists, or the java heap slope
is not below the limit.
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import pathlib
import sys
from typing import NamedTuple

import numpy as np

SPEC = importlib.util.spec_from_file_location("mic_silence_runs", pathlib.Path(__file__).resolve().parent / "mic_silence_runs.py")
mic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mic)

HEADER = ["ts", "pid", "pss_total_kb", "java_heap_kb", "native_heap_kb", "loadavg", "battery_c10", "media_state", "media_title"]
MIN_SLOPE_SAMPLES = 20
WARMUP_FRACTION = 0.25
LONG_SILENCE_SECONDS = 8
TUNE_TAIL_SECONDS = 45


class Sample(NamedTuple):
    ts: int
    pid: int | None
    pss_kb: float | None
    java_kb: float | None
    title: str


def optional_number(text: str, kind=float):
    text = text.strip()
    return kind(text) if text else None


def read_samples(path: str) -> list[Sample]:
    with open(path, newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != HEADER:
            raise ValueError(f"{path}: expected header {','.join(HEADER)}, got {','.join(reader.fieldnames or [])}")
        samples = [
            Sample(
                ts=int(row["ts"]),
                pid=optional_number(row["pid"], int),
                pss_kb=optional_number(row["pss_total_kb"]),
                java_kb=optional_number(row["java_heap_kb"]),
                title=row["media_title"].strip(),
            )
            for row in reader
        ]
    if not samples:
        raise ValueError(f"{path}: no samples")
    return samples


def tune_timeline(samples: list[Sample]) -> list[tuple[int, str]]:
    """(first ts, title) for each stretch of one title; rows without a title do not end a stretch."""
    timeline: list[tuple[int, str]] = []
    for sample in samples:
        if sample.title and (not timeline or timeline[-1][1] != sample.title):
            timeline.append((sample.ts, sample.title))
    return timeline


def tune_at(timeline: list[tuple[int, str]], epoch: float):
    """(title, start, end) of the tune playing at epoch; end is None for the last tune."""
    found = None
    for index, (start, title) in enumerate(timeline):
        if start <= epoch:
            end = timeline[index + 1][0] if index + 1 < len(timeline) else None
            found = (title, start, end)
    return found


def process_identity(samples: list[Sample]) -> dict:
    pids: list[int] = []
    changes: list[dict] = []
    for sample in samples:
        if sample.pid is None:
            continue
        if pids and pids[-1] != sample.pid:
            changes.append({"ts": sample.ts, "from": pids[-1], "to": sample.pid})
        if not pids or pids[-1] != sample.pid:
            pids.append(sample.pid)
    absent = [sample.ts for sample in samples if sample.pid is None]
    return {
        "distinct_pids": len(set(pids)),
        "pid_changes": changes,
        "absent_samples": len(absent),
        "first_absent_ts": absent[0] if absent else None,
    }


def memory_series(samples: list[Sample], field: str) -> dict:
    window = samples[int(len(samples) * WARMUP_FRACTION) :]
    points = [(s.ts, getattr(s, field)) for s in window if getattr(s, field) is not None]
    result = {"min_mb": None, "max_mb": None, "last_mb": None, "slope_mb_per_hour": None, "slope_note": None}
    if points:
        values = [value for _, value in points]
        result.update({"min_mb": min(values) / 1024, "max_mb": max(values) / 1024, "last_mb": values[-1] / 1024})
    if len(points) < MIN_SLOPE_SAMPLES:
        result["slope_note"] = f"too few samples ({len(points)} < {MIN_SLOPE_SAMPLES})"
        return result
    seconds = np.array([ts for ts, _ in points], dtype=float)
    kb = np.array([value for _, value in points], dtype=float)
    slope_kb_per_second = np.polyfit(seconds - seconds[0], kb, 1)[0]
    result["slope_mb_per_hour"] = float(slope_kb_per_second * 3600 / 1024)
    return result


def map_silent_runs(runs: list[tuple[int, int]], timeline: list[tuple[int, str]], wav_start_epoch: int) -> list[dict]:
    mapped = []
    for start, length in runs:
        epoch = wav_start_epoch + start
        entry = {"wav_second": start, "epoch": epoch, "seconds": length, "title": None, "approx_offset_s": None, "in_last_45s": None}
        playing = tune_at(timeline, epoch)
        if playing:
            title, tune_start, tune_end = playing
            entry["title"] = title
            entry["approx_offset_s"] = epoch - tune_start
            if tune_end is not None:
                entry["in_last_45s"] = epoch >= tune_end - TUNE_TAIL_SECONDS
        mapped.append(entry)
    return mapped


def failures(report: dict, max_heap_slope: float) -> list[str]:
    found = []
    process = report["process"]
    if process["distinct_pids"] > 1:
        found.append(f"pid changed {len(process['pid_changes'])} time(s): app process restarted")
    if process["absent_samples"]:
        found.append(f"process absent in {process['absent_samples']} sample(s), first at {process['first_absent_ts']}")
    for run in report["silent_runs"] or []:
        if run["seconds"] >= LONG_SILENCE_SECONDS:
            found.append(f"silence of {run['seconds']} s at wav second {run['wav_second']}")
    slope = report["java_heap"]["slope_mb_per_hour"]
    if slope is not None and slope >= max_heap_slope:
        found.append(f"java heap slope {slope:.2f} MB/h is not below {max_heap_slope:g} MB/h")
    return found


def build_report(samples: list[Sample], silent_runs: list[tuple[int, int]] | None, wav_start_epoch: int | None, max_heap_slope: float) -> dict:
    timeline = tune_timeline(samples)
    duration = samples[-1].ts - samples[0].ts
    changes = max(len(timeline) - 1, 0)
    report = {
        "duration_s": duration,
        "samples": len(samples),
        "tune_changes": changes,
        "tunes_per_hour": changes * 3600 / duration if duration > 0 else None,
        "process": process_identity(samples),
        "pss": memory_series(samples, "pss_kb"),
        "java_heap": memory_series(samples, "java_kb"),
        "silent_runs": None,
    }
    if silent_runs is not None:
        start = samples[0].ts if wav_start_epoch is None else wav_start_epoch
        report["silent_runs"] = map_silent_runs(silent_runs, timeline, start)
    report["failures"] = failures(report, max_heap_slope)
    return report


def format_series(name: str, series: dict) -> str:
    if series["slope_mb_per_hour"] is None:
        slope = series["slope_note"]
    else:
        slope = f"slope {series['slope_mb_per_hour']:+.2f} MB/h"
    if series["last_mb"] is None:
        return f"{name}: no values, {slope}"
    return f"{name}: min {series['min_mb']:.1f} max {series['max_mb']:.1f} last {series['last_mb']:.1f} MB, {slope}"


def format_report(report: dict) -> list[str]:
    process = report["process"]
    per_hour = "n/a" if report["tunes_per_hour"] is None else f"{report['tunes_per_hour']:.1f}"
    lines = [
        f"duration {report['duration_s']} s, {report['samples']} samples, {report['tune_changes']} tune changes, {per_hour} tunes/hour",
        f"distinct pids: {process['distinct_pids']}",
    ]
    lines += [f"  pid {change['from']} -> {change['to']} at {change['ts']}" for change in process["pid_changes"]]
    if process["absent_samples"]:
        lines.append(f"process absent in {process['absent_samples']} sample(s), first at {process['first_absent_ts']}")
    lines.append(format_series("pss_total", report["pss"]))
    lines.append(format_series("java_heap", report["java_heap"]))
    if report["silent_runs"] is not None:
        lines.append(f"{len(report['silent_runs'])} silent run(s)")
        for run in report["silent_runs"]:
            where = "no tune known" if run["title"] is None else f"'{run['title']}' about {run['approx_offset_s']} s in"
            lines.append(f"  wav {run['wav_second']} s (epoch {run['epoch']}) for {run['seconds']} s: {where}")
            tail = {True: "within", False: "not within", None: "unknown whether within"}[run["in_last_45s"]]
            lines.append(f"    {tail} the last 45 s of its tune")
    if report["failures"]:
        lines += [f"FAIL: {reason}" for reason in report["failures"]]
    else:
        lines.append("PASS")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv")
    parser.add_argument("--wav")
    parser.add_argument("--wav-start-epoch", type=int)
    parser.add_argument("--min-seconds", type=int, default=3)
    parser.add_argument("--below-db", type=float, default=30.0)
    parser.add_argument("--max-heap-slope-mb-per-hour", type=float, default=5.0)
    parser.add_argument("--json")
    args = parser.parse_args()

    samples = read_samples(args.csv)
    runs = None
    if args.wav:
        rate, blocks = mic.read_wav_blocks(args.wav)
        runs = mic.silent_runs(mic.stream_levels_db(blocks, rate), args.below_db, args.min_seconds)
    report = build_report(samples, runs, args.wav_start_epoch, args.max_heap_slope_mb_per_hour)
    print("\n".join(format_report(report)))
    if args.json:
        with open(args.json, "w") as handle:
            json.dump(report, handle, indent=2)
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
