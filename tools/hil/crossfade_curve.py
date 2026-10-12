#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
#
# Licensed under the GNU General Public License v3.0 or later.
# See <https://www.gnu.org/licenses/> for details.
"""Measure the shape of one crossfade in the samples the app handed the AudioTrack.

`crossfade_probe.py` answers whether a join is seamless. This answers whether it is the crossfade
that was asked for: how long each ramp took against the configured length, whether each ramp only
ever moves one way, whether the two ramps run at the same time, how far the combined level dips
while they do, and whether the join carries a click. The input is the pipeline capture of two
steady tones (the merge gate's Tone-Low and Tone-High), so every figure is exact rather than a
reading through a room.

    crossfade_curve.py CAPTURE.wav --crossfade-ms 1500 [--low-hz 550 --high-hz 900] [--json]

A crossfade of 0 ms is the "Off (clean cut)" setting: the outgoing tune is silenced before the
next one starts, so it is graded as a cut with a short declick and no overlap.
"""

import argparse
import json
import sys
import wave

import numpy as np

#: 20 ms windows every 5 ms. At 20 ms a Hann window resolves 100 Hz either side, which keeps the
#: low tune's second overtone (1100 Hz) out of the high tune's 900 Hz bin.
WINDOW_SECONDS = 0.02
HOP_SECONDS = 0.005

#: A ramp is measured between these fractions of the tone's steady level.
RAMP_TOP = 0.9
RAMP_BOTTOM = 0.1

#: Ramp length against the setting. A linear ramp crosses from 90% to 10% in 80% of its length.
RAMP_FRACTION = RAMP_TOP - RAMP_BOTTOM
RAMP_TOLERANCE = 0.2

#: Within a ramp, a window may move against the ramp's direction by at most this much of the
#: steady level. Analysis windows straddle the moving gain, so small reversals are measurement.
MONOTONE_SLACK = 0.03

#: A ramp may stray from a straight line through its own ends by at most this much of the level.
LINEARITY_SLACK = 0.08

#: The two ramps' midpoints must lie this close together, as a fraction of the setting.
CENTRE_TOLERANCE = 0.25

#: A ramp's whole extent runs from this fraction of the steady level down to the tone's floor.
FULL_TOP = 0.98

#: No step of a ramp, anywhere between full level and silence, may be steeper than this many times
#: the configured slope. A tune cut off part-way down its fade, or one that jumps in, is a step.
STEEPEST_RATIO = 2.5

#: A ramp may not wander from its own 50 ms moving average by more than this RMS share of the level.
#: Gain applied in stairs, or jitter, shows here long before it shows as a turn-back.
ROUGHNESS_SLACK = 0.004

#: Before its ramp the outgoing tune holds at least this level, and the incoming one stays under this.
HOLD_LEVEL = 0.9
BLIP_LEVEL = 0.03

#: Both tones under this fraction of their level at once is silence between the tunes.
SILENT = 0.05

#: The longest silence a clean cut may leave between the tunes, in seconds, and the shortest ramp
#: either side of it that is a declick rather than a step.
CUT_MAX_GAP_SECONDS = 0.25
CUT_MIN_DECLICK_MS = 5.0

#: A window whose share of energy away from both tones' overtones rises this far above the same
#: capture's steady audio holds a click. A click is broadband; two tones, even while their gains
#: ramp, keep their energy on their overtones. Relative, because each renderer has its own floor.
CLICK_DB = 10.0


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        if handle.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit PCM")
        rate = handle.getframerate()
        channels = handle.getnchannels()
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float64)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples / 32768.0, rate


def tone_levels(samples: np.ndarray, rate: int, hz: float) -> np.ndarray:
    """The tone's amplitude per hop, from the largest bin within 6% of its pitch."""
    window = int(rate * WINDOW_SECONDS)
    hop = int(rate * HOP_SECONDS)
    taper = np.hanning(window)
    freqs = np.fft.rfftfreq(window, 1.0 / rate)
    near = np.abs(freqs - hz) <= hz * 0.06
    levels = []
    for start in range(0, len(samples) - window, hop):
        spectrum = np.abs(np.fft.rfft(samples[start : start + window] * taper))
        levels.append(spectrum[near].max())
    return np.array(levels)


def steady_level(levels: np.ndarray) -> float:
    """The level a tone holds while it plays: a high percentile, so a click cannot set it."""
    return float(np.percentile(levels, 95)) or 1e-12


def ramp(levels: np.ndarray, peak: float, falling: bool) -> dict | None:
    """One tone's ramp: where it crosses RAMP_TOP and RAMP_BOTTOM, and how it moves over its whole extent."""
    norm = levels / peak
    floor = float(np.percentile(norm, 2))
    if falling:
        below = np.nonzero(norm < RAMP_BOTTOM)[0]
        if not len(below):
            return None
        end = int(below[0])
        above = np.nonzero(norm[:end] >= RAMP_TOP)[0]
        if not len(above):
            return None
        start = int(above[-1])
        top = np.nonzero(norm[: start + 1] >= FULL_TOP)[0]
        full_start = int(top[-1]) if len(top) else start
        quiet = np.nonzero(norm[end:] <= max(floor * 2, 0.01))[0]
        full_end = end + int(quiet[0]) if len(quiet) else len(norm) - 1
    else:
        above = np.nonzero(norm >= RAMP_TOP)[0]
        if not len(above):
            return None
        end = int(above[0])
        below = np.nonzero(norm[:end] < RAMP_BOTTOM)[0]
        if not len(below):
            return None
        start = int(below[-1])
        quiet = np.nonzero(norm[: start + 1] <= max(floor * 2, 0.01))[0]
        full_start = int(quiet[-1]) if len(quiet) else 0
        top = np.nonzero(norm[end:] >= FULL_TOP)[0]
        full_end = end + int(top[0]) if len(top) else len(norm) - 1
    segment = norm[start : end + 1]
    steps = np.diff(segment)
    reversal = float(steps.max()) if falling else float(-steps.min())
    line = np.linspace(segment[0], segment[-1], len(segment))
    whole = norm[full_start : full_end + 1]
    whole_steps = np.diff(whole)
    steepest = float(-whole_steps.min()) if falling else float(whole_steps.max())
    width = 11
    if len(segment) > 2 * width:
        smooth = np.convolve(segment, np.ones(width) / width, mode="valid")
        roughness = float(np.sqrt(np.mean((segment[width // 2 : width // 2 + len(smooth)] - smooth) ** 2)))
    else:
        roughness = 0.0
    return {
        "start": start,
        "end": end,
        "reversal": max(0.0, reversal) if len(steps) else 0.0,
        "deviation": float(np.abs(segment - line).max()),
        "steepest": max(0.0, steepest) if len(whole_steps) else 0.0,
        "roughness": roughness,
    }


def band_envelope(samples: np.ndarray, rate: int, lo: float, hi: float) -> np.ndarray:
    """A fine envelope of one band, for timing a declick that a 20 ms window would smear into a ramp."""
    spectrum = np.fft.rfft(samples)
    freqs = np.fft.rfftfreq(len(samples), 1.0 / rate)
    spectrum[(freqs < lo) | (freqs > hi)] = 0
    band = np.fft.irfft(spectrum, len(samples))
    full = np.fft.fft(band)
    gain = np.zeros(len(band))
    gain[0] = 1
    gain[1 : len(band) // 2] = 2
    envelope = np.abs(np.fft.ifft(full * gain))
    width = max(1, rate // 1000)
    return np.convolve(envelope, np.ones(width) / width, mode="same")


def cut_ramp_ms(envelope: np.ndarray, rate: int, around: int, falling: bool) -> float:
    """How long a tone takes to cross from 90% to 10% of its level near sample `around`."""
    span = rate // 10
    lo, hi = max(0, around - span), min(len(envelope), around + span)
    window = envelope[lo:hi]
    level = float(np.percentile(envelope, 95)) or 1e-12
    norm = window / level
    if falling:
        below = np.nonzero(norm < 0.1)[0]
        if not len(below):
            return 0.0
        end = int(below[0])
        above = np.nonzero(norm[:end] >= 0.9)[0]
        start = int(above[-1]) if len(above) else end
    else:
        above = np.nonzero(norm >= 0.9)[0]
        if not len(above):
            return 0.0
        end = int(above[0])
        below = np.nonzero(norm[:end] < 0.1)[0]
        start = int(below[-1]) if len(below) else end
    return (end - start) * 1000.0 / rate


def between_harmonics(samples: np.ndarray, rate: int, low_hz: float, high_hz: float) -> np.ndarray:
    """Per hop, the energy away from every overtone of either tone."""
    window = int(rate * WINDOW_SECONDS)
    hop = int(rate * HOP_SECONDS)
    taper = np.hanning(window)
    freqs = np.fft.rfftfreq(window, 1.0 / rate)
    keep = (freqs >= 200) & (freqs <= 12000)
    for hz in (low_hz, high_hz):
        for order in range(1, int(12000 / hz) + 1):
            keep &= np.abs(freqs - hz * order) > max(120.0, hz * order * 0.06)
    impurity = []
    for start in range(0, len(samples) - window, hop):
        power = np.abs(np.fft.rfft(samples[start : start + window] * taper)) ** 2
        impurity.append(float(power[keep].sum() / max(power.sum(), 1e-18)))
    return np.array(impurity)


def click_db(impurity: np.ndarray, around: tuple[int, int]) -> float:
    """How far the join's most impure window rises above the steady audio's 99th percentile, in dB."""
    margin = int(0.1 / HOP_SECONDS)
    lo, hi = max(0, around[0] - margin), min(len(impurity), around[1] + margin + 1)
    steady = np.concatenate([impurity[: max(0, lo - margin)], impurity[hi + margin :]])
    if hi <= lo or not len(steady):
        return 0.0
    return float(10 * np.log10(max(impurity[lo:hi].max(), 1e-12) / max(np.percentile(steady, 99), 1e-12)))


def grade(path: str, crossfade_ms: int, low_hz: float, high_hz: float) -> dict:
    samples, rate = read_wav(path)
    low = tone_levels(samples, rate, low_hz)
    high = tone_levels(samples, rate, high_hz)
    low_peak, high_peak = steady_level(low), steady_level(high)
    out = ramp(low, low_peak, falling=True)
    into = ramp(high, high_peak, falling=False)
    hop_ms = HOP_SECONDS * 1000.0
    result: dict = {"file": path, "crossfade_ms": crossfade_ms, "faults": []}
    faults = result["faults"]
    if out is None or into is None:
        faults.append("the capture does not hold the first tune ending and the second starting")
        result["verdict"] = "NO TRANSITION"
        return result

    first, last = min(out["start"], into["start"]), max(out["end"], into["end"])
    both_low = (low[first : last + 1] / low_peak < SILENT) & (high[first : last + 1] / high_peak < SILENT)
    result["gap_ms"] = round(float(both_low.sum()) * hop_ms, 1)
    # Equal-gain ramps on two unrelated tones dip by 3 dB at the midpoint; that is the shape, not a fault.
    power = (low[first : last + 1] / low_peak) ** 2 + (high[first : last + 1] / high_peak) ** 2
    result["dip_db"] = round(float(10 * np.log10(max(power.min(), 1e-6))), 1)
    result["fade_out_ms"] = round((out["end"] - out["start"]) * hop_ms, 1)
    result["fade_in_ms"] = round((into["end"] - into["start"]) * hop_ms, 1)
    result["click_db"] = round(click_db(between_harmonics(samples, rate, low_hz, high_hz), (first, last)), 1)

    if crossfade_ms == 0:
        overlap = (low[first : last + 1] / low_peak >= RAMP_BOTTOM) & (high[first : last + 1] / high_peak >= RAMP_BOTTOM)
        result["overlap_ms"] = round(float(overlap.sum()) * hop_ms, 1)
        if result["overlap_ms"] > 2 * WINDOW_SECONDS * 1000:
            faults.append(f"the tunes overlap for {result['overlap_ms']} ms on a clean cut")
        if result["gap_ms"] > CUT_MAX_GAP_SECONDS * 1000:
            faults.append(f"{result['gap_ms']} ms of silence at the cut")
        # A cut is broadband by nature; what it must not be is a step. Each side ramps over a few ms.
        hop = int(rate * HOP_SECONDS)
        at_out, at_in = (out["start"] + out["end"]) // 2 * hop, (into["start"] + into["end"]) // 2 * hop
        result["cut_out_ms"] = round(cut_ramp_ms(band_envelope(samples, rate, 300, 800), rate, at_out, True), 1)
        result["cut_in_ms"] = round(cut_ramp_ms(band_envelope(samples, rate, 750, 1000), rate, at_in, False), 1)
        # The outgoing tune only: how the incoming one begins is the tune's own first note.
        if result["cut_out_ms"] < CUT_MIN_DECLICK_MS:
            faults.append(f"the first tune stopped in {result['cut_out_ms']} ms at the cut: a step, not a declick")
    else:
        expected = crossfade_ms * RAMP_FRACTION
        for name in ("fade_out_ms", "fade_in_ms"):
            # The analysis window smears a ramp by up to its own length.
            if abs(result[name] - expected) > expected * RAMP_TOLERANCE + WINDOW_SECONDS * 1000:
                faults.append(f"{name.replace('_ms', '').replace('_', ' ')} took {result[name]} ms, expected about {expected:.0f}")
        centre_out = (out["start"] + out["end"]) / 2 * hop_ms
        centre_in = (into["start"] + into["end"]) / 2 * hop_ms
        result["centre_offset_ms"] = round(centre_in - centre_out, 1)
        if abs(result["centre_offset_ms"]) > crossfade_ms * CENTRE_TOLERANCE + WINDOW_SECONDS * 1000:
            faults.append(f"the ramps are {result['centre_offset_ms']} ms apart: the tunes do not cross")
        slope = HOP_SECONDS * 1000.0 / crossfade_ms
        for label, curve in (("fade out", out), ("fade in", into)):
            key = label.replace(" ", "_")
            result[f"{key}_steepest_x"] = round(curve["steepest"] / slope, 2)
            result[f"{key}_roughness"] = round(curve["roughness"], 4)
            if curve["steepest"] > slope * STEEPEST_RATIO:
                faults.append(
                    f"the {label} has a step {curve['steepest']:.0%} of the level in {HOP_SECONDS * 1000:.0f} ms, "
                    f"{curve['steepest'] / slope:.1f}x the ramp's slope: a sudden {'drop' if label == 'fade out' else 'jump'}"
                )
            if curve["roughness"] > ROUGHNESS_SLACK:
                faults.append(f"the {label} is jagged: {curve['roughness']:.2%} RMS off its own smooth course")
            if curve["reversal"] > MONOTONE_SLACK:
                faults.append(f"the {label} turned back by {curve['reversal']:.0%} of the level")
            if curve["deviation"] > LINEARITY_SLACK:
                faults.append(f"the {label} strayed {curve['deviation']:.0%} from a straight ramp")
        if result["gap_ms"] > 0:
            faults.append(f"{result['gap_ms']} ms of silence inside the crossfade")
        # Before its ramp the outgoing tune plays on at full level, and the incoming one is not heard at
        # all: a blip of the new tune, or a dip in the old one, ahead of the fade is a stutter.
        # Clear of each ramp's first window, which the analysis window already smears into the ramp.
        smear = int(WINDOW_SECONDS / HOP_SECONDS)
        lead_in = max(0, min(out["start"], into["start"]) - int(1.0 / HOP_SECONDS))
        # Where each linear ramp truly begins: an eighth of its 90-to-10% span ahead of the 90% point.
        out_begin = out["start"] - (out["end"] - out["start"]) // 8
        in_begin = into["start"] - (into["end"] - into["start"]) // 8
        out_end, in_end = max(lead_in + 1, out_begin - smear), max(lead_in + 1, in_begin - smear)
        result["outgoing_before_ramp"] = round(float((low[lead_in:out_end] / low_peak).min()), 3)
        result["incoming_before_ramp"] = round(float((high[lead_in:in_end] / high_peak).max()), 3)
        if result["outgoing_before_ramp"] < HOLD_LEVEL:
            faults.append(f"the first tune dipped to {result['outgoing_before_ramp']:.0%} before its fade")
        if result["incoming_before_ramp"] > BLIP_LEVEL:
            faults.append(f"the second tune was heard at {result['incoming_before_ramp']:.0%} before its fade began")
    if crossfade_ms > 0 and result["click_db"] > CLICK_DB:
        faults.append(f"broadband energy {result['click_db']} dB above the steady audio at the join: a click")
    result["verdict"] = "SMOOTH" if not faults else "FAULTY"
    return result


#: Microphone grading. Room sound only adds energy at a tone's pitch, so a dip is real however loud
#: the room is: the outgoing tone may not dip before its fade, nor the incoming one after its rise.
MIC_WINDOW_SECONDS = 0.05
MIC_HOP_SECONDS = 0.025
MIC_DIP_DB = -6.0
#: Deep enough that typing cannot explain it: on real takes a loud room moved the tones by 6.5 dB at
#: most, while an underrun's own edges are broadband and would hide it from the clean-window test.
MIC_DEEP_DIP_DB = -10.0
MIC_TOP_DB = -3.0
MIC_GONE_DB = -15.0
#: The longest both tones may be gone at once on a clean cut.
MIC_CUT_MAX_GAP_MS = 100.0
#: A linear ramp takes 53% of its length to fall from -3 to -15 dB; at the speaker it may not take
#: less than half of that, or the tail was cut short after it was written.
MIC_RAMP_FRACTION = 0.53
MIC_RAMP_FLOOR = 0.5


def mic_levels(samples: np.ndarray, rate: int, hz: float) -> np.ndarray:
    window = int(rate * MIC_WINDOW_SECONDS)
    hop = int(rate * MIC_HOP_SECONDS)
    taper = np.hanning(window)
    freqs = np.fft.rfftfreq(window, 1.0 / rate)
    near = np.abs(freqs - hz) <= max(20.0, hz * 0.06)
    return np.array(
        [np.abs(np.fft.rfft(samples[i : i + window] * taper))[near].max() for i in range(0, len(samples) - window, hop)]
    )


def mic_room(samples: np.ndarray, rate: int, low_hz: float, high_hz: float) -> np.ndarray:
    """Per window, whether the room was loud: energy between both tones' overtones 6 dB over its median.

    Typing or speech near the microphone is broadband, and at the level of the tone it can cancel the
    tone's bin as easily as add to it, so a window it lands in says nothing about a dip.
    """
    window = int(rate * MIC_WINDOW_SECONDS)
    hop = int(rate * MIC_HOP_SECONDS)
    taper = np.hanning(window)
    freqs = np.fft.rfftfreq(window, 1.0 / rate)
    keep = (freqs >= 300) & (freqs <= 8000)
    for hz in (low_hz, high_hz):
        for order in range(1, int(8000 / hz) + 1):
            keep &= np.abs(freqs - hz * order) > max(40.0, hz * order * 0.06)
    room = np.array(
        [np.sqrt((np.abs(np.fft.rfft(samples[i : i + window] * taper))[keep] ** 2).mean()) for i in range(0, len(samples) - window, hop)]
    )
    return room > np.median(room) * 2.0


def grade_mic(path: str, crossfade_ms: int, low_hz: float, high_hz: float) -> dict:
    """What reached the speaker: no dip in either tune, no silence between them, ramps not cut short."""
    samples, rate = read_wav(path)
    hop_ms = MIC_HOP_SECONDS * 1000.0
    db = lambda levels: 20 * np.log10(levels / max(np.percentile(levels, 95), 1e-12) + 1e-9)  # noqa: E731
    low, high = db(mic_levels(samples, rate, low_hz)), db(mic_levels(samples, rate, high_hz))
    result: dict = {"file": path, "crossfade_ms": crossfade_ms, "faults": []}
    faults = result["faults"]
    # Where each ramp lies, from envelopes with taps and room clatter filtered out; the dips below are
    # judged on the raw envelopes, where a dip cannot be the room's doing.
    smooth = lambda levels: np.array([np.median(levels[max(0, i - 2) : i + 3]) for i in range(len(levels))])  # noqa: E731
    low_s, high_s = smooth(low), smooth(high)
    sustained = int(0.15 / MIC_HOP_SECONDS)
    low_gone = [i for i in range(len(low_s) - sustained) if (low_s[i : i + sustained] < MIC_GONE_DB).all()]
    high_gone = [i for i in range(sustained, len(high_s)) if (high_s[i - sustained : i] < MIC_GONE_DB).all()]
    if not low_gone or not high_gone:
        result["verdict"] = "NO TRANSITION"
        faults.append("the microphone did not hear the first tune give way to the second")
        return result
    gone_at, quiet_until = low_gone[0], high_gone[-1]
    low_up = np.nonzero(low_s[:gone_at] >= MIC_TOP_DB)[0]
    high_up = np.nonzero(high_s[quiet_until:] >= MIC_TOP_DB)[0]
    if not len(low_up) or not len(high_up):
        result["verdict"] = "NO TRANSITION"
        faults.append("the microphone did not hear both tunes at full level")
        return result
    fall_start, rise_end = int(low_up[-1]), quiet_until + int(high_up[0])
    loud = mic_room(samples, rate, low_hz, high_hz)
    # The first windows hold arecord's own start-up.
    loud[:2] = True
    result["loud_room_share"] = round(float(loud.mean()), 2)
    clean_low = np.where(loud, 0.0, low)
    clean_high = np.where(loud, 0.0, high)
    for key, label, clean, raw, offset in (
        ("outgoing_dip_db", "first tune dipped", clean_low[: fall_start + 1], low[2 : fall_start + 1], 0),
        ("incoming_dip_db", "second tune dipped", clean_high[rise_end:], high[rise_end:], rise_end),
    ):
        result[key] = round(float(clean.min()), 1) if len(clean) else 0.0
        deep = round(float(raw.min()), 1) if len(raw) else 0.0
        where = "before its fade" if offset == 0 else "after its rise"
        if result[key] < MIC_DIP_DB:
            faults.append(f"the {label} {result[key]} dB at {(offset + int(np.argmin(clean))) * hop_ms:.0f} ms, {where}")
        elif deep < MIC_DEEP_DIP_DB:
            at = (offset + int(np.argmin(raw)) + (2 if offset == 0 else 0)) * hop_ms
            faults.append(f"the {label} {deep} dB at {at:.0f} ms, {where}")
    span = slice(fall_start, rise_end + 1)
    gone = (low[span] < MIC_GONE_DB) & (high[span] < MIC_GONE_DB) & ~loud[span]
    result["gap_ms"] = round(float(gone.sum()) * hop_ms, 1)
    result["fall_ms"] = round(float(gone_at - fall_start) * hop_ms, 1)
    rising = np.nonzero(high_s[: rise_end + 1] < MIC_GONE_DB)[0]
    result["rise_ms"] = round(float(rise_end - rising[-1]) * hop_ms, 1) if len(rising) else None
    if crossfade_ms == 0:
        if result["gap_ms"] > MIC_CUT_MAX_GAP_MS:
            faults.append(f"{result['gap_ms']} ms of silence at the cut")
    else:
        if result["gap_ms"] > 0:
            faults.append(f"{result['gap_ms']} ms of silence inside the crossfade")
        least = crossfade_ms * MIC_RAMP_FRACTION * MIC_RAMP_FLOOR
        for name, label in (("fall_ms", "first tune fell away"), ("rise_ms", "second tune rose")):
            if result[name] is not None and result[name] < least:
                faults.append(f"the {label} in {result[name]} ms at the speaker; a {crossfade_ms} ms fade takes about {crossfade_ms * MIC_RAMP_FRACTION:.0f}")
    result["verdict"] = "SMOOTH" if not faults else "FAULTY"
    return result


def synthetic(
    crossfade_ms: int,
    rate: int = 48000,
    kink: bool = False,
    gap_ms: int = 0,
    click: bool = False,
    truncate: float = 0.0,
    stairs_ms: int = 0,
    jump: float = 0.0,
    jitter: float = 0.0,
    declick_ms: float = 10.0,
):
    """Two sawtooth tones joined the way LocalAudioFeed joins them: linear ramps over the same span."""
    seconds = 8.0
    t = np.arange(int(rate * seconds)) / rate
    # Band-limited, as a SID's output is: a naive sawtooth aliases into the bins the click check reads.
    saw = lambda hz: 0.2 * sum(np.sin(2 * np.pi * hz * k * t) / k for k in range(1, int(10000 / hz) + 1))  # noqa: E731
    at = int(rate * 4.0)
    span = max(1, int(rate * crossfade_ms / 1000))
    out_gain = np.ones_like(t)
    in_gain = np.zeros_like(t)
    if crossfade_ms == 0:
        # A cut with a 10 ms declick either side: a hard step would itself be a click.
        declick = max(1, int(rate * declick_ms / 1000))
        out_gain[at : at + declick] = np.linspace(1.0, 0.0, declick)
        out_gain[at + declick :] = 0.0
        begin = at + declick + int(rate * gap_ms / 1000)
        in_gain[begin : begin + declick] = np.linspace(0.0, 1.0, declick)
        in_gain[begin + declick :] = 1.0
    else:
        out_gain[at : at + span] = np.linspace(1.0, 0.0, span)
        out_gain[at + span :] = 0.0
        in_gain[at : at + span] = np.linspace(0.0, 1.0, span)
        in_gain[at + span :] = 1.0
        if kink:
            back = at + span // 2
            out_gain[back : back + span // 8] = out_gain[back - span // 8 : back][::-1]
        if truncate:
            out_gain[out_gain < truncate] = 0.0
        if jump:
            in_gain[(in_gain > 0) & (in_gain < jump)] = jump
        if stairs_ms:
            step = int(rate * stairs_ms / 1000)
            for gain in (out_gain, in_gain):
                ramp_part = gain[at : at + span].copy()
                for k in range(0, span, step):
                    ramp_part[k : k + step] = ramp_part[k]
                gain[at : at + span] = ramp_part
        if jitter:
            noise = 1 + np.repeat(np.random.default_rng(3).normal(0, jitter, span // 240 + 1), 240)[:span]
            out_gain[at : at + span] *= noise
            in_gain[at : at + span] *= noise
        if gap_ms:
            in_gain[at : at + span] = 0.0
            out_gain[at : at + span] = 0.0
            in_gain[at + span : at + span + int(rate * gap_ms / 1000)] = 0.0
    signal = saw(550) * out_gain + saw(900) * in_gain
    if click:
        signal[at + span // 3 : at + span // 3 + 3] += 0.5
    return signal, rate


def self_test() -> int:
    import os
    import tempfile

    cases = [
        ("a 1.5 s crossfade as asked", 1500, {}, 1500, "SMOOTH"),
        ("a 4 s crossfade as asked", 4000, {}, 4000, "SMOOTH"),
        ("a 0.6 s crossfade as asked", 600, {}, 600, "SMOOTH"),
        ("a clean cut", 0, {}, 0, "SMOOTH"),
        ("a 1.5 s crossfade graded as 4 s", 1500, {}, 4000, "FAULTY"),
        ("a fade that turns back", 3000, {"kink": True}, 3000, "FAULTY"),
        ("silence instead of a crossfade", 1500, {"gap_ms": 300}, 1500, "FAULTY"),
        ("a click in the join", 1500, {"click": True}, 1500, "FAULTY"),
        ("a clean cut with a long gap", 0, {"gap_ms": 600}, 0, "FAULTY"),
        ("a clean cut with no declick", 0, {"declick_ms": 0}, 0, "FAULTY"),
        ("the outgoing tune cut off at 30%", 1500, {"truncate": 0.3}, 1500, "FAULTY"),
        ("the outgoing tune cut off at 12%", 3000, {"truncate": 0.12}, 3000, "FAULTY"),
        ("the incoming tune jumping in at 25%", 1500, {"jump": 0.25}, 1500, "FAULTY"),
        ("gain moved in 50 ms stairs", 1500, {"stairs_ms": 50}, 1500, "FAULTY"),
        ("gain moved in 50 ms stairs over 4 s", 4000, {"stairs_ms": 50}, 4000, "FAULTY"),
        ("a jittery ramp", 3000, {"jitter": 0.03}, 3000, "FAULTY"),
    ]
    failures = 0
    for name, made_ms, options, graded_ms, expected in cases:
        signal, rate = synthetic(made_ms, **options)
        handle, path = tempfile.mkstemp(suffix=".wav")
        os.close(handle)
        try:
            with wave.open(path, "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(rate)
                out.writeframes((np.clip(signal, -1, 1) * 32000).astype("<i2").tobytes())
            result = grade(path, graded_ms, 550.0, 900.0)
        finally:
            os.unlink(path)
        ok = result["verdict"] == expected
        failures += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FAIL'} {name}: {result['verdict']} {'; '.join(result['faults'])}")
    rng = np.random.default_rng(11)
    room = lambda n: rng.normal(0, 0.002, n)  # noqa: E731

    def typing(signal, rate):
        # Key clicks: 5 ms broadband bursts as loud as the tones, a few per second.
        for at in rng.integers(0, len(signal) - rate // 200, 40):
            signal[at : at + rate // 200] += rng.normal(0, 0.25, rate // 200)
        return signal

    def underrun(signal, rate, at_s=6.0, ms=60):
        signal[int(rate * at_s) : int(rate * (at_s + ms / 1000))] = 0.0
        return signal

    mic_cases = [
        ("the speaker: a 1.5 s crossfade", 1500, {}, None, "SMOOTH"),
        ("the speaker: a clean cut", 0, {}, None, "SMOOTH"),
        ("the speaker: a 1.5 s crossfade under typing", 1500, {}, typing, "SMOOTH"),
        ("the speaker: an underrun after the rise", 1500, {}, underrun, "FAULTY"),
        ("the speaker: an underrun under typing", 3000, {}, lambda s, r: typing(underrun(s, r, 7.5, 80), r), "FAULTY"),
        ("the speaker: the tail cut at 70%", 3000, {"truncate": 0.7}, None, "FAULTY"),
        ("the speaker: a clean cut with a long gap", 0, {"gap_ms": 400}, None, "FAULTY"),
    ]
    for name, made_ms, options, damage, expected in mic_cases:
        signal, rate = synthetic(made_ms, **options)
        signal = signal + room(len(signal))
        if damage:
            signal = damage(signal, rate)
        handle, path = tempfile.mkstemp(suffix=".wav")
        os.close(handle)
        try:
            with wave.open(path, "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(rate)
                out.writeframes((np.clip(signal, -1, 1) * 32000).astype("<i2").tobytes())
            result = grade_mic(path, made_ms, 550.0, 900.0)
        finally:
            os.unlink(path)
        ok = result["verdict"] == expected
        failures += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FAIL'} {name}: {result['verdict']} {'; '.join(result['faults'])}")
    total = len(cases) + len(mic_cases)
    print(f"\n{total - failures}/{total} cases correct")
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("wav", nargs="?")
    parser.add_argument("--crossfade-ms", type=int, default=1500)
    parser.add_argument("--low-hz", type=float, default=550.0)
    parser.add_argument("--high-hz", type=float, default=900.0)
    parser.add_argument("--mic", action="store_true", help="grade a microphone recording rather than a capture")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.wav:
        parser.error("a capture is required")
    grader = grade_mic if args.mic else grade
    result = grader(args.wav, args.crossfade_ms, args.low_hz, args.high_hz)
    if args.json:
        print(json.dumps(result))
    else:
        for key, value in result.items():
            print(f"{key:18} {value}")
    return 0 if result["verdict"] == "SMOOTH" else 1


if __name__ == "__main__":
    sys.exit(main())
