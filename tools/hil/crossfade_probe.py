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

#: A tone counts as present above this fraction of its own peak. Well above the noise floor of a
#: microphone in a room, well below any level a listener would call audible.
PRESENT = 0.10

#: And as "the only thing playing" above this, which is what marks the ends of the transition.
DOMINANT = 0.25


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


def grade(path: str, low_hz: float, high_hz: float, verbose: bool) -> dict:
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

    low_peak = max(row[1] for row in rows) or 1e-12
    high_peak = max(row[2] for row in rows) or 1e-12
    low_on = [row[1] > low_peak * PRESENT for row in rows]
    high_on = [row[2] > high_peak * PRESENT for row in rows]

    # The transition runs from the last moment the first tune is clearly alone to the first moment
    # the second one is. Everything outside that is one tune playing normally.
    first = next((i for i, row in enumerate(rows) if row[1] > low_peak * DOMINANT), 0)
    last = next((i for i in range(len(rows) - 1, -1, -1) if rows[i][2] > high_peak * DOMINANT), len(rows) - 1)

    silent = [i for i in range(first, last + 1) if not low_on[i] and not high_on[i]]
    blend = [i for i in range(first, last + 1) if low_on[i] and high_on[i]]

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
    }

    # A recording where neither tone stands clear of the noise proves nothing. Say so rather than
    # printing a confident verdict derived from a noise floor — a mistake worth making only once.
    if low_peak < 1e-4 or high_peak < 1e-4:
        result["verdict"] = "INCONCLUSIVE — a tone never rose above the noise; check the volume"
    elif silent:
        result["verdict"] = f"GAP — {result['silence_seconds']}s of silence between the tunes"
    elif not blend:
        result["verdict"] = "HARD CUT — no instant where both tunes were audible"
    elif falling < steps * MOSTLY or rising < steps * MOSTLY or not traded:
        result["verdict"] = "RAGGED — the tunes overlap but do not cleanly trade places"
    else:
        result["verdict"] = "SEAMLESS CROSSFADE"

    if verbose:
        print(f"{'t':>6} {'low':>10} {'high':>10}  state")
        for i, (at, low, high) in enumerate(rows):
            state = "BOTH" if low_on[i] and high_on[i] else "low" if low_on[i] else "high" if high_on[i] else "-"
            print(f"{at:6.2f} {low:10.6f} {high:10.6f}  {state}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("recordings", nargs="+", help="WAV files, each holding one track change")
    parser.add_argument("--low-hz", type=float, default=550.0, help="pitch of the outgoing tune")
    parser.add_argument("--high-hz", type=float, default=1850.0, help="pitch of the incoming tune")
    parser.add_argument("--verbose", action="store_true", help="print every analysis window")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

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
