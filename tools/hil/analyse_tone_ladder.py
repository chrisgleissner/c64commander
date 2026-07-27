#!/usr/bin/env python3
"""Measure a tone-ladder capture note by note: pitch, timing, and dropouts.

Pairs with `make_tone_ladder_sid.py`, which emits a PSID playing C3→B3→C3 with a
deliberate silent frame between notes. That structure is what makes this exact
rather than statistical:

  - each note has ONE expected fundamental, so a wrong pitch is unambiguous;
  - each note is the same length, so a short one means audio was lost;
  - the silent frames mark onsets, so a gap INSIDE a note (a dropout) cannot be
    confused with the boundary between two notes.

Run it on a capture of the phone rendering the tune locally and on a capture of
the same tune streamed from the C64, and the difference between the two paths is
a table rather than an opinion.

    python3 tools/hil/analyse_tone_ladder.py capture.wav
"""

from __future__ import annotations

import argparse
import json
import sys
import wave

import numpy as np

# The ladder emitted by make_tone_ladder_sid.py.
NOTE_NAMES = ["C3", "C#3", "D3", "D#3", "E3", "F3", "F#3", "G3", "G#3", "A3", "A#3", "B3"]
NOTE_HZ = [220.0 * (2 ** ((i - 9) / 12.0)) for i in range(12)]
LADDER = list(range(12)) + list(range(10, -1, -1))
EXPECTED_HZ = [NOTE_HZ[n] for n in LADDER]
EXPECTED_NAMES = [NOTE_NAMES[n] for n in LADDER]
NOTE_SECONDS = 0.5

FRAME_MS = 10.0
# A phone speaker gives almost nothing below ~700 Hz, but these fundamentals are
# 130-247 Hz. The capture therefore carries them mostly as harmonics, so pitch is
# taken from the strongest peak in a band that includes the 2nd and 3rd harmonic
# and then folded back to the fundamental.
PITCH_MIN_HZ, PITCH_MAX_HZ = 100.0, 800.0


def load_mono(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        raw = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float64)
    if channels == 2:
        raw = raw.reshape(-1, 2).mean(axis=1)
    return raw / 32768.0, rate


def envelope(samples: np.ndarray, rate: int) -> tuple[np.ndarray, float]:
    step = max(1, int(rate * FRAME_MS / 1000.0))
    usable = (samples.size // step) * step
    frames = samples[:usable].reshape(-1, step)
    return 20.0 * np.log10(np.maximum(np.sqrt((frames**2).mean(axis=1)), 1e-9)), step / rate


def segment_notes(env: np.ndarray, frame_s: float) -> list[tuple[float, float]]:
    """Split on note ONSETS — the sharp level jump when a new note is gated on.

    Not on silence between notes, which was the first attempt: the SID's release
    still rings, so a gated-off note only ducks by ~8 dB and the whole ladder
    segments as one continuous block. The attack, by contrast, is a clean +11 dB
    step against the previous note's decayed tail, and it is exactly what marks
    the boundary the analysis needs.
    """
    sounding = env[env > -100.0]  # ignore digital silence (lead-in/lead-out)
    if sounding.size < 10:
        return []
    quiet_floor = float(np.percentile(sounding, 5))
    active = env > quiet_floor - 3.0

    # Rising edges: a frame at least 6 dB above the running level of the frames
    # just before it. 6 dB is comfortably under the observed ~11 dB attack step
    # and comfortably over the 1-3 dB ripple within a sustained note.
    onsets = []
    look_back = 3
    for i in range(look_back, len(env)):
        if not active[i]:
            continue
        previous = float(np.median(env[i - look_back : i]))
        if env[i] - previous >= 6.0 and (not onsets or (i - onsets[-1]) * frame_s > 0.2):
            onsets.append(i)
    if not onsets:
        return []

    notes = []
    for index, start in enumerate(onsets):
        end = onsets[index + 1] if index + 1 < len(onsets) else len(env)
        notes.append((start * frame_s, min(end, len(env)) * frame_s))
    return [(a, b) for a, b in notes if b - a >= 0.12]


def detect_pitch(segment: np.ndarray, rate: int) -> float:
    if segment.size < 512:
        return 0.0
    windowed = segment * np.hanning(segment.size)
    spectrum = np.abs(np.fft.rfft(windowed, n=1 << 16))
    freqs = np.fft.rfftfreq(1 << 16, 1 / rate)
    band = (freqs >= PITCH_MIN_HZ) & (freqs <= PITCH_MAX_HZ)
    if not band.any():
        return 0.0
    peak = float(freqs[band][np.argmax(spectrum[band])])
    # Fold harmonics back to the fundamental: the ladder lives in 130-247 Hz.
    while peak > 260.0:
        peak /= 2.0
    return peak


def cents(detected: float, expected: float) -> float:
    if detected <= 0 or expected <= 0:
        return 9999.0
    return 1200.0 * float(np.log2(detected / expected))


def analyse(path: str, tolerance_cents: float = 50.0) -> dict:
    samples, rate = load_mono(path)
    env, frame_s = envelope(samples, rate)
    notes = segment_notes(env, frame_s)
    if not notes:
        return {"usable": False, "reason": "no notes found — capture is silence or noise"}

    detected = []
    for start, end in notes:
        seg = samples[int(start * rate) : int(end * rate)]
        # Middle 60% avoids the attack and the release.
        inner = seg[int(len(seg) * 0.2) : int(len(seg) * 0.8)] if len(seg) > 1000 else seg
        detected.append({"startSeconds": round(start, 3), "seconds": round(end - start, 3), "hz": detect_pitch(inner, rate)})

    # Align the detected run against the ladder: the capture starts wherever the
    # listener happened to start recording, so the offset is searched, not assumed.
    best = {"offset": 0, "matched": -1}
    for offset in range(len(EXPECTED_HZ)):
        matched = 0
        for i, note in enumerate(detected):
            expected = EXPECTED_HZ[(offset + i) % len(EXPECTED_HZ)]
            if abs(cents(note["hz"], expected)) <= tolerance_cents:
                matched += 1
        if matched > best["matched"]:
            best = {"offset": offset, "matched": matched}

    offset = best["offset"]
    rows = []
    for i, note in enumerate(detected):
        idx = (offset + i) % len(EXPECTED_HZ)
        error = cents(note["hz"], EXPECTED_HZ[idx])
        rows.append(
            {
                "expected": EXPECTED_NAMES[idx],
                "expectedHz": round(EXPECTED_HZ[idx], 1),
                "detectedHz": round(note["hz"], 2),
                "cents": round(error, 1),
                "seconds": note["seconds"],
                "ok": abs(error) <= tolerance_cents,
            }
        )

    good = [r for r in rows if r["ok"]]
    durations = [r["seconds"] for r in rows]
    # A note materially shorter than 0.5 s lost audio; one materially longer means
    # two notes ran together because the silent frame between them vanished.
    short = [r for r in rows if r["seconds"] < NOTE_SECONDS * 0.7]
    long_ = [r for r in rows if r["seconds"] > NOTE_SECONDS * 1.4]
    return {
        "usable": True,
        "notesDetected": len(rows),
        "notesInTune": len(good),
        "inTunePct": round(100.0 * len(good) / max(1, len(rows)), 1),
        "medianCentsError": round(float(np.median([abs(r["cents"]) for r in rows])), 1),
        "medianNoteSeconds": round(float(np.median(durations)), 3),
        "shortNotes": len(short),
        "runTogetherNotes": len(long_),
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("capture")
    parser.add_argument("--tolerance-cents", type=float, default=50.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = analyse(args.capture, args.tolerance_cents)
    if args.json:
        print(json.dumps(result, indent=2))
        return 0
    if not result["usable"]:
        print(f"UNUSABLE: {result['reason']}")
        return 1
    print(f"notes detected   : {result['notesDetected']}")
    print(f"in tune (±{args.tolerance_cents:.0f}c) : {result['notesInTune']} ({result['inTunePct']}%)")
    print(f"median |cents|   : {result['medianCentsError']}")
    print(f"median duration  : {result['medianNoteSeconds']}s (expected {NOTE_SECONDS})")
    print(f"short notes      : {result['shortNotes']}  (audio lost inside a note)")
    print(f"run-together     : {result['runTogetherNotes']}  (note boundary lost)")
    print("\n  expected  detected     cents   seconds")
    for r in result["rows"]:
        flag = "" if r["ok"] else "  <-- OFF"
        print(f"  {r['expected']:>8} {r['detectedHz']:9.2f} {r['cents']:+8.1f} {r['seconds']:9.3f}{flag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
