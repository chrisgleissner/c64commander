#!/usr/bin/env python3
"""Grade what actually comes out of the phone's speaker, through a microphone.

Every other measurement in this campaign reads a counter the app itself maintains. This one does
not trust the app at all: the C64 plays a known pattern of beeps, the phone mirrors it, and a
microphone in the room hears the result. If the pipeline stutters, drops out or runs at the wrong
speed, it shows up here even when every counter reads clean.

The pattern is deliberately dull — a low note, on for a few hundred milliseconds, at a fixed
cadence the C64 itself sequences (so the timing is machine-accurate, not REST-accurate). Three
things are then measurable without knowing anything about the music:

  * **Dropouts** — the envelope collapsing part-way through a note that should be sustaining. This
    is what crackling and stuttering are, seen from outside.
  * **Cadence** — the spacing of note onsets. A pipeline that discards a backlog plays the next note
    early; one that conceals plays it late. Either way the interval stops being constant.
  * **Pitch** — the note's frequency. A resampler correcting drift too hard detunes the music, and
    a listener hears that as the tune wandering in speed.

Usage:
  mic_playback_quality.py record  [--seconds 20] [--device plughw:CARD=SF558,DEV=0] [--out FILE]
  mic_playback_quality.py analyse FILE [--expect-hz 110] [--cadence-ms 500]
"""

from __future__ import annotations

import argparse
import math
import subprocess
import sys
import wave

DEFAULT_DEVICE = "plughw:CARD=SF558,DEV=0"


def record(path: str, seconds: float, device: str) -> int:
    cmd = [
        "arecord", "-D", device, "-f", "S16_LE", "-r", "48000", "-c", "1",
        "-d", str(int(math.ceil(seconds))), path,
    ]
    print(" ".join(cmd))
    return subprocess.run(cmd, check=False).returncode


def read_wav(path: str) -> tuple[list[float], int]:
    with wave.open(path, "rb") as fh:
        rate = fh.getframerate()
        channels = fh.getnchannels()
        width = fh.getsampwidth()
        raw = fh.readframes(fh.getnframes())
    if width != 2:
        raise SystemExit(f"expected 16-bit audio, got {width * 8}-bit")
    samples = []
    step = 2 * channels
    for i in range(0, len(raw) - step + 1, step):
        v = int.from_bytes(raw[i : i + 2], "little", signed=True)
        samples.append(float(v))
    return samples, rate


def envelope(samples: list[float], rate: int, window_ms: float) -> tuple[list[float], float]:
    n = max(1, int(rate * window_ms / 1000))
    out = []
    for i in range(0, len(samples) - n + 1, n):
        acc = 0.0
        for s in samples[i : i + n]:
            acc += s * s
        out.append(math.sqrt(acc / n))
    return out, window_ms


def goertzel(samples: list[float], rate: int, hz: float) -> float:
    w = 2.0 * math.pi * hz / rate
    coeff = 2.0 * math.cos(w)
    s1 = s2 = 0.0
    for x in samples:
        s0 = x + coeff * s1 - s2
        s2, s1 = s1, s0
    return s1 * s1 + s2 * s2 - coeff * s1 * s2


def dominant_hz(samples: list[float], rate: int, near: float, span: float = 0.0) -> float:
    # Scan a musical interval either side by default, not a fixed few hertz: the point is to catch a
    # pipeline playing at the wrong speed, and "wrong speed" is proportional, not absolute.
    if span <= 0:
        span = near * 0.06
    best_hz, best_power = 0.0, -1.0
    hz = max(20.0, near - span)
    while hz <= near + span:
        power = goertzel(samples, rate, hz)
        if power > best_power:
            best_power, best_hz = power, hz
        hz += max(0.1, near / 2000.0)
    return best_hz


def analyse_sustained(path: str, expect_hz: float) -> int:
    """Grade a continuously-held tone: the cleanest possible probe for stuttering.

    A plucked note was a poor stimulus — its own decay crosses any envelope threshold on the way
    down, so the detector could not tell a note ending from the audio dropping out. A tone that
    simply stays on removes that ambiguity: nothing else in the signal moves, so every interruption
    is the pipeline.

    The measurement is a ratio, not a level. Counting windows that dip below the median of their own
    loudness sounds reasonable and is worthless: run against a SILENT room it reported 12% dropouts,
    because noise dips below its own median about that often. So each window is scored as the energy
    at the tone's frequency divided by the energy at a nearby frequency the tone does not occupy.
    Room noise raises both and cancels out; the tone stopping collapses the ratio. That also makes
    the grader honest about the trivial failure — with no tone playing, the ratio never rises, and it
    says so instead of inventing a dropout figure.
    """
    samples, rate = read_wav(path)
    if len(samples) < rate * 2:
        raise SystemExit("recording too short")

    # Skip the first second: the tone has to start and the pipeline has to prime.
    tone = samples[rate:]
    measured_hz = dominant_hz(tone[: rate * 4], rate, expect_hz)
    # A reference band a musical third away: same room, same microphone, no tone.
    ref_hz = measured_hz * 1.26

    win = int(rate * 20 / 1000)
    ratios = []
    for i in range(0, len(tone) - win + 1, win):
        chunk = tone[i : i + win]
        signal = math.sqrt(max(0.0, goertzel(chunk, rate, measured_hz)))
        noise = math.sqrt(max(1e-9, goertzel(chunk, rate, ref_hz)))
        ratios.append(signal / noise)

    ordered = sorted(ratios)
    median = ordered[len(ordered) // 2]
    print(f"recording       {len(samples) / rate:.1f}s at {rate} Hz")
    print(f"tone-to-room    {median:.1f}x at {measured_hz:.1f} Hz (reference band {ref_hz:.0f} Hz)")
    if median < 4.0:
        print("no tone present — nothing to grade (is the phone audible, and is the SID still sounding?)")
        return 2

    dips = [r for r in ratios if r < median * 0.25]
    severe = [r for r in ratios if r < median * 0.1]
    dropout_pct = 100.0 * len(dips) / len(ratios)
    cents = 1200 * math.log2(measured_hz / expect_hz)

    print(f"DROPOUTS        {dropout_pct:.2f}% of the held tone ({len(dips)} of {len(ratios)} x 20ms windows, {len(severe)} severe)")
    print(f"pitch           {measured_hz:.2f} Hz (expected {expect_hz:.2f}) = {cents:+.1f} cents")
    ok = dropout_pct < 1.0 and abs(cents) < 25
    print("VERDICT         " + ("clean" if ok else "BREAKING UP"))
    return 0 if ok else 1


def analyse(path: str, expect_hz: float, cadence_ms: float) -> int:
    samples, rate = read_wav(path)
    if len(samples) < rate:
        raise SystemExit("recording too short")
    env, win_ms = envelope(samples, rate, 5.0)
    peak = max(env)
    floor = sorted(env)[len(env) // 10]  # the quiet tenth: room noise
    if peak < floor * 3:
        print(f"no clear signal: peak {peak:.0f} vs noise floor {floor:.0f} — is the phone audible?")
        return 2

    # A note is "sounding" while the envelope is well above the room. The threshold sits between the
    # two so neither room noise nor the note's own decay tail is mistaken for the other.
    on_threshold = floor + (peak - floor) * 0.25
    off_threshold = floor + (peak - floor) * 0.12

    notes: list[tuple[int, int]] = []
    start = None
    for i, e in enumerate(env):
        if start is None and e > on_threshold:
            start = i
        elif start is not None and e < off_threshold:
            if (i - start) * win_ms >= 40:  # ignore clicks
                notes.append((start, i))
            start = None
    if start is not None and (len(env) - start) * win_ms >= 40:
        notes.append((start, len(env)))

    # A plucked SID note decays through the threshold and back, so one note can register as two or
    # three. Merge anything separated by less than a fraction of the cadence: what matters here is
    # where each note STARTED, and a decay tail is not a new onset.
    merged: list[tuple[int, int]] = []
    for span in notes:
        if merged and (span[0] - merged[-1][1]) * win_ms < cadence_ms * 0.4:
            merged[-1] = (merged[-1][0], span[1])
        else:
            merged.append(span)
    notes = merged

    if len(notes) < 3:
        print(f"only {len(notes)} notes detected — cannot grade the cadence")
        return 2

    # Dropouts: the envelope collapsing inside a note that should be holding.
    dropout_windows = 0
    sustained_windows = 0
    for a, b in notes:
        body = env[a + 4 : b - 2]  # skip the attack and the release tail
        if len(body) < 6:
            continue
        median = sorted(body)[len(body) // 2]
        for e in body:
            sustained_windows += 1
            if e < median * 0.4:
                dropout_windows += 1

    onsets_ms = [a * win_ms for a, _ in notes]
    intervals = [b - a for a, b in zip(onsets_ms, onsets_ms[1:])]
    mean_interval = sum(intervals) / len(intervals)
    jitter = math.sqrt(sum((i - mean_interval) ** 2 for i in intervals) / len(intervals))

    # Pitch off the longest note: the more cycles the Goertzel sees, the sharper its answer.
    a, b = max(notes, key=lambda span: span[1] - span[0])
    body = samples[int((a + 2) * win_ms * rate / 1000) : int((b - 1) * win_ms * rate / 1000)]
    measured_hz = dominant_hz(body, rate, expect_hz) if len(body) > rate // 20 else 0.0

    dropout_pct = 100.0 * dropout_windows / max(1, sustained_windows)
    print(f"recording       {len(samples) / rate:.1f}s at {rate} Hz")
    print(f"notes detected  {len(notes)}   signal {peak:.0f} over noise floor {floor:.0f}")
    print(f"DROPOUTS        {dropout_pct:.2f}% of sustained audio ({dropout_windows} of {sustained_windows} × {win_ms:.0f}ms windows)")
    print(f"cadence         mean {mean_interval:.0f} ms (expected {cadence_ms:.0f}), jitter {jitter:.1f} ms")
    print(f"pitch           {measured_hz:.1f} Hz (expected {expect_hz:.1f})")

    ok = dropout_pct < 1.0 and jitter < cadence_ms * 0.1
    print("VERDICT         " + ("clean" if ok else "BREAKING UP"))
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--seconds", type=float, default=20.0)
    r.add_argument("--device", default=DEFAULT_DEVICE)
    r.add_argument("--out", default="/tmp/mic-capture.wav")
    a = sub.add_parser("analyse")
    a.add_argument("file")
    a.add_argument("--expect-hz", type=float, default=110.0)
    a.add_argument("--cadence-ms", type=float, default=500.0)
    a.add_argument("--sustained", action="store_true", help="grade a continuously-held tone")
    args = ap.parse_args()
    if args.cmd == "record":
        rc = record(args.out, args.seconds, args.device)
        print(args.out)
        return rc
    if args.sustained:
        return analyse_sustained(args.file, args.expect_hz)
    return analyse(args.file, args.expect_hz, args.cadence_ms)


if __name__ == "__main__":
    sys.exit(main())
