#!/usr/bin/env python3
"""Grade a track change recorded from a microphone: is it seamless, and does it crossfade?

Two tunes holding steady, well-separated tones turn the question into arithmetic. At every instant
either both tones are present (a crossfade), exactly one is (a hard cut), or neither is (a gap the
listener hears as a pause). Real music cannot settle this: both tunes are moving, so an overlap and
a cut look alike in a spectrum and sound alike to a tired ear.

Generate the two tunes with `scripts/generate-test-sid.mjs`, put them next to each other in a
playlist, start the first, and record while you skip to the second.

    node scripts/generate-test-sid.mjs --hz 550  --name "XF Low"  --out /tmp/xf-low.sid
    node scripts/generate-test-sid.mjs --hz 1850 --name "XF High" --out /tmp/xf-high.sid
    arecord -D "$MIC" -f S16_LE -r 44100 -c 1 -d 8 /tmp/xf.wav &   # then press Next
    python3 tools/hil/crossfade_probe.py /tmp/xf.wav

Pick pitches your speaker actually reproduces and that are not octaves apart: an octave shares
harmonics, so one tone can be mistaken for the other. 550 Hz and 1850 Hz work on a phone speaker.

Levels are compared against each tone's OWN peak, never a shared threshold. The two tones do not
reach the microphone equally — speaker response, distance and the room all differ — and a shared
threshold simply buries the quieter one and reports it absent.

Read `verdict` and nothing else if you are in a hurry. `SEAMLESS CROSSFADE` is the only pass.
"""

import argparse
import json
import sys
import wave

import numpy as np

#: Analysis window. Long enough for a clean estimate at these pitches, short enough that a gap of
#: about a tenth of a second — already plainly audible — cannot hide inside one window.
WINDOW_SECONDS = 0.05

#: A tone counts as present above this fraction of its own peak — but see SNR_MARGIN: this alone is
#: a ratio against a peak that might itself be noise, so it is a floor and not the whole test.
PRESENT = 0.10

#: And as "the only thing playing" above this, which is what marks the ends of the transition.
DOMINANT = 0.25

#: How far a tone must stand above its OWN measured noise floor, both for its peak to be worth
#: grading at all and for a single window to count as that tone being present.
#:
#: Without this the thresholds are circular. `PRESENT` is a fraction of the peak, so if the loudest
#: thing in the low bin is room noise rather than the tune, every window near that level is called
#: "low tone present" — and a real gap gets filled in by noise while the verdict stays confident.
#: 8x is about 18 dB, comfortably more than the bin-to-bin wander of a quiet room and comfortably
#: less than the margin a tone the listener can actually hear will have.
SNR_MARGIN = 8.0


def read_mono(path: str) -> tuple[np.ndarray, int]:
    """The recording as floats in -1..1, with its sample rate."""
    with wave.open(path, "rb") as handle:
        if handle.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit samples")
        rate = handle.getframerate()
        raw = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2")
        if handle.getnchannels() > 1:
            raw = raw.reshape(-1, handle.getnchannels()).mean(axis=1)
    return raw.astype(np.float64) / 32768.0, rate


def tone_level(samples: np.ndarray, hz: float, rate: int, start: int, frames: int, taper: np.ndarray) -> float:
    """How much of `hz` is in one window, by a single-bin discrete Fourier transform.

    The window is tapered first. Without that, a window holding a non-integer number of cycles leaks
    energy into neighbouring frequencies and the reading alternates high-low-high between successive
    windows — about 8% at these pitches, which is larger than one step of a slow fade and made a
    perfectly smooth ramp look ragged. The taper costs a little frequency resolution, which is of no
    consequence when the two tones are more than an octave apart.
    """
    window = samples[start : start + frames]
    if len(window) < frames:
        return 0.0
    turns = np.arange(frames)
    return float(np.abs(np.sum(window * taper * np.exp(-2j * np.pi * hz * turns / rate))) / frames)


def _runs(flags: list[bool], lo: int, hi: int) -> int:
    """How many separate stretches of True there are in `flags[lo:hi + 1]`.

    This is what catches a tone that disappears and comes back. A crossfade has each tone on for one
    unbroken stretch — the outgoing one ending, the incoming one beginning — so anything above 1
    inside the transition is a dropout, however tidy the levels either side of it look.
    """
    runs = 0
    prev = False
    for i in range(lo, hi + 1):
        if flags[i] and not prev:
            runs += 1
        prev = flags[i]
    return runs


def measure(path: str, low_hz: float, high_hz: float) -> list[tuple[float, float, float]]:
    """The recording as one row per window: its time, and the level of each tone in it."""
    samples, rate = read_mono(path)
    frames = int(WINDOW_SECONDS * rate)
    taper = np.hanning(frames)
    rows = [
        (
            start / rate,
            tone_level(samples, low_hz, rate, start, frames, taper),
            tone_level(samples, high_hz, rate, start, frames, taper),
        )
        for start in range(0, len(samples) - frames, frames)
    ]
    if not rows:
        raise SystemExit(f"{path}: too short to analyse")
    return rows


def grade_rows(rows: list[tuple[float, float, float]], path: str = "<rows>", verbose: bool = False) -> dict:
    """Judge one transition from its measured windows. Pure, so it can be fed synthetic patterns."""
    low_peak = max(row[1] for row in rows) or 1e-12
    high_peak = max(row[2] for row in rows) or 1e-12

    # Each tone's noise floor, taken as a low percentile of its OWN bin across the whole recording.
    #
    # The obvious estimator — measure the low bin where only the high tune is playing — is circular,
    # and circular in exactly the case that matters. "Only the high tune is playing" has to be
    # decided from the low bin being quiet, and when the low bin is nothing but noise it is never
    # quiet, so no window qualifies and no floor gets measured. The recording this check exists to
    # reject is the one that defeats it.
    #
    # A percentile needs no such decision. Each tune plays and then stops inside the recording, so a
    # bin holding a real tone spans from room noise to the tone; a bin holding only noise barely
    # moves, and its 10th percentile sits just under its peak. That ratio IS the question.
    #
    # The 10th rather than the minimum, so one unusually quiet window cannot flatter the result.
    low_noise = float(np.percentile([row[1] for row in rows], 10))
    high_noise = float(np.percentile([row[2] for row in rows], 10))

    # Present means "above its own peak's PRESENT fraction AND clear of its own noise". The second
    # half is what stops narrow-band noise at a target frequency being read as a tone that is
    # playing, which would quietly fill in a real gap.
    low_on_at = max(low_peak * PRESENT, low_noise * SNR_MARGIN)
    high_on_at = max(high_peak * PRESENT, high_noise * SNR_MARGIN)
    low_on = [row[1] > low_on_at for row in rows]
    high_on = [row[2] > high_on_at for row in rows]

    # The transition runs from the last moment the first tune is clearly alone to the first moment
    # the second one is. Everything outside that is one tune playing normally.
    first = next((i for i, row in enumerate(rows) if row[1] > low_peak * DOMINANT), 0)
    last = next((i for i in range(len(rows) - 1, -1, -1) if rows[i][2] > high_peak * DOMINANT), len(rows) - 1)
    if last < first:
        first, last = 0, len(rows) - 1

    silent = [i for i in range(first, last + 1) if not low_on[i] and not high_on[i]]
    blend = [i for i in range(first, last + 1) if low_on[i] and high_on[i]]
    both = [low_on[i] and high_on[i] for i in range(len(rows))]

    # Continuity across the WHOLE transition interval, not only the windows where both tones are on.
    # Filtering to the blend and then comparing consecutive retained indices skips over exactly the
    # windows a dropout lives in: `low only -> both -> high only -> both -> high only` has no silent
    # window, and its two blend stretches, compared to each other, fall and rise perfectly. The
    # outgoing tune vanishing and returning mid-transition is audible and must not read as seamless.
    low_runs = _runs(low_on, first, last)
    high_runs = _runs(high_on, first, last)
    blend_runs = _runs(both, first, last)

    # Across the blend the outgoing tone should fall and the incoming rise. Judged two ways, because
    # neither alone is trustworthy on a recording made in a room.
    #
    # Step by step, most windows must move the right way — but not all of them. A microphone picks up
    # enough noise that one window in twenty can wobble against the trend on a transition that is
    # perfectly smooth, and failing on that reports a defect that is not there.
    #
    # End to end, the two tones must have genuinely traded places: the outgoing one at most half its
    # starting level, the incoming one at least double. That is what stops a nearly-flat pair of
    # lines passing merely because their noise happened to drift the right way.
    falling = sum(1 for a, b in zip(blend, blend[1:]) if rows[b][1] <= rows[a][1] * 1.05)
    rising = sum(1 for a, b in zip(blend, blend[1:]) if rows[b][2] >= rows[a][2] * 0.95)
    steps = max(1, len(blend) - 1)
    MOSTLY = 0.9
    traded = bool(blend) and (
        rows[blend[-1]][1] <= rows[blend[0]][1] * 0.5 and rows[blend[-1]][2] >= rows[blend[0]][2] * 2.0
    )

    result = {
        "file": path,
        "silence_seconds": round(len(silent) * WINDOW_SECONDS, 3),
        "blend_seconds": round(len(blend) * WINDOW_SECONDS, 3),
        "outgoing_falls": f"{falling}/{steps}",
        "incoming_rises": f"{rising}/{steps}",
        "peak_low": round(low_peak, 6),
        "peak_high": round(high_peak, 6),
        "noise_low": round(low_noise, 6),
        "noise_high": round(high_noise, 6),
        "snr_low": round(low_peak / low_noise, 1) if low_noise else None,
        "snr_high": round(high_peak / high_noise, 1) if high_noise else None,
        "stretches": f"low {low_runs}, high {high_runs}, blend {blend_runs}",
    }

    # A recording where neither tone stands clear of the noise proves nothing. Say so rather than
    # printing a confident verdict derived from a noise floor — a mistake worth making only once.
    #
    # Two separate checks, because they fail differently. The absolute one catches a recording that
    # is near-digital silence throughout. The SNR one catches the more dangerous case: a room loud
    # enough at one of the target frequencies that the "peak" every threshold is a fraction of is
    # itself noise.
    if low_peak < 1e-4 or high_peak < 1e-4:
        result["verdict"] = "INCONCLUSIVE — a tone never rose above digital silence; check the volume"
    elif low_noise and low_peak < low_noise * SNR_MARGIN:
        result["verdict"] = f"INCONCLUSIVE — the low tone is only {result['snr_low']}x its own noise; quieten the room"
    elif high_noise and high_peak < high_noise * SNR_MARGIN:
        result["verdict"] = (
            f"INCONCLUSIVE — the high tone is only {result['snr_high']}x its own noise; quieten the room"
        )
    elif silent:
        result["verdict"] = f"GAP — {result['silence_seconds']}s of silence between the tunes"
    elif not blend:
        result["verdict"] = "HARD CUT — no instant where both tunes were audible"
    elif low_runs > 1 or high_runs > 1 or blend_runs > 1:
        result["verdict"] = "RAGGED — a tune dropped out and came back during the transition"
    elif falling < steps * MOSTLY or rising < steps * MOSTLY or not traded:
        result["verdict"] = "RAGGED — the tunes overlap but do not cleanly trade places"
    else:
        result["verdict"] = "SEAMLESS CROSSFADE"

    if verbose:
        # stderr, so `--json --verbose` still emits parseable JSON on stdout.
        print(f"{'t':>6} {'low':>10} {'high':>10}  state", file=sys.stderr)
        for i, (at, low, high) in enumerate(rows):
            state = "BOTH" if low_on[i] and high_on[i] else "low" if low_on[i] else "high" if high_on[i] else "-"
            print(f"{at:6.2f} {low:10.6f} {high:10.6f}  {state}", file=sys.stderr)
    return result


def grade(path: str, low_hz: float, high_hz: float, verbose: bool) -> dict:
    return grade_rows(measure(path, low_hz, high_hz), path=path, verbose=verbose)


def self_test() -> int:
    """Feed the grader patterns whose right answer is known, including ones it used to get wrong.

    Kept in the tool rather than in a test suite because CI runs pytest only over `agents/`, and a
    fixture nobody executes is not a fixture. Run it after touching the grading rules:

        python3 tools/hil/crossfade_probe.py --self-test
    """
    rows = lambda levels: [(i * WINDOW_SECONDS, lo, hi) for i, (lo, hi) in enumerate(levels)]  # noqa: E731
    cases = [
        (
            "a clean crossfade",
            [(1.0, 0.001)] * 4 + [(0.8, 0.2), (0.6, 0.4), (0.4, 0.6), (0.2, 0.8)] + [(0.001, 1.0)] * 4,
            "SEAMLESS CROSSFADE",
        ),
        (
            "a hard cut",
            [(1.0, 0.001)] * 6 + [(0.001, 1.0)] * 6,
            "HARD CUT",
        ),
        (
            "a gap between the tunes",
            [(1.0, 0.001)] * 4 + [(0.001, 0.001)] * 3 + [(0.001, 1.0)] * 4,
            "GAP",
        ),
        (
            # The pattern that used to pass. Filtering to both-on windows and zipping only those
            # skipped the high-only window in the middle, so the outgoing tune vanishing and
            # returning was invisible and every remaining check was satisfied.
            "the outgoing tune drops out and returns",
            [(1.0, 0.001)] * 4 + [(0.8, 0.2), (0.001, 0.9), (0.4, 0.8)] + [(0.001, 1.0)] * 4,
            "RAGGED",
        ),
        (
            # Noise at the low frequency as loud as the tune ever gets there. Every threshold derived
            # from that peak is a fraction of noise, so the gap in the middle reads as "low present".
            "narrow-band noise standing in for the low tone",
            [(0.02, 0.001)] * 4 + [(0.02, 0.5)] + [(0.018, 1.0)] * 5,
            "INCONCLUSIVE",
        ),
    ]
    failures = 0
    for name, levels, expected in cases:
        verdict = grade_rows(rows(levels), path=name)["verdict"]
        ok = verdict.startswith(expected)
        if not ok:
            failures += 1
        print(f"{'ok  ' if ok else 'FAIL'}  {name:46} → {verdict}")
    print(f"\n{len(cases) - failures}/{len(cases)} patterns graded as expected")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("recordings", nargs="*", help="WAV files, each holding one track change")
    parser.add_argument("--low-hz", type=float, default=550.0, help="pitch of the outgoing tune")
    parser.add_argument("--high-hz", type=float, default=1850.0, help="pitch of the incoming tune")
    parser.add_argument("--verbose", action="store_true", help="print every analysis window, to stderr")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--self-test", action="store_true", help="grade known patterns and check the verdicts")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.recordings:
        parser.error("give at least one WAV file, or --self-test")

    results = [grade(path, args.low_hz, args.high_hz, args.verbose) for path in args.recordings]
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            name = result["file"].rsplit("/", 1)[-1]
            print(
                f"{name:20} silence={result['silence_seconds']:.2f}s  blend={result['blend_seconds']:.2f}s  "
                f"falls {result['outgoing_falls']}  rises {result['incoming_rises']}  → {result['verdict']}"
            )
    return 0 if all(r["verdict"] == "SEAMLESS CROSSFADE" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
