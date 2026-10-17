#!/usr/bin/env python3
"""Grade a soak microphone recording against reference renders of the tunes that were playing.

`soak_report.py` lists every silence in the recording, but a tune may contain silence of its own. This tool
renders each tune from an HVSC copy with sidplayfp, aligns the render with the recording and reports a silence
as a defect only where the reference is audible. Silence in both is reported as content. After each silence the
offset is re-estimated within +-10 s before the next segment is graded. Tunes that cannot be graded are listed with
a reason (unmatched, unrenderable, weak alignment).

Usage:
  soak_reference_diff.py SAMPLES.csv --wav FILE --hvsc-root C64Music [--wav-start-epoch N]
                         [--sidplayfp sidplayfp] [--render-dir DIR] [--below-db 30] [--min-seconds 3] [--json FILE]

Exit status 1 when at least one defect exists.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import pathlib
import subprocess
import sys
import tempfile

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent


def load_sibling(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


soak = load_sibling("soak_report")
mic = soak.mic

SEARCH_RADIUS_SECONDS = 45
INITIAL_ALIGN_SECONDS = 40
REALIGN_RADIUS_SECONDS = 10
REALIGN_WINDOW_SECONDS = 30
RENDER_MARGIN_SECONDS = 15
MIN_ALIGN_SECONDS = 10
WEAK_CORRELATION = 0.5
AUDIBLE_WITHIN_DB = 10.0
LEVEL_FLOOR_BELOW_P90_DB = 60.0
HEADER_NAME_SLICE = slice(0x16, 0x36)


class RenderError(Exception):
    pass


def title_key(text: str) -> str:
    return text.replace("_", " ").strip().lower()


def header_name(path: pathlib.Path) -> str:
    with open(path, "rb") as handle:
        header = handle.read(0x36)
    return header[HEADER_NAME_SLICE].split(b"\0", 1)[0].decode("latin-1")


def build_index(root: str) -> dict[str, list[pathlib.Path]]:
    index: dict[str, list[pathlib.Path]] = {}
    for directory, _, names in os.walk(root):
        for name in sorted(names):
            if not name.lower().endswith(".sid"):
                continue
            path = pathlib.Path(directory) / name
            keys = {title_key(path.stem)}
            if len(path.read_bytes()[:0x36]) >= 0x36:
                keys.add(title_key(header_name(path)))
            for key in keys - {""}:
                index.setdefault(key, []).append(path)
    return index


def render_with_sidplayfp(sid_path: pathlib.Path, seconds: int, out_path: pathlib.Path, sidplayfp: str) -> None:
    command = [sidplayfp, "-q", f"-t{seconds}", f"-w{out_path}", str(sid_path)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=max(120, seconds * 4))
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RenderError(f"{' '.join(command)}: {error}") from error
    if result.returncode != 0 or not out_path.exists():
        raise RenderError(result.stderr.strip() or f"{sidplayfp} exited {result.returncode}")


def cached_render_levels(sid_path, seconds, render_dir, renderer, sidplayfp) -> np.ndarray:
    digest = hashlib.sha1(str(sid_path).encode()).hexdigest()[:10]
    out_path = pathlib.Path(render_dir) / f"{sid_path.stem}-{digest}-{seconds}s.wav"
    if not out_path.exists():
        partial = out_path.with_suffix(".partial.wav")
        renderer(sid_path, seconds, partial, sidplayfp)
        partial.replace(out_path)
    rate, blocks = mic.read_wav_blocks(str(out_path))
    return mic.stream_levels_db(blocks, rate)


def clipped(series: np.ndarray) -> np.ndarray:
    return np.maximum(series, np.percentile(series, 90) - LEVEL_FLOOR_BELOW_P90_DB)


def correlation(a: np.ndarray, b: np.ndarray) -> float:
    a, b = clipped(a), clipped(b)
    if a.std() < 1e-9 or b.std() < 1e-9:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def align(recording: np.ndarray, reference: np.ndarray, estimate: int, length: int, radius: int = SEARCH_RADIUS_SECONDS) -> tuple[int, float]:
    """Offset into the recording, within the search radius of the estimate, where its levels best follow the reference."""
    length = min(length, len(reference))
    best_offset, best = estimate, -2.0
    candidates = sorted(range(estimate - radius, estimate + radius + 1), key=lambda o: abs(o - estimate))
    for offset in candidates:
        if offset < 0:
            continue
        span = min(length, len(recording) - offset)
        if span < MIN_ALIGN_SECONDS:
            continue
        score = correlation(recording[offset : offset + span], reference[:span])
        if score > best:
            best_offset, best = offset, score
    return best_offset, max(best, 0.0) if best > -2.0 else 0.0


def runs_of(mask: np.ndarray, min_seconds: int) -> list[tuple[int, int]]:
    runs = []
    index = 0
    while index < len(mask):
        if not mask[index]:
            index += 1
            continue
        end = index
        while end < len(mask) and mask[end]:
            end += 1
        if end - index >= min_seconds:
            runs.append((index, end - index))
        index = end
    return runs


def grade_segment(recording: np.ndarray, reference: np.ndarray, below_db: float, min_seconds: int) -> tuple[list, list]:
    """(defects, content silences) as (second into the tune, seconds) runs."""
    recording_quiet = recording < np.percentile(recording, 90) - below_db
    reference_p90 = np.percentile(reference, 90)
    audible = reference >= reference_p90 - AUDIBLE_WITHIN_DB
    reference_silent = reference < reference_p90 - below_db
    return runs_of(recording_quiet & audible, min_seconds), runs_of(recording_quiet & reference_silent, min_seconds)


def realign_after_silences(recording: np.ndarray, reference: np.ndarray, offset: int, span: int, below_db: float, min_seconds: int):
    """Follow the reference through the recording, re-estimating the offset after every silence.

    Returns the reference levels placed on the recording's own time axis for [offset, offset + span), and the
    list of offset changes. A silence is mapped with the offset in force before it, so a pause the reference
    does not contain is still compared against audible reference.
    """
    window = recording[offset : offset + span]
    silences = runs_of(window < np.percentile(window, 90) - below_db, min_seconds)
    floor = float(np.min(reference))
    segments = []
    current = offset
    realignments = []
    for start, length in silences:
        end = offset + start + length
        segments.append((end, current))
        remaining = min(REALIGN_WINDOW_SECONDS, offset + span - end)
        if remaining < MIN_ALIGN_SECONDS:
            continue
        best_offset, best = current, -2.0
        for candidate in sorted(range(current - REALIGN_RADIUS_SECONDS, current + REALIGN_RADIUS_SECONDS + 1), key=lambda o: abs(o - current)):
            ref_start = end - candidate
            if ref_start < 0 or ref_start + remaining > len(reference):
                continue
            score = correlation(recording[end : end + remaining], reference[ref_start : ref_start + remaining])
            if score > best:
                best_offset, best = candidate, score
        if best_offset != current and best >= WEAK_CORRELATION:
            realignments.append({"wav_second": end, "shift_s": best_offset - current, "correlation": best})
            current = best_offset
            segments[-1] = (end, current)
    mapped = np.full(span, floor)
    boundaries = [(offset, offset)] + [(end, off) for end, off in segments]
    for index, (from_second, segment_offset) in enumerate(boundaries):
        until = boundaries[index + 1][0] if index + 1 < len(boundaries) else offset + span
        for second in range(from_second, until):
            reference_index = second - segment_offset
            if 0 <= reference_index < len(reference):
                mapped[second - offset] = reference[reference_index]
    return mapped, realignments


def initial_align_length(recording: np.ndarray, estimate: int, window: int, below_db: float, min_seconds: int) -> int:
    """How much of the tune to align on first: up to INITIAL_ALIGN_SECONDS, stopping at the first silence after the estimate."""
    length = min(window, INITIAL_ALIGN_SECONDS)
    head = recording[max(estimate, 0) : max(estimate, 0) + length]
    if len(head) < MIN_ALIGN_SECONDS:
        return length
    silences = runs_of(head < np.percentile(head, 90) - below_db, min_seconds)
    if silences and silences[0][0] >= MIN_ALIGN_SECONDS:
        return silences[0][0]
    return length


def tune_windows(samples) -> list[dict]:
    timeline = soak.tune_timeline(samples)
    gaps = [b.ts - a.ts for a, b in zip(samples, samples[1:]) if b.ts > a.ts]
    interval = int(np.median(gaps)) if gaps else 30
    ends = [start for start, _ in timeline[1:]] + [samples[-1].ts + interval]
    return [{"title": title, "start_ts": start, "end_ts": end} for (start, title), end in zip(timeline, ends)]


def grade_tune(tune, recording, wav_start_epoch, index, renderer, render_dir, sidplayfp, below_db, min_seconds) -> dict:
    window = tune["end_ts"] - tune["start_ts"]
    estimate = tune["start_ts"] - wav_start_epoch
    result = {**tune, "window_s": window, "status": None, "file": None, "offset_s": None, "correlation": None, "reason": None, "realignments": [], "defects": [], "content_silences": []}
    candidates = index.get(title_key(tune["title"]), [])
    if not candidates:
        result["status"] = "unmatched"
        result["reason"] = "no .sid in the HVSC copy has this title"
        return result
    seconds = math.ceil(window) + RENDER_MARGIN_SECONDS
    best = None
    errors = []
    for candidate in candidates:
        try:
            reference = cached_render_levels(candidate, seconds, render_dir, renderer, sidplayfp)
        except RenderError as error:
            errors.append(f"{candidate}: {error}")
            continue
        offset, score = align(recording, reference, estimate, initial_align_length(recording, estimate, window, below_db, min_seconds))
        if best is None or score > best[0]:
            best = (score, offset, reference, candidate)
    if best is None:
        result["status"] = "unrenderable"
        result["error"] = "; ".join(errors)
        result["reason"] = f"every candidate failed to render: {result['error']}"
        return result
    score, offset, reference, candidate = best
    result.update({"file": str(candidate), "offset_s": offset, "correlation": score})
    span = min(window, len(reference), len(recording) - offset)
    if span < MIN_ALIGN_SECONDS or score < WEAK_CORRELATION:
        result["status"] = "weak alignment"
        result["reason"] = (
            f"recording is too short to align ({span} s)" if span < MIN_ALIGN_SECONDS
            else f"correlation {score:.2f} is below {WEAK_CORRELATION}"
        )
        return result
    mapped, realignments = realign_after_silences(recording, reference, offset, span, below_db, min_seconds)
    defects, content = grade_segment(recording[offset : offset + span], mapped, below_db, min_seconds)
    result["status"] = "graded"
    result["realignments"] = realignments
    result["defects"] = [{"tune_second": start, "seconds": length, "wav_second": offset + start} for start, length in defects]
    result["content_silences"] = [{"tune_second": start, "seconds": length} for start, length in content]
    return result


def build_report(samples, recording, wav_start_epoch, index, renderer, render_dir, sidplayfp, below_db, min_seconds) -> dict:
    tunes = [
        grade_tune(tune, recording, wav_start_epoch, index, renderer, render_dir, sidplayfp, below_db, min_seconds)
        for tune in tune_windows(samples)
    ]
    defects = [{"title": t["title"], **d} for t in tunes for d in t["defects"]]
    return {
        "tunes": tunes,
        "defects": defects,
        "totals": {
            "tunes": len(tunes),
            "graded": sum(t["status"] == "graded" for t in tunes),
            "unmatched": sum(t["status"] == "unmatched" for t in tunes),
            "unrenderable": sum(t["status"] == "unrenderable" for t in tunes),
            "weak_alignment": sum(t["status"] == "weak alignment" for t in tunes),
            "content_silences": sum(len(t["content_silences"]) for t in tunes),
            "defects": len(defects),
            "graded_fraction": (sum(t["status"] == "graded" for t in tunes) / len(tunes)) if tunes else 0.0,
        },
        "ungradable": [{"title": t["title"], "status": t["status"], "reason": t["reason"]} for t in tunes if t["status"] != "graded"],
    }


def format_report(report: dict) -> list[str]:
    lines = []
    for tune in report["tunes"]:
        head = f"{tune['title']}: window {tune['window_s']} s"
        if tune["status"] in ("unmatched", "unrenderable"):
            detail = tune.get("error", "")
            lines.append(f"{head}, {tune['status']}{': ' + detail if detail else ''}")
            continue
        corr = f"{tune['correlation']:.2f}"
        grade = "weak alignment, not graded" if tune["status"] == "weak alignment" else (
            f"{len(tune['content_silences'])} content silence(s), {len(tune['defects'])} defect(s)"
        )
        lines.append(f"{head}, correlation {corr}, {grade}")
    lines.append(f"{len(report['defects'])} defect(s)")
    for defect in report["defects"]:
        lines.append(f"  {defect['title']}: {defect['seconds']} s at {defect['tune_second']} s into the tune (wav {defect['wav_second']} s)")
    totals = report["totals"]
    lines.append(
        f"totals: {totals['tunes']} tunes, {totals['graded']} graded, {totals['unmatched']} unmatched, {totals['unrenderable']} unrenderable, "
        f"{totals['weak_alignment']} weak alignment, {totals['content_silences']} content silences, {totals['defects']} defects"
    )
    if report["ungradable"]:
        lines.append(f"{len(report['ungradable'])} tune(s) not graded:")
        for entry in report["ungradable"]:
            lines.append(f"  {entry['title']}: {entry['status']} - {entry['reason']}")
    lines.append(f"graded {totals['graded']} of {totals['tunes']} tunes ({totals['graded_fraction'] * 100:.0f}%)")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv")
    parser.add_argument("--wav", required=True)
    parser.add_argument("--wav-start-epoch", type=int)
    parser.add_argument("--hvsc-root", required=True)
    parser.add_argument("--sidplayfp", default="sidplayfp")
    parser.add_argument("--render-dir")
    parser.add_argument("--below-db", type=float, default=30.0)
    parser.add_argument("--min-seconds", type=int, default=3)
    parser.add_argument("--json")
    args = parser.parse_args()

    samples = soak.read_samples(args.csv)
    wav_start = samples[0].ts if args.wav_start_epoch is None else args.wav_start_epoch
    rate, blocks = mic.read_wav_blocks(args.wav)
    recording = mic.stream_levels_db(blocks, rate)
    index = build_index(args.hvsc_root)
    render_dir = args.render_dir or tempfile.mkdtemp(prefix="soak-renders-")
    pathlib.Path(render_dir).mkdir(parents=True, exist_ok=True)
    report = build_report(samples, recording, wav_start, index, render_with_sidplayfp, render_dir, args.sidplayfp, args.below_db, args.min_seconds)
    print("\n".join(format_report(report)))
    if args.json:
        with open(args.json, "w") as handle:
            json.dump(report, handle, indent=2)
    return 1 if report["defects"] else 0


if __name__ == "__main__":
    sys.exit(main())
