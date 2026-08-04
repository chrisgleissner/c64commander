#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
"""Grade a recording of one steady tone coming out of the phone's speaker.

WHAT THIS IS FOR

Two of the merge gate's stages play the same generated tune two different ways — once rendered by
the Ultimate and carried by the mirror, once rendered by the on-device engine — and ask whether it
came out of the speaker intact. The two paths share nothing after the tune is chosen, and they have
sounded materially different before, so the comparison is only worth anything if both are measured
with one instrument in one room.

A steady tone is what makes that measurable. Real music cannot settle it: a listener cannot tell a
stall from a rest, and neither can a detector, which is why the campaign's other graders all use a
generated stimulus too. Here the tune holds one pitch, so three questions have arithmetic answers:

  * **Is it there** — the fraction of the recording where the tone is present.
  * **Is it continuous** — the longest stretch where it is not, which is what a dropout is.
  * **Is it in tune** — the pitch error in cents. A resampler correcting drift too hard detunes the
    music, and a listener hears that as the tune wandering in speed.

TWO TRAPS THIS AVOIDS

Presence is measured against the tone's OWN peak in this recording, never a shared threshold. The
two playback paths do not reach the microphone equally — level is itself a finding — and a shared
threshold simply buries the quieter one and reports it absent.

Everything is band-limited to 300-6000 Hz. The room's noise here is almost all below 300 Hz, which
a phone speaker barely reproduces, so a broadband reading makes the fan look like signal and can
make a perfectly good recording look hopeless (AGENTS.md records an agent concluding exactly that).

USAGE

  steady_tone_grade.py FILE.wav --hz 550 [--min-present 0.90] [--max-gap-ms 120] [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
import wave

import numpy as np

#: Long enough for a clean estimate at these pitches, short enough that a gap already plainly
#: audible cannot hide inside one window.
WINDOW_SECONDS = 0.05

#: A window counts as holding the tone above this fraction of the tone's own peak across the run.
PRESENT_FRACTION = 0.10

#: ...and only if the tone also stands this far above the same window's out-of-band energy. The
#: fraction alone is a ratio against a peak that might itself be noise.
#:
#: 6 dB was not enough, and the way it failed is worth keeping: with nothing playing at all, the
#: loudest bin inside the search window around 550 Hz was room noise, it cleared a 6 dB margin often
#: enough to look present in 45% of windows, and the run was reported as a quiet tone 11 cents sharp
#: rather than as silence. A grader that can mistake a room for a tune is worse than no grader.
SNR_MARGIN_DB = 12.0

#: Below this the recording holds no tone at all, however loud the room is. Reported as its own
#: verdict, because "nothing is playing" and "the tone is too quiet to grade" have different causes
#: and different fixes, and conflating them sent one investigation after the wrong one.
ABSENT_FRACTION = 0.20

BAND = (300.0, 6000.0)


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as fh:
        if fh.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit PCM")
        rate = fh.getframerate()
        raw = fh.readframes(fh.getnframes())
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float64)
    channels = 1
    with wave.open(path, "rb") as fh:
        channels = fh.getnchannels()
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def grade(path: str, hz: float) -> dict:
    samples, rate = read_wav(path)
    window = int(rate * WINDOW_SECONDS)
    if len(samples) < window * 4:
        raise SystemExit(f"{path}: too short to grade")
    count = len(samples) // window

    tone_mag = np.zeros(count)
    noise_mag = np.zeros(count)
    peak_hz = np.zeros(count)
    for i in range(count):
        chunk = samples[i * window : (i + 1) * window]
        spectrum = np.abs(np.fft.rfft(chunk * np.hanning(len(chunk))))
        freqs = np.fft.rfftfreq(len(chunk), 1.0 / rate)
        in_band = (freqs >= BAND[0]) & (freqs <= BAND[1])
        # A window either side of the nominal pitch, so a tone a few cents off is still ITS tone
        # rather than counted as absent.
        near = np.abs(freqs - hz) <= max(15.0, hz * 0.03)
        tone_mag[i] = spectrum[near].max() if near.any() else 0.0
        peak_hz[i] = freqs[near][spectrum[near].argmax()] if near.any() else 0.0
        rest = in_band & ~near
        noise_mag[i] = np.sqrt((spectrum[rest] ** 2).mean()) if rest.any() else 0.0

    peak = tone_mag.max()
    if peak <= 0:
        raise SystemExit(f"{path}: nothing at {hz:g} Hz at all — was anything playing?")
    floor = peak * PRESENT_FRACTION
    snr_ok = tone_mag > noise_mag * (10 ** (SNR_MARGIN_DB / 20.0))
    present = (tone_mag >= floor) & snr_ok

    # The longest run of absent windows: one long hole is a dropout, scattered single windows are
    # the edges of the recording and the note's own attack.
    longest, run = 0, 0
    for ok in present:
        run = 0 if ok else run + 1
        longest = max(longest, run)

    # Pitch from the windows that actually held the tone, weighted by how loud each was, so a quiet
    # window of mostly noise cannot drag the estimate.
    weights = np.where(present, tone_mag, 0.0)
    measured = float((peak_hz * weights).sum() / weights.sum()) if weights.sum() > 0 else 0.0
    cents = 1200.0 * np.log2(measured / hz) if measured > 0 else float("nan")

    return {
        "file": path,
        "expected_hz": hz,
        "measured_hz": round(measured, 1),
        "cents": round(float(cents), 1),
        "present_fraction": round(float(present.mean()), 4),
        "longest_gap_ms": round(longest * WINDOW_SECONDS * 1000.0, 1),
        "seconds": round(len(samples) / rate, 2),
        "peak_dbfs": round(20 * np.log10(peak / (32768.0 * window)) if peak > 0 else -999, 1),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--hz", type=float, required=True)
    ap.add_argument("--min-present", type=float, default=0.90)
    ap.add_argument("--max-gap-ms", type=float, default=120.0)
    ap.add_argument("--max-cents", type=float, default=50.0)
    # Below this the tone is too close to the room to grade. A generated SID tone is far quieter
    # than the barcode stimulus the clarity stage uses, and at a low phone volume it lands near the
    # floor — where the presence test drifts in and out and reports a perfectly good pipeline as
    # full of dropouts. Refusing to grade is the honest answer; claiming a defect is not.
    ap.add_argument("--min-peak-dbfs", type=float, default=-60.0)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    result = grade(args.file, args.hz)
    if result["present_fraction"] < ABSENT_FRACTION:
        result["verdict"] = "NO TONE"
        result["faults"] = [
            f"no {args.hz:g} Hz tone in the recording — it is present in only "
            f"{result['present_fraction'] * 100:.1f}% of windows, which is what an empty room looks "
            f"like. Check that something is actually playing before reading anything else here"
        ]
        print(json.dumps(result) if args.json else f"VERDICT     {result['verdict']}  ({result['faults'][0]})")
        return 2
    if result["peak_dbfs"] < args.min_peak_dbfs:
        result["verdict"] = "TOO QUIET TO GRADE"
        result["faults"] = [
            f"the tone peaks at {result['peak_dbfs']} dBFS, below the {args.min_peak_dbfs} dBFS this "
            f"grader can separate from the room — raise the phone's volume (within the ceiling) or "
            f"move the microphone closer to the grille, then measure again"
        ]
        print(json.dumps(result) if args.json else f"VERDICT     {result['verdict']}  ({result['faults'][0]})")
        return 2
    faults = []
    if result["present_fraction"] < args.min_present:
        faults.append(f"tone present in only {result['present_fraction'] * 100:.1f}% of the recording")
    if result["longest_gap_ms"] > args.max_gap_ms:
        faults.append(f"longest dropout {result['longest_gap_ms']:.0f} ms")
    if not np.isnan(result["cents"]) and abs(result["cents"]) > args.max_cents:
        faults.append(f"pitch off by {result['cents']:.0f} cents")
    result["faults"] = faults
    result["verdict"] = "clean" if not faults else "DEFECTIVE"

    if args.json:
        print(json.dumps(result))
    else:
        print(f"file        {result['file']}  {result['seconds']}s")
        print(f"tone        {result['measured_hz']} Hz vs {result['expected_hz']:g} Hz = {result['cents']:+.1f} cents")
        print(f"present     {result['present_fraction'] * 100:.1f}% of windows, peak {result['peak_dbfs']} dBFS")
        print(f"longest gap {result['longest_gap_ms']:.0f} ms")
        print(f"VERDICT     {result['verdict']}" + (f"  ({'; '.join(faults)})" if faults else ""))
    return 0 if not faults else 1


if __name__ == "__main__":
    sys.exit(main())
