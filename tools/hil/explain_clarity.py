#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
"""Say what was heard when `av-clarity` reports tones out of order.

The gate's verdict "N tones arrived out of order" is a count. This prints the recording it came
from as a timeline, one row per tone burst — the note the ladder expected, the note the grader read,
the pitch actually measured, the onset, the length and the level — and then, for every sequence
error, what was heard instead:

  replay      an earlier tone came again: audio was repeated or stalled in the playback path
  dropped     a tone is missing and the next one came one slot later: audio was discarded
  silent      a tone is missing but the time it should have taken passed: its slot was silent
  undetected  a tone is missing in the read, but its pitch IS in the recording at that slot: the
              grader missed it
  between     the burst's pitch lies between two ladder notes: a detector or resampling error
  noise       the burst's pitch is not a ladder note at all: something in the room
  follow-on   the second half of an error already explained by the burst before it

Bursts are found by `audio_e2e_probe.detect_bursts`, the grader's own detector, so the errors
explained here are the ones the verdict counted. When the kept run also holds the wire capture of
the same span, it is graded the same way, which separates "the Ultimate sent it out of order" from
"the phone played it out of order".

Usage:
  explain_clarity.py <kept-run-dir | stage-dir | recording.wav> [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio_e2e_probe import ON_MS, SLOT_MS, TONES_HZ, detect_bursts, goertzel, read_wav  # noqa: E402

LADDER_TOLERANCE = 0.03
BAND = (300.0, 6000.0)
# A missing tone whose own pitch at its slot is within this of the median burst was there to hear.
PRESENT_WITHIN_DB = 12.0


def _band_limited(segment: np.ndarray, rate: int) -> np.ndarray:
    spectrum = np.fft.rfft(segment)
    freqs = np.fft.rfftfreq(len(segment), 1.0 / rate)
    spectrum[(freqs < BAND[0]) | (freqs > BAND[1])] = 0
    return np.fft.irfft(spectrum, n=len(segment))


def dominant_hz(segment: np.ndarray, rate: int) -> float:
    """The strongest frequency in 300-6000 Hz, to a fraction of a hertz (Hann window, zero-padded)."""
    windowed = (segment - segment.mean()) * np.hanning(len(segment))
    size = 1 << max(16, int(math.ceil(math.log2(len(segment)))) + 3)
    spectrum = np.abs(np.fft.rfft(windowed, n=size))
    freqs = np.fft.rfftfreq(size, 1.0 / rate)
    spectrum[(freqs < BAND[0]) | (freqs > BAND[1])] = 0
    return float(freqs[int(np.argmax(spectrum))])


def level_dbfs(segment: np.ndarray, rate: int) -> float:
    rms = float(np.sqrt(np.mean(_band_limited(segment, rate) ** 2))) if len(segment) else 0.0
    return 20 * math.log10(max(rms, 1e-9) / 32768.0)


def nearest_tone(hz: float) -> tuple[int, float]:
    """The ladder note nearest `hz`, and how far off it is as a fraction."""
    index = min(range(len(TONES_HZ)), key=lambda t: abs(hz - TONES_HZ[t]))
    return index, abs(hz - TONES_HZ[index]) / TONES_HZ[index]


def pitch_class(hz: float) -> str:
    """`ladder`, `between` (inside the ladder's range but on no note) or `noise` (outside it)."""
    _, off = nearest_tone(hz)
    if off <= LADDER_TOLERANCE:
        return "ladder"
    low, high = TONES_HZ[0] * (1 - LADDER_TOLERANCE), TONES_HZ[-1] * (1 + LADDER_TOLERANCE)
    return "between" if low <= hz <= high else "noise"


def timeline(samples: list[float], rate: int) -> list[dict]:
    """One row per burst the grader read, with the measurements a sequence error is explained from."""
    signal = np.asarray(samples, dtype=np.float64)
    rows: list[dict] = []
    for index, (onset, offset, tone) in enumerate(detect_bursts(samples, rate)):
        body = signal[onset:max(offset, onset + 64)]
        measured = dominant_hz(body, rate)
        rows.append(
            {
                "index": index,
                "onsetS": onset / rate,
                "onsetSample": onset,
                "durationMs": (offset - onset) / rate * 1000,
                "tone": tone,
                "toneHz": TONES_HZ[tone],
                "measuredHz": round(measured, 1),
                "pitchClass": pitch_class(measured),
                "levelDbfs": round(level_dbfs(body, rate), 1),
                "expectedTone": None if index == 0 else (rows[-1]["tone"] + 1) % len(TONES_HZ),
                "intervalSlots": None if index == 0 else (onset / rate - rows[-1]["onsetS"]) * 1000 / SLOT_MS,
            }
        )
    return rows


def _tone_level_at(signal: list[float], rate: int, tone: int, start: int) -> float:
    count = int(rate * ON_MS / 1000)
    if start < 0 or start + count > len(signal):
        return float("-inf")
    return 20 * math.log10(max(goertzel(signal, rate, TONES_HZ[tone], start, count), 1e-9))


def classify(rows: list[dict], samples: list[float], rate: int) -> list[dict]:
    """Every sequence error the grader counted, with what was heard instead."""
    count = len(TONES_HZ)
    burst_levels = sorted(
        _tone_level_at(samples, rate, row["tone"], row["onsetSample"]) for row in rows if row["pitchClass"] == "ladder"
    )
    typical = burst_levels[len(burst_levels) // 2] if burst_levels else float("-inf")
    errors: list[dict] = []
    for prev, cur in zip(rows, rows[1:]):
        expected = (prev["tone"] + 1) % count
        if cur["tone"] == expected:
            continue
        error = {
            "atS": round(cur["onsetS"], 3),
            "previousHz": prev["toneHz"],
            "expectedHz": TONES_HZ[expected],
            "readHz": cur["toneHz"],
            "measuredHz": cur["measuredHz"],
            "intervalSlots": round(cur["intervalSlots"], 2),
        }
        forward = (cur["tone"] - expected) % count
        back = (expected - cur["tone"]) % count
        if prev["pitchClass"] != "ladder":
            error["kind"] = "follow-on"
            error["why"] = "the burst before this one was not a ladder note; this error is the same event"
        elif cur["pitchClass"] == "noise":
            error["kind"] = "noise"
            error["why"] = f"measured {cur['measuredHz']} Hz, which is no ladder note: a sound in the room"
        elif cur["pitchClass"] == "between":
            error["kind"] = "between"
            error["why"] = (
                f"measured {cur['measuredHz']} Hz, between ladder notes: the detector read it as "
                f"{cur['toneHz']} Hz (a detector or resampling error)"
            )
        elif back <= 3:
            error["kind"] = "replay"
            error["why"] = (
                f"the ladder went back {back} slot(s) to {cur['toneHz']} Hz: audio was repeated or stalled in the playback path"
            )
        else:
            missing = [TONES_HZ[(expected + k) % count] for k in range(forward)]
            slots = cur["intervalSlots"]
            if abs(slots - 1) < 0.35:
                error["kind"] = "dropped"
                error["why"] = f"{missing} missing and the next tone came one slot later: that audio was discarded"
            else:
                slot = int(round(rate * SLOT_MS / 1000))
                heard = [
                    _tone_level_at(samples, rate, (expected + k) % count, prev["onsetSample"] + (k + 1) * slot)
                    for k in range(forward)
                ]
                present = all(level >= typical - PRESENT_WITHIN_DB for level in heard)
                error["kind"] = "undetected" if present else "silent"
                error["why"] = (
                    f"{missing} missing over {slots:.2f} slots; their pitch "
                    + ("IS at the expected place: the grader missed it" if present else "is absent: the slot was silent")
                )
        errors.append(error)
    return errors


def explain_wav(path: Path) -> dict:
    samples, rate = read_wav(str(path))
    rows = timeline(samples, rate)
    errors = classify(rows, samples, rate)
    kinds: dict[str, int] = {}
    for error in errors:
        kinds[error["kind"]] = kinds.get(error["kind"], 0) + 1
    return {"file": str(path), "rate": rate, "bursts": rows, "sequenceErrors": errors, "kinds": kinds}


def resolve_inputs(target: Path) -> tuple[Path, Path | None, Path | None]:
    """The mic WAV, the wire WAV and the probe log for a kept run, a stage directory or a bare WAV."""
    if target.is_file():
        return target, None, None
    stage = target / "av-clarity" if (target / "av-clarity").is_dir() else target
    mic = stage / "mic.wav"
    if not mic.is_file():
        raise SystemExit(f"no mic.wav in {stage}")
    wire = stage / "wire.wav"
    probe = stage / "probe.txt"
    return mic, wire if wire.is_file() else None, probe if probe.is_file() else None


def print_report(report: dict, label: str) -> None:
    print(f"== {label}: {report['file']}")
    print(" #    onset  expected  read   measured   class    length   level  interval")
    for row in report["bursts"]:
        expected = "" if row["expectedTone"] is None else f"{TONES_HZ[row['expectedTone']]}"
        interval = "" if row["intervalSlots"] is None else f"{row['intervalSlots']:.2f} slot"
        flag = "  <--" if row["expectedTone"] is not None and row["expectedTone"] != row["tone"] else ""
        print(
            f"{row['index']:3d} {row['onsetS']:7.3f}s {expected:>8} {row['toneHz']:6d} {row['measuredHz']:8.1f}Hz "
            f"{row['pitchClass']:>8} {row['durationMs']:6.1f}ms {row['levelDbfs']:6.1f}dB {interval:>10}{flag}"
        )
    print(f"sequence errors {len(report['sequenceErrors'])}  {report['kinds']}")
    for error in report["sequenceErrors"]:
        print(f"  t={error['atS']:7.3f}s  {error['kind']:<10} {error['why']}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", type=Path)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()

    mic, wire, probe = resolve_inputs(args.target)
    result = {"mic": explain_wav(mic)}
    print_report(result["mic"], "microphone")
    if wire is not None:
        result["wire"] = explain_wav(wire)
        print()
        print_report(result["wire"], "wire (what the Ultimate sent)")
    if probe is not None:
        verdict = [line for line in probe.read_text().splitlines() if line.startswith(("bursts read", "VERDICT"))]
        print("\nprobe said: " + " | ".join(verdict))

    mic_errors = len(result["mic"]["sequenceErrors"])
    if wire is not None and mic_errors:
        wire_errors = len(result["wire"]["sequenceErrors"])
        print(
            "\nCONCLUSION  "
            + (
                "the wire was in order over this span, so the disorder arose between the wire and the speaker"
                if wire_errors == 0
                else f"the wire itself shows {wire_errors} sequence error(s); check the sender before the app"
            )
        )
    if args.json:
        args.json.write_text(json.dumps(result, indent=2) + "\n")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
