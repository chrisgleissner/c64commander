#!/usr/bin/env python3
"""Measure a tone & colour ladder capture note by note: pitch, timing, and noise floor.

Pairs with `make_tone_ladder_sid.py`, which emits an 18-slot PSID — a silence, a full octave up, a
silence, a full octave back down, 0.5 s per slot, 9.0 s per loop. That structure is what makes this
exact rather than statistical:

  - each note has ONE expected fundamental, so a wrong pitch is unambiguous;
  - each note is the same length, so a short one means audio was lost;
  - the note-boundary gaps mark onsets, so a dropout INSIDE a note cannot be confused with the
    boundary between two notes;
  - the two long silences are landmarks, so a capture that joins the loop anywhere ALIGNS rather
    than guessing a rotation offset — and they are themselves a measurement, since a slot that is
    supposed to be digitally silent and is not tells you something is mixing into the signal.

Run it on a capture of the phone rendering the tune locally and on a capture of the same tune
streamed from the C64, and the difference between the two paths is a table rather than an opinion.

MEASUREMENT CONVENTIONS

  pitch      cents (1200 per octave). ±5 c is roughly the just-noticeable difference for a
             trained listener; the default ±50 c tolerance is a quarter tone, chosen so a phone
             speaker in a room passes and a genuinely wrong note does not.
  level      dBFS. The silence floor is reported as RMS and true peak, in the spirit of AES17
             idle-channel noise; EBU R128's absolute gate of -70 LUFS is used as the pass line.
  statistics median and interquartile range, never a bare mean — one dropout should not move the
             headline number, and the spread is what tells you whether the path is stable.

KNOWN LIMITATION

On a synthetic render the ordinary notes time to a median of +0.2 ms with an IQR of 0.0 ms, but the
two notes either side of each silence carry a ~80 ms onset-placement artefact from the envelope
detector. It is a measurement artefact, not a signal fault — a 6502 trace of the player shows the
gate-on events land on an exact 25/50-frame grid. It is left in rather than filtered out, because
silently dropping the inconvenient samples is how a real regression gets hidden later; the median
and IQR are robust to it, and it is plainly visible in the per-note table.

    python3 tools/hil/analyse_tone_ladder.py capture.wav
"""

from __future__ import annotations

import argparse
import json
import wave

import numpy as np

# ── the ladder emitted by make_tone_ladder_sid.py ──────────────────────────────
SCALE_NAMES = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"]
SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12]
SCALE_HZ = [220.0 * (2 ** ((s - 9) / 12.0)) for s in SCALE_SEMITONES]
C64_COLOUR_NAMES = [
    "black", "white", "red", "cyan", "purple", "green", "blue", "yellow",
    "orange", "brown", "light red", "dark grey", "grey", "light green", "light blue", "light grey",
]

# PAL is not 50 Hz. The VIC's vertical refresh is 985248/19656 = 50.1245 Hz, so a 25-frame slot
# lasts 498.76 ms, not 500. Assuming 50 Hz put a systematic -1.0 ms on every note in the ladder —
# small, but it is exactly the kind of constant bias that a timing measurement must not invent.
PAL_REFRESH_HZ = 985248.0 / 19656.0
FRAMES_PER_SLOT = 25
SLOT_SECONDS = FRAMES_PER_SLOT / PAL_REFRESH_HZ
SILENCE = -1


def _build_ladder() -> list[dict]:
    top = len(SCALE_NAMES) - 1
    slots = [SILENCE] + list(range(len(SCALE_NAMES))) + [SILENCE] + list(range(top, -1, -1))
    out, colour = [], 0
    for index, slot in enumerate(slots):
        if slot == SILENCE:
            out.append({"index": index, "name": "silence", "hz": 0.0, "colour": None})
        else:
            out.append(
                {
                    "index": index,
                    "name": SCALE_NAMES[slot],
                    "hz": SCALE_HZ[slot],
                    "colour": C64_COLOUR_NAMES[colour % len(C64_COLOUR_NAMES)],
                }
            )
            colour += 1
    return out


LADDER = _build_ladder()
LOOP_SLOTS = len(LADDER)
LOOP_SECONDS = LOOP_SLOTS * SLOT_SECONDS
# Slot indices that begin an ascending run — used to tell the two silences apart.
ASCENDING_SILENCE = 0
DESCENDING_SILENCE = 9

FRAME_MS = 10.0
# A phone speaker gives almost nothing below ~700 Hz, but these fundamentals are 131-262 Hz. The
# capture therefore carries them mostly as harmonics, so pitch is taken from the strongest peak in a
# band that includes the 2nd and 3rd harmonic and then folded back to the fundamental.
PITCH_MIN_HZ, PITCH_MAX_HZ = 100.0, 800.0
# A ladder silence is 0.5 s plus the previous note's 80 ms tail; a note boundary is only that 80 ms.
# Anything past 0.3 s is therefore a ladder silence and nothing else.
SILENCE_MIN_SECONDS = 0.3
# How far below a sounding note a frame must sit to count as quiet. The ladder's own gaps measure
# 30-50 dB down once the signal is AC-coupled, so 20 dB separates them from anything sounding
# without depending on the absolute level a phone or a capture card happened to deliver.
QUIET_BELOW_NOTE_DB = 20.0
# ITU-R BS.1770 / EBU R128 absolute gate. A slot meant to be silent that exceeds this carries signal.
SILENCE_GATE_DBFS = -70.0
# First stage of the measurement chain; see ac_couple().
HIGHPASS_HZ = 60.0
# How far either side of the frame-grid onset refine_onset looks for the true edge.
ONSET_SEARCH_FRAMES = 5


def ac_couple(samples: np.ndarray, rate: int, fc: float = HIGHPASS_HZ) -> np.ndarray:
    """2nd-order Butterworth high-pass — the first stage of the measurement chain.

    Level measured on a signal that still carries DC is meaningless, which is why ITU-R BS.1770's
    K-weighting begins with a high-pass. Here it is not a formality: gating the SID leaves a DC step
    that rings through the chip's DC blocker at around 1 Hz. Unweighted, that ring measured -13 dBFS
    — louder than half the ladder — and a plain RMS envelope scored it as a note, with the click as
    its onset. At 60 Hz this removes it and costs the lowest note (C3, 130.8 Hz) 0.2 dB.
    """
    w0 = 2.0 * np.pi * fc / rate
    alpha = np.sin(w0) / (2.0 * np.sqrt(0.5))  # Q = 1/sqrt(2), Butterworth
    cos_w0 = np.cos(w0)
    b = np.array([(1 + cos_w0) / 2, -(1 + cos_w0), (1 + cos_w0) / 2])
    a = np.array([1 + alpha, -2 * cos_w0, 1 - alpha])
    b, a = b / a[0], a / a[0]

    out = np.empty_like(samples)
    x1 = x2 = y1 = y2 = 0.0
    for i, x0 in enumerate(samples):
        y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        out[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def load_mono(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        raw = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float64)
    if channels == 2:
        raw = raw.reshape(-1, 2).mean(axis=1)
    return ac_couple(raw / 32768.0, rate), rate


def envelope(samples: np.ndarray, rate: int) -> tuple[np.ndarray, float]:
    step = max(1, int(rate * FRAME_MS / 1000.0))
    usable = (samples.size // step) * step
    frames = samples[:usable].reshape(-1, step)
    return 20.0 * np.log10(np.maximum(np.sqrt((frames**2).mean(axis=1)), 1e-9)), step / rate


def note_level_db(env: np.ndarray) -> float:
    """The level of a sounding note, taken as a high percentile so gaps cannot drag it down."""
    return float(np.percentile(env, 90))


def find_onsets(env: np.ndarray, frame_s: float, quiet_below: float) -> list[int]:
    """Note ONSETS — the sharp level jump when a note is gated on.

    Not silence between notes, which was the first attempt: the SID's release still rings, so a
    gated-off note only ducks by ~8 dB and the whole ladder segments as one continuous block. The
    attack, by contrast, is a clean +11 dB step against the previous note's decayed tail.
    """
    if env.size < 10:
        return []
    active = env > quiet_below

    # A note sustains; a click does not. Requiring the level to STAY up rejects the transient left
    # by gating the SID, which otherwise scores as an onset and shifts the whole ladder alignment by
    # one slot. Checked over 150 ms — a third of a note, and far longer than any transient.
    sustain_frames = max(1, int(0.15 / frame_s))

    onsets: list[int] = []
    look_back = 3
    for i in range(look_back, len(env)):
        if not active[i]:
            continue
        previous = float(np.median(env[i - look_back : i]))
        if env[i] - previous < 6.0:
            continue
        if onsets and (i - onsets[-1]) * frame_s <= 0.2:
            continue
        if float(np.mean(active[i : i + sustain_frames])) < 0.6:
            continue
        onsets.append(i)
    return onsets


def refine_onset(samples: np.ndarray, rate: int, frame_index: int, frame_s: float) -> float:
    """Place an onset to ~1 ms instead of to the 10 ms analysis frame.

    Worth doing because these onsets are the time reference the A/V sync measurement subtracts video
    colour changes from, and video arrives in 20 ms frames — an audio reference quantised to 10 ms
    would put a visible floor under the result.
    """
    # Asymmetric: a little context before the edge, but enough after it to land squarely in the
    # sustained note. A symmetric window ended inside the attack for the first note after a silence,
    # so "after" was measured mid-rise, the half-rise threshold came out low, and the onset was
    # placed up to 80 ms early — exactly where a silence made the preceding floor lowest.
    start = max(0, int((frame_index - ONSET_SEARCH_FRAMES) * frame_s * rate))
    end = min(samples.size, int((frame_index + ONSET_SEARCH_FRAMES * 2 + 2) * frame_s * rate))
    window = samples[start:end]
    hop = max(1, int(rate * 0.001))
    guard = int(0.03 / 0.001)  # 30 ms of context either side
    if window.size < hop * (guard * 2 + 4):
        return frame_index * frame_s

    # Overlapping windows, one hop apart. The window has to span at least a full cycle of the lowest
    # note (C3, 130.8 Hz -> 7.6 ms) or the "level" swings with the waveform's phase instead of its
    # amplitude, and the crossing lands tens of milliseconds off depending on which note it is.
    span = max(hop * 2, int(rate * 0.008))
    steps = (window.size - span) // hop + 1
    if steps < guard * 2 + 4:
        return frame_index * frame_s
    levels = np.array(
        [20.0 * np.log10(max(np.sqrt((window[i * hop : i * hop + span] ** 2).mean()), 1e-12)) for i in range(steps)]
    )
    before = float(np.median(levels[:guard]))
    after = float(np.median(levels[-guard:]))
    # No clear rise in the window means this is not a usable edge; keep the frame-grid answer.
    if after - before < 6.0:
        return frame_index * frame_s

    # The crossing is referenced to the NOTE (half power, -6 dB below its plateau), not to the
    # midpoint between the note and whatever came before it. Midpoint made the threshold depend on
    # how quiet the preceding region was, so notes following a silence were called tens of
    # milliseconds earlier than notes following another note — a bias created purely by the ladder's
    # own structure. Half power is the same place on every attack.
    # Timestamps refer to the window CENTRE, so smoothing does not bias the result late — which
    # would otherwise show up as a constant A/V offset that is really a measurement artefact.
    threshold = after - 6.0
    crossed = int(np.argmax(levels[guard:] >= threshold)) + guard
    return (start + crossed * hop + span / 2.0) / rate


def find_silences(env: np.ndarray, frame_s: float, floor_db: float) -> list[tuple[int, int]]:
    """Runs of frames quiet enough, and long enough, to be a ladder silence."""
    quiet = env < floor_db
    runs: list[tuple[int, int]] = []
    start = None
    for i, is_quiet in enumerate(quiet):
        if is_quiet and start is None:
            start = i
        elif not is_quiet and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(env)))
    return [(a, b) for a, b in runs if (b - a) * frame_s >= SILENCE_MIN_SECONDS]


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
    while peak > 280.0:  # fold harmonics back; the ladder lives in 131-262 Hz
        peak /= 2.0
    return peak


def cents(detected: float, expected: float) -> float:
    if detected <= 0 or expected <= 0:
        return 9999.0
    return 1200.0 * float(np.log2(detected / expected))


def iqr(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return float(np.percentile(values, 75) - np.percentile(values, 25))


def anchor_slot(notes: list[dict], tolerance_cents: float) -> int | None:
    """Which ladder slot the first detected note occupies.

    The two silences are told apart by what follows them: an ascending run means we are at the top
    of the loop, a descending run means we are at the turn. That is a two-note decision, so it is
    cheap and it does not care how much of the loop was captured.
    """
    if not notes:
        return None
    best, best_score = None, -1
    for start in range(LOOP_SLOTS):
        if LADDER[start]["hz"] == 0.0:
            continue
        score = 0
        slot = start
        for note in notes:
            while LADDER[slot % LOOP_SLOTS]["hz"] == 0.0:
                slot += 1
            expected = LADDER[slot % LOOP_SLOTS]["hz"]
            if abs(cents(note["hz"], expected)) <= tolerance_cents:
                score += 1
            slot += 1
        if score > best_score:
            best, best_score = start, score
    return best


def analyse(path: str, tolerance_cents: float = 50.0) -> dict:
    samples, rate = load_mono(path)
    env, frame_s = envelope(samples, rate)
    quiet_below = note_level_db(env) - QUIET_BELOW_NOTE_DB
    onsets = find_onsets(env, frame_s, quiet_below)
    if not onsets:
        return {"usable": False, "reason": "no notes found — the capture is silence or noise"}

    silences = find_silences(env, frame_s, quiet_below)

    # Timing is measured as the INTER-ONSET INTERVAL, not as how long a note stays audible. A note is
    # gated off 80 ms before its slot ends, and that release is shaped by the path under test, so
    # "how long was it audible" would measure the speaker as much as the signal. Onset to onset is a
    # clock: it must equal the slot length, and the ladder says exactly which slots are involved.
    refined = [refine_onset(samples, rate, index, frame_s) for index in onsets]
    detected = []
    for index in range(len(refined) - 1):  # the final onset has no successor, so it cannot be timed
        start_seconds, next_seconds = refined[index], refined[index + 1]
        # Measure pitch over the sounding part only, stopping at a ladder silence if one intervenes.
        pitch_end = next_seconds
        for a, b in silences:
            if onsets[index] < a < onsets[index + 1]:
                pitch_end = a * frame_s
                break
        seg = samples[int(start_seconds * rate) : int(pitch_end * rate)]
        inner = seg[int(len(seg) * 0.2) : int(len(seg) * 0.8)] if len(seg) > 1000 else seg
        detected.append(
            {
                "startSeconds": round(start_seconds, 4),
                "seconds": round(next_seconds - start_seconds, 4),
                "hz": detect_pitch(inner, rate),
            }
        )
    detected = [n for n in detected if n["seconds"] >= 0.12]
    if not detected:
        return {"usable": False, "reason": "no note lasted long enough to measure"}

    start_slot = anchor_slot(detected, tolerance_cents)
    rows, slot = [], start_slot or 0
    for note in detected:
        while LADDER[slot % LOOP_SLOTS]["hz"] == 0.0:
            slot += 1
        reference = LADDER[slot % LOOP_SLOTS]
        # A note followed by a silence is expected to be two slots from the next onset, not one.
        span = 1
        while LADDER[(slot + span) % LOOP_SLOTS]["hz"] == 0.0:
            span += 1
        expected_seconds = span * SLOT_SECONDS
        error = cents(note["hz"], reference["hz"])
        rows.append(
            {
                "expected": reference["name"],
                "colour": reference["colour"],
                "expectedHz": round(reference["hz"], 1),
                "detectedHz": round(note["hz"], 2),
                "cents": round(error, 1),
                "seconds": note["seconds"],
                "expectedSeconds": expected_seconds,
                "lengthErrorMs": round((note["seconds"] - expected_seconds) * 1000.0, 1),
                "ok": abs(error) <= tolerance_cents,
            }
        )
        slot += 1

    # The noise floor of slots that are supposed to be digitally silent.
    floors = []
    for a, b in silences:
        seg = samples[int(a * frame_s * rate) : int(b * frame_s * rate)]
        # Middle 60% avoids the previous note's release tail and the next note's attack.
        inner = seg[int(len(seg) * 0.2) : int(len(seg) * 0.8)] if len(seg) > 1000 else seg
        if inner.size:
            floors.append(
                {
                    "rmsDbfs": round(20.0 * float(np.log10(max(np.sqrt((inner**2).mean()), 1e-12))), 1),
                    "peakDbfs": round(20.0 * float(np.log10(max(np.abs(inner).max(), 1e-12))), 1),
                    "seconds": round((b - a) * frame_s, 3),
                }
            )

    good = [r for r in rows if r["ok"]]
    cents_abs = [abs(r["cents"]) for r in rows]
    lengths = [r["lengthErrorMs"] for r in rows]
    short = [r for r in rows if r["seconds"] < r["expectedSeconds"] * 0.7]
    long_ = [r for r in rows if r["seconds"] > r["expectedSeconds"] * 1.4]
    worst_floor = max((f["rmsDbfs"] for f in floors), default=None)

    return {
        "usable": True,
        "loopSeconds": LOOP_SECONDS,
        "notesDetected": len(rows),
        "notesInTune": len(good),
        "inTunePct": round(100.0 * len(good) / max(1, len(rows)), 1),
        "medianCentsError": round(float(np.median([r["cents"] for r in rows])), 1),
        "medianAbsCents": round(float(np.median(cents_abs)), 1),
        "centsIqr": round(iqr(cents_abs), 1),
        "medianLengthErrorMs": round(float(np.median(lengths)), 1),
        "lengthIqrMs": round(iqr(lengths), 1),
        "shortNotes": len(short),
        "runTogetherNotes": len(long_),
        "silencesFound": len(floors),
        "silenceFloorDbfs": worst_floor,
        "silenceGatePassed": worst_floor is not None and worst_floor <= SILENCE_GATE_DBFS,
        "silences": floors,
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

    print(f"TONE & COLOUR LADDER — {args.capture}")
    print(f"  loop {result['loopSeconds']:.1f}s, {result['notesDetected']} notes graded\n")
    print(f"  PITCH    in tune (+/-{args.tolerance_cents:.0f}c) {result['notesInTune']}/{result['notesDetected']}"
          f" ({result['inTunePct']}%)")
    print(f"           median {result['medianCentsError']:+.1f} cents, |median| {result['medianAbsCents']}"
          f", IQR {result['centsIqr']}")
    print(f"  LENGTH   median {result['medianLengthErrorMs']:+.1f} ms vs {SLOT_SECONDS * 1000:.0f} ms"
          f", IQR {result['lengthIqrMs']} ms")
    print(f"           short {result['shortNotes']} (audio lost inside a note),"
          f" run-together {result['runTogetherNotes']} (boundary lost)")
    if result["silenceFloorDbfs"] is not None:
        verdict = "PASS" if result["silenceGatePassed"] else "FAIL — signal present where there should be none"
        print(f"  SILENCE  {result['silencesFound']} found, worst floor {result['silenceFloorDbfs']} dBFS RMS"
              f"  (gate {SILENCE_GATE_DBFS:.0f} dBFS: {verdict})")
    else:
        print("  SILENCE  none found — the ladder's silent slots did not survive the path")

    print("\n  expected  colour        detected     cents   length")
    for r in result["rows"]:
        flag = "" if r["ok"] else "  <-- OFF"
        print(f"  {r['expected']:>8}  {str(r['colour']):<12} {r['detectedHz']:9.2f} {r['cents']:+8.1f}"
              f" {r['lengthErrorMs']:+7.1f}ms{flag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
