#!/usr/bin/env python3
"""End-to-end audio quality, measured through the air.

Every other check in this campaign reads a counter the app keeps about itself. This one believes
nothing: the C64 plays a stimulus of its own making, the phone mirrors it over Wi-Fi, the phone's
loudspeaker plays it into the room, and a microphone on the host grades what comes back. A fault
anywhere on that path — the network, the jitter buffer, the resampler, the AudioTrack — lands in the
recording, whatever the counters say.

## Why a purpose-built stimulus

A SID tune cannot grade a pipeline. Its own amplitude moves constantly, so an envelope dip means
nothing; its pitch changes, so a resampling error is invisible; and it has no landmarks, so a
listener (or an analyser) cannot tell a skipped 50 ms from a skipped bar.

The stimulus here is a **frequency barcode**: a repeating cycle of eight tones of distinct,
non-harmonically-related pitches, each held for a fixed number of PAL frames and separated by a
fixed silence. It is sequenced by a small 6502 program that counts raster frames, so the timing is
the C64's own crystal rather than anything on the network. That makes four independent faults
measurable, none of which a musical passage can expose:

  * **Crackle** — the tone's energy collapsing mid-burst, when nothing in the source moved.
  * **Timing** — onsets must be exactly one slot apart. A pipeline that discards a backlog plays the
    next tone early; one that conceals plays it late.
  * **Structure** — the pitches must arrive in order. A repeated or missing tone means a whole
    segment was lost or replayed, which no amount of envelope watching would reveal.
  * **Speed** — each tone's measured pitch against the frequency the SID was actually given.

Usage:
  audio_e2e_probe.py build     [--out probe.prg]
  audio_e2e_probe.py play      [--host c64u] [--password pwd]
  audio_e2e_probe.py record    [--seconds 30] [--device ...] [--out capture.wav]
  audio_e2e_probe.py analyse   capture.wav
  audio_e2e_probe.py run       [--seconds 30] [--wire-out wire.wav]   # play, record and grade in one go
"""

from __future__ import annotations

import argparse
import math
import subprocess
import sys
import threading
import time
import urllib.request
import wave
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
from lan_iface import resolve_iface  # noqa: E402

# ---------------------------------------------------------------------------------------------
# The stimulus
# ---------------------------------------------------------------------------------------------

# Eight tones, none an integer multiple of another. A triangle wave is rich in harmonics, and a
# barcode whose fourth tone sits on the second harmonic of its first cannot be read back reliably.
TONES_HZ = [700, 780, 870, 970, 1080, 1210, 1350, 1510]

ON_FRAMES = 8
OFF_FRAMES = 4
SLOT_FRAMES = ON_FRAMES + OFF_FRAMES

# PAL: 312 raster lines x 63 cycles at 985248 Hz.
PAL_FRAME_MS = 312 * 63 / 985248 * 1000
SLOT_MS = SLOT_FRAMES * PAL_FRAME_MS
ON_MS = ON_FRAMES * PAL_FRAME_MS

# SID frequency register = Fout * 2^24 / clock.
PAL_CLOCK = 985248


def sid_freq(hz: float) -> int:
    return int(round(hz * (1 << 24) / PAL_CLOCK)) & 0xFFFF


class Assembler:
    """Just enough 6502 to express the stimulus, with two-pass label resolution."""

    def __init__(self, origin: int):
        self.origin = origin
        self.code: list[int] = []
        self.labels: dict[str, int] = {}
        self.fixups: list[tuple[int, str, str]] = []

    @property
    def pc(self) -> int:
        return self.origin + len(self.code)

    def label(self, name: str) -> None:
        self.labels[name] = self.pc

    def emit(self, *bytes_: int) -> None:
        self.code.extend(bytes_)

    def abs_ref(self, opcode: int, name: str) -> None:
        self.emit(opcode)
        self.fixups.append((len(self.code), name, "abs"))
        self.emit(0, 0)

    def rel_ref(self, opcode: int, name: str) -> None:
        self.emit(opcode)
        self.fixups.append((len(self.code), name, "rel"))
        self.emit(0)

    def link(self) -> bytes:
        for index, name, kind in self.fixups:
            target = self.labels[name]
            if kind == "abs":
                self.code[index] = target & 0xFF
                self.code[index + 1] = (target >> 8) & 0xFF
            else:
                delta = target - (self.origin + index + 1)
                if not -128 <= delta <= 127:
                    raise ValueError(f"branch to {name} out of range ({delta})")
                self.code[index] = delta & 0xFF
        return bytes(self.code)


def build_prg() -> bytes:
    """A BASIC stub plus the raster-timed barcode player."""
    load_address = 0x0801
    # 10 SYS 2061
    stub = bytes([0x0B, 0x08, 0x0A, 0x00, 0x9E, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00])
    a = Assembler(load_address + len(stub))

    a.emit(0x78)  # SEI - the kernal IRQ must not perturb the raster counting
    a.emit(0xA9, 0x0F)
    a.emit(0x8D, 0x18, 0xD4)  # STA $D418 - master volume 15
    a.emit(0xA9, 0x00)
    a.emit(0x8D, 0x05, 0xD4)  # STA $D405 - attack 0, decay 0
    a.emit(0xA9, 0xF0)
    a.emit(0x8D, 0x06, 0xD4)  # STA $D406 - sustain 15, release 0

    a.label("cycle")
    a.emit(0xA2, 0x00)  # LDX #0
    a.label("slot")
    a.abs_ref(0xBD, "freqlo")  # LDA freqlo,X
    a.emit(0x8D, 0x00, 0xD4)  # STA $D400
    a.abs_ref(0xBD, "freqhi")  # LDA freqhi,X
    a.emit(0x8D, 0x01, 0xD4)  # STA $D401
    a.emit(0xA9, 0x11)
    a.emit(0x8D, 0x04, 0xD4)  # STA $D404 - triangle + gate on
    a.emit(0xA0, ON_FRAMES)  # LDY #ON_FRAMES
    a.abs_ref(0x20, "waitframes")  # JSR waitframes
    a.emit(0xA9, 0x10)
    a.emit(0x8D, 0x04, 0xD4)  # STA $D404 - gate off
    a.emit(0xA0, OFF_FRAMES)  # LDY #OFF_FRAMES
    a.abs_ref(0x20, "waitframes")  # JSR waitframes
    a.emit(0xE8)  # INX
    a.emit(0xE0, len(TONES_HZ))  # CPX #count
    a.rel_ref(0xD0, "slot")  # BNE slot
    a.abs_ref(0x4C, "cycle")  # JMP cycle

    # One frame = raster line $FA seen once. Line 0 will not do: $D012 is the low byte of a 312-line
    # counter, so it reads 0 twice per frame and would count half-frames.
    a.label("waitframes")
    a.label("wf_outer")
    a.label("wf_high")
    a.emit(0xAD, 0x12, 0xD0)  # LDA $D012
    a.emit(0xC9, 0xFA)  # CMP #$FA
    a.rel_ref(0xF0, "wf_high")  # BEQ wf_high - step off the line if we are on it
    a.label("wf_wait")
    a.emit(0xAD, 0x12, 0xD0)  # LDA $D012
    a.emit(0xC9, 0xFA)  # CMP #$FA
    a.rel_ref(0xD0, "wf_wait")  # BNE wf_wait
    a.emit(0x88)  # DEY
    a.rel_ref(0xD0, "wf_outer")  # BNE wf_outer
    a.emit(0x60)  # RTS

    a.label("freqlo")
    for hz in TONES_HZ:
        a.emit(sid_freq(hz) & 0xFF)
    a.label("freqhi")
    for hz in TONES_HZ:
        a.emit((sid_freq(hz) >> 8) & 0xFF)

    body = a.link()
    return load_address.to_bytes(2, "little") + stub + body


def build_sid() -> bytes:
    """The same barcode as a PSID, so the on-device engine can be graded by the identical rig.

    The PRG counts raster lines itself; a PSID cannot, because the player owns the machine and calls
    `play` once a frame. So the state machine is driven by that call instead — which is the same clock,
    just handed over rather than taken. Anything that renders this file and gets the barcode back
    wrong has a fault, whether it is a C64, an emulator or the app's own engine.
    """
    load = 0x1000
    a = Assembler(load)
    a.abs_ref(0x4C, "init_body")  # $1000 JMP init
    a.abs_ref(0x4C, "play_body")  # $1003 JMP play

    a.label("init_body")
    a.emit(0xA9, 0x0F)
    a.emit(0x8D, 0x18, 0xD4)  # volume 15
    a.emit(0xA9, 0x00)
    a.emit(0x8D, 0x05, 0xD4)  # attack 0, decay 0
    a.emit(0xA9, 0xF0)
    a.emit(0x8D, 0x06, 0xD4)  # sustain 15, release 0
    a.emit(0xA9, 0x00)
    a.abs_ref(0x8D, "phase")
    a.abs_ref(0x8D, "slot")
    a.emit(0x60)  # RTS

    a.label("play_body")
    a.abs_ref(0xAE, "slot")  # LDX slot
    a.abs_ref(0xAD, "phase")  # LDA phase
    a.rel_ref(0xD0, "not_start")  # BNE not_start
    a.abs_ref(0xBD, "freqlo")  # LDA freqlo,X
    a.emit(0x8D, 0x00, 0xD4)
    a.abs_ref(0xBD, "freqhi")  # LDA freqhi,X
    a.emit(0x8D, 0x01, 0xD4)
    a.emit(0xA9, 0x11)
    a.emit(0x8D, 0x04, 0xD4)  # gate on
    a.abs_ref(0x4C, "advance")
    a.label("not_start")
    a.emit(0xC9, ON_FRAMES)  # CMP #ON_FRAMES
    a.rel_ref(0xD0, "advance")
    a.emit(0xA9, 0x10)
    a.emit(0x8D, 0x04, 0xD4)  # gate off
    a.label("advance")
    a.abs_ref(0xEE, "phase")  # INC phase
    a.abs_ref(0xAD, "phase")
    a.emit(0xC9, SLOT_FRAMES)
    a.rel_ref(0xD0, "done")
    a.emit(0xA9, 0x00)
    a.abs_ref(0x8D, "phase")
    a.emit(0xE8)  # INX
    a.emit(0xE0, len(TONES_HZ))
    a.rel_ref(0xD0, "store_slot")
    a.emit(0xA2, 0x00)  # LDX #0
    a.label("store_slot")
    a.abs_ref(0x8E, "slot")  # STX slot
    a.label("done")
    a.emit(0x60)  # RTS

    a.label("phase")
    a.emit(0x00)
    a.label("slot")
    a.emit(0x00)
    a.label("freqlo")
    for hz in TONES_HZ:
        a.emit(sid_freq(hz) & 0xFF)
    a.label("freqhi")
    for hz in TONES_HZ:
        a.emit((sid_freq(hz) >> 8) & 0xFF)

    body = a.link()
    data = load.to_bytes(2, "little") + body  # PSID with loadAddress 0 takes it from the data

    def text(value: str) -> bytes:
        return value.encode("latin-1")[:31].ljust(32, b"\x00")

    header = bytearray()
    header += b"PSID"
    header += (2).to_bytes(2, "big")  # version
    header += (0x7C).to_bytes(2, "big")  # data offset
    header += (0).to_bytes(2, "big")  # load address: take from the data
    header += (0x1000).to_bytes(2, "big")  # init
    header += (0x1003).to_bytes(2, "big")  # play
    header += (1).to_bytes(2, "big")  # songs
    header += (1).to_bytes(2, "big")  # start song
    header += (0).to_bytes(4, "big")  # speed: vertical blank (50 Hz PAL)
    header += text("C64 Commander timing barcode")
    header += text("C64 Commander HIL")
    header += text("2026")
    # PAL, and 6581 — bits 4-5 are the SID model, so 6581 is 0b01 there, not 0b10. This said 8580
    # while its comment said 6581. It went unnoticed because the barcode is a bare triangle wave with
    # the filter untouched, and the two models only diverge once the filter is in play — but a stimulus
    # whose declared hardware does not match its description is a trap for whoever reads it next.
    header += (0b010100).to_bytes(2, "big")
    header += bytes([0, 0])  # start page, page length
    header += bytes([0, 0])  # second SID address, third SID address (one byte each)
    assert len(header) == 0x7C, len(header)
    return bytes(header) + data


def play(host: str, password: str, prg: bytes) -> None:
    boundary = "----c64probe"
    parts = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="probe.prg"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + prg + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        f"http://{host}/v1/runners:run_prg",
        data=parts,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Password": password},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        print(f"run_prg -> HTTP {response.status} {response.read(200).decode(errors='replace').strip()}")


# ---------------------------------------------------------------------------------------------
# The grading
# ---------------------------------------------------------------------------------------------


def read_wav(path: str) -> tuple[list[float], int]:
    with wave.open(path, "rb") as fh:
        rate, channels, width = fh.getframerate(), fh.getnchannels(), fh.getsampwidth()
        raw = fh.readframes(fh.getnframes())
    if width != 2:
        raise SystemExit(f"expected 16-bit audio, got {width * 8}-bit")
    step = 2 * channels
    return [float(int.from_bytes(raw[i : i + 2], "little", signed=True)) for i in range(0, len(raw) - step + 1, step)], rate


def goertzel(samples: list[float], rate: int, hz: float, start: int, count: int) -> float:
    w = 2.0 * math.pi * hz / rate
    coeff = 2.0 * math.cos(w)
    s1 = s2 = 0.0
    for i in range(start, min(start + count, len(samples))):
        s0 = samples[i] + coeff * s1 - s2
        s2, s1 = s1, s0
    return math.sqrt(max(0.0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / max(1, count)


GRADED_BAND_HZ = (300.0, 6000.0)


def band_limited(samples: list[float], rate: int) -> list[float]:
    """Keep 300-6000 Hz. The room's rumble sits below 300 Hz and leaks into the 2 ms edge windows."""
    import numpy as np  # analysis only: build-sid and the stimulus tools must run without numpy
    signal = np.asarray(samples, dtype=np.float64)
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1.0 / rate)
    spectrum[(freqs < GRADED_BAND_HZ[0]) | (freqs > GRADED_BAND_HZ[1])] = 0
    return np.fft.irfft(spectrum, n=len(signal)).tolist()


def read_graded_wav(path: str) -> tuple[list[float], int]:
    """A recording as every grader in this file and `explain_clarity.py` reads it."""
    samples, rate = read_wav(path)
    return band_limited(samples, rate), rate


# A phone speaker at low volume can carry a tone's third harmonic louder than the tone itself; a
# grader that only listens at the fundamental then loses the note in room noise.
PARTIALS = (1, 2, 3, 4)
# A note's harmonics may vote for it only while its own fundamental is present: at least this share of
# the strongest ladder fundamental, and of the note's own strongest partial. A lone sound at 3630 Hz
# is then never read as a 1210 Hz note.
FUNDAMENTAL_PRESENCE = 0.5
FUNDAMENTAL_UNDER_PARTIAL = 0.1
# A ratio between near-silent bands means nothing: the band-limit's own ringing in a gap is enough to
# put one band of a digital silence twice above the rest. Bursts are read from windows within 26 dB
# of the recording's loud windows.
SILENCE_BELOW_LOUD = 0.05
# A note's edge is where its tone stays gone for this many 1 ms steps.
EDGE_CONFIRM = 3
# A knock in the room can swamp every ladder band for a window or two while a note carries on under
# it. Up to this many 25 ms windows between two runs of the same note are that note, provided the
# whole span is no longer than one note: the ladder's 79.8 ms silence can leave as few as two clear
# windows between two of the same note, and a note played again must still read as a replay. A real
# gap inside a note is still graded by the 5 ms dropout pass.
BRIDGE_WINDOWS = 2


def coarse_levels(samples: list[float], rate: int, hz: float, window: int, steps: int) -> np.ndarray:
    """`goertzel` over consecutive windows of `window` samples, all at once."""
    import numpy as np  # analysis only: build-sid and the stimulus tools must run without numpy
    frames = np.asarray(samples[: window * steps], dtype=np.float64).reshape(steps, window)
    basis = np.exp(-2j * np.pi * hz * np.arange(window) / rate)
    return np.abs(frames @ basis) / window


def strongest_partial(samples: list[float], rate: int, tone: int, start: int, count: int) -> int:
    """Which partial of a ladder note carries it best over `start..start+count`: 1 is the fundamental."""
    usable = [k for k in PARTIALS if k * TONES_HZ[tone] < GRADED_BAND_HZ[1]]
    return max(usable, key=lambda k: goertzel(samples, rate, k * TONES_HZ[tone], start, count))


def identify_tones(levels: np.ndarray) -> np.ndarray:
    """Per coarse window, the index of the ladder note sounding, or -1.

    `levels[t, k - 1, i]` is note t's level at partial k in window i (0 above the graded band). A note
    scores the sum of its partials while its fundamental is present, and its fundamental otherwise.
    A ratio, not a level: room noise and speaker colouration raise every band together, so only one
    note standing clearly above the others means a tone of the barcode is really sounding.
    """
    import numpy as np  # analysis only: build-sid and the stimulus tools must run without numpy
    fundamentals = levels[:, 0]
    present = (fundamentals >= fundamentals.max(axis=0) * FUNDAMENTAL_PRESENCE) & (
        fundamentals >= levels.max(axis=1) * FUNDAMENTAL_UNDER_PARTIAL
    )
    scores = np.where(present, levels.sum(axis=1), fundamentals)
    order = np.sort(scores, axis=0)
    loud = order[-1] >= np.percentile(order[-1], 95) * SILENCE_BELOW_LOUD
    clear = (order[-1] >= order[-2] * 2.0) & loud
    return np.where(clear, np.argmax(scores, axis=0), -1)


def bridge_interruptions(sounding: np.ndarray, note_windows: int, max_windows: int = BRIDGE_WINDOWS) -> np.ndarray:
    """`sounding` with a short interruption inside one note set to that note.

    A run of up to `max_windows` windows between two runs of the same note is bridged when the two runs
    and the interruption together span at most `note_windows` windows.
    """
    import numpy as np  # analysis only: build-sid and the stimulus tools must run without numpy
    runs: list[list[int]] = []  # [value, start, length]
    for index, value in enumerate(sounding.tolist()):
        if runs and runs[-1][0] == value:
            runs[-1][2] += 1
        else:
            runs.append([value, index, 1])
    bridged = sounding.copy()
    for before, gap, after in zip(runs, runs[1:], runs[2:]):
        span = after[1] + after[2] - before[1]
        if before[0] >= 0 and after[0] == before[0] and gap[2] <= max_windows and span <= note_windows:
            bridged[gap[1] : gap[1] + gap[2]] = before[0]
    return bridged


def detect_bursts(samples: list[float], rate: int) -> list[tuple[int, int, int]]:
    """Every tone burst the grader reads, as (onset, offset, tone index), first and last trimmed.

    Shared with `explain_clarity.py` so an explanation is about the bursts this verdict counted.
    Pass samples from `read_graded_wav`, band-limited, as `analyse` does.
    """
    import numpy as np  # analysis only: build-sid and the stimulus tools must run without numpy
    if len(samples) < rate * 3:
        raise SystemExit("recording too short to grade")

    # TWO passes, because identification and dropout detection want opposite window lengths.
    #
    # Telling 700 Hz from 780 Hz needs a window long enough to resolve them — roughly 1/80 s — so a
    # 5 ms window cannot do it, and a first attempt that used one read the eight-tone barcode as a
    # single tone per cycle. Detecting a dropout, by contrast, wants the shortest window that still
    # contains the tone, because a 20 ms window averages a 10 ms hole away to nothing.
    #
    # So: a coarse pass identifies which tone is sounding and where each burst begins and ends, and a
    # fine pass then measures energy AT THAT KNOWN FREQUENCY inside the burst. The fine pass never has
    # to discriminate, so its window can be short.
    coarse_ms = 25.0
    coarse = int(rate * coarse_ms / 1000)
    steps = (len(samples) - coarse) // coarse
    if steps < 8:
        raise SystemExit("recording too short to grade")
    levels = np.array(
        [
            [
                coarse_levels(samples, rate, k * hz, coarse, steps) if k * hz < GRADED_BAND_HZ[1] else np.zeros(steps)
                for k in PARTIALS
            ]
            for hz in TONES_HZ
        ]
    )
    sounding = bridge_interruptions(identify_tones(levels), note_windows=math.ceil(ON_MS / coarse_ms) + 1)

    bursts: list[tuple[int, int, int]] = []
    i = 0
    while i < steps:
        top = int(sounding[i])
        if top < 0:
            i += 1
            continue
        j = i
        while j < steps and sounding[j] == top:
            j += 1
        if (j - i) * coarse_ms >= ON_MS * 0.4:
            bursts.append((i * coarse, j * coarse, top))
        i = max(j, i + 1)

    # The coarse pass locates a burst to within its own 25 ms window, which is far too blunt to grade
    # timing: quantisation alone showed 15.7 ms of "jitter" on a wire capture that cannot have any.
    # Walk back from each coarse start in 1 ms steps to where the tone actually crossed half its
    # eventual level, and the onset is good to about a millisecond.
    refine = max(1, int(rate / 1000))
    probe = refine * 2
    refined: list[tuple[int, int, int]] = []
    for start, end, tone in bursts:
        hz = TONES_HZ[tone] * strongest_partial(samples, rate, tone, start, end - start)
        # The reference uses the SAME 2 ms window as the search (a Goertzel's magnitude depends on how
        # many cycles it sees), and is the median over the coarse span: one reading from the middle of
        # a weak note can sit twice above its plateau, and the walk then stops at an ordinary ripple.
        mid = float(np.median([goertzel(samples, rate, hz, pos, probe) for pos in range(start, end - probe, refine)]))

        def gone(cursor: int, step: int) -> bool:
            """The tone stays below half its plateau for EDGE_CONFIRM steps: one low reading is a ripple."""
            return all(
                goertzel(samples, rate, hz, cursor + n * step, probe) < mid * 0.5
                for n in range(EDGE_CONFIRM)
                if 0 <= cursor + n * step <= len(samples) - probe
            )

        # Walk BACKWARD from inside the burst to the first window where the tone is not yet there.
        # Searching forward from before the coarse mark moved every onset back by the same amount,
        # so the intervals that timing is measured from came out unchanged.
        cursor = min(len(samples) - probe, start + coarse // 2)
        onset = cursor
        limit = max(0, start - 2 * coarse)
        while cursor > limit and not gone(cursor, -refine):
            onset = cursor
            cursor -= refine
        # The OFFSET too: the coarse segmentation carries a note's end into the window that straddles
        # gate-off, which read as a 13% dropout rate against a note whose body was flat to within 5%.
        cursor = min(len(samples) - probe, (start + end) // 2)
        offset = cursor
        while cursor < min(len(samples) - probe, end + coarse) and not gone(cursor, refine):
            offset = cursor
            cursor += refine
        refined.append((onset, offset, tone))
    # The first and last bursts are cut off by the recording boundaries, so their onsets and durations
    # are artefacts of when the microphone started, not of the pipeline. One truncated leading burst
    # was on its own contributing an 80 ms "worst case" to an otherwise ±5 ms measurement.
    return refined[1:-1] if len(refined) > 4 else refined


def analyse(path: str) -> int:
    samples, rate = read_graded_wav(path)
    bursts = detect_bursts(samples, rate)
    coarse_ms = 25.0
    coarse = int(rate * coarse_ms / 1000)

    print(f"recording       {len(samples) / rate:.1f}s at {rate} Hz")
    print(f"stimulus        {len(TONES_HZ)} tones, {ON_MS:.1f}ms on / {SLOT_MS - ON_MS:.1f}ms off, slot {SLOT_MS:.2f}ms")
    if len(bursts) < 6:
        print(f"only {len(bursts)} tone bursts found - is the probe running and the phone audible?")
        return 2

    # Every per-note measurement is taken at the partial that carries the note, and read as the note.
    partial_hz = [
        TONES_HZ[tone] * strongest_partial(samples, rate, tone, start, end - start) for start, end, tone in bursts
    ]

    # 1. Structure: the barcode must read in order, nothing missing, nothing repeated.
    sequence_errors = sum(1 for (_, _, a), (_, _, b) in zip(bursts, bursts[1:]) if b != (a + 1) % len(TONES_HZ))

    # 2. Timing: onsets one slot apart, against the C64's own crystal.
    onsets = [start / rate * 1000 for start, _, _ in bursts]
    intervals = [b - a for a, b in zip(onsets, onsets[1:])]
    good = [v for v in intervals if v < SLOT_MS * 1.5]
    mean_interval = sum(good) / len(good) if good else 0.0
    jitter = math.sqrt(sum((v - SLOT_MS) ** 2 for v in good) / len(good)) if good else 0.0
    worst = max((abs(v - SLOT_MS) for v in good), default=0.0)

    # 3. Crackle: the tone's own energy collapsing inside a burst the C64 held steady.
    fine_ms = 5.0
    fine = int(rate * fine_ms / 1000)
    dropouts = graded = 0
    for (start, end, _), hz in zip(bursts, partial_hz):
        # Grade the middle of the burst only. The edges are where the coarse segmentation is least
        # certain, and a window straddling gate-on or gate-off is legitimately quiet — counting those
        # as dropouts put 6.45% on a wire capture that was in fact perfect.
        # Between the refined edges, minus a couple of milliseconds either side for the gate's own
        # rise and fall. Everything in between is audio the C64 held perfectly steady, so any dip is
        # the pipeline's.
        body = [
            goertzel(samples, rate, hz, pos, fine)
            for pos in range(start + 2 * fine, end - 2 * fine, fine)
        ]
        if len(body) < 6:
            continue
        median = sorted(body)[len(body) // 2]
        for level in body:
            graded += 1
            if level < median * 0.4:
                dropouts += 1
    dropout_pct = 100.0 * dropouts / max(1, graded)

    # 4. Speed: the pitch produced, against the pitch the SID was given.
    longest_index = max(range(len(bursts)), key=lambda b: bursts[b][1] - bursts[b][0])
    longest = bursts[longest_index]
    expected = float(TONES_HZ[longest[2]])
    partial = partial_hz[longest_index] / expected
    best_level, measured = -1.0, expected
    for delta in range(-60, 61):
        hz = expected * (1 + delta / 1000.0)
        level = goertzel(samples, rate, hz * partial, longest[0] + fine, longest[1] - longest[0] - 2 * fine)
        if level > best_level:
            best_level, measured = level, hz
    cents = 1200 * math.log2(measured / expected)

    # 5. Per-note precision. The three faults a listener actually reports — a note the wrong LENGTH, a
    # note that CRACKLES, a note that goes briefly OFF-PITCH — are all properties of individual notes,
    # and an average over eighty of them hides every one. So each note is graded on its own and the
    # worst offenders are named.
    notes: list[dict] = []
    fine_for_notes = int(rate * 5 / 1000)
    for (start, end, tone), hz in zip(bursts, partial_hz):
        offset = end
        duration_ms = (offset - start) / rate * 1000

        # Pitch inside the note, in hops. A resampler that changes ratio mid-note, or a concealment
        # that repeats the wrong period, shifts the pitch for a few milliseconds only — invisible to
        # a single measurement across the whole note, and audible.
        hop = int(rate * 0.02)
        cents_span = 0.0
        pos = start + coarse
        while pos + hop * 2 < offset:
            best, at = -1.0, hz
            for delta in range(-40, 41, 2):
                probe_hz = hz * (1 + delta / 1000.0)
                level = goertzel(samples, rate, probe_hz, pos, hop * 2)
                if level > best:
                    best, at = level, probe_hz
            cents_span = max(cents_span, abs(1200 * math.log2(at / hz)))
            pos += hop
        body = [
            goertzel(samples, rate, hz, pos, fine_for_notes)
            for pos in range(start + 2 * fine_for_notes, offset - 2 * fine_for_notes, fine_for_notes)
        ]
        drops = 0
        if len(body) >= 6:
            med = sorted(body)[len(body) // 2]
            drops = sum(1 for level in body if level < med * 0.4)
        notes.append(
            {"tone": tone, "ms": duration_ms, "cents": cents_span, "start": start, "dropWindows": drops}
        )

    durations = [n["ms"] for n in notes]
    dur_median = sorted(durations)[len(durations) // 2]
    dur_worst = max(notes, key=lambda n: abs(n["ms"] - ON_MS))
    pitch_worst = max(notes, key=lambda n: n["cents"])
    long_notes = [n for n in notes if abs(n["ms"] - ON_MS) > 10]

    print(f"bursts read     {len(bursts)}  sequence errors {sequence_errors}")
    print(
        f"note length     median {dur_median:.1f}ms vs {ON_MS:.1f}ms; "
        f"{len(long_notes)} of {len(notes)} off by >10ms; worst {dur_worst['ms']:.1f}ms (tone {dur_worst['tone']})"
    )
    print(
        f"pitch stability worst wobble within a note {pitch_worst['cents']:.1f} cents "
        f"(tone {pitch_worst['tone']}); {sum(1 for n in notes if n['cents'] > 10)} notes over 10 cents"
    )
    print(f"DROPOUTS        {dropout_pct:.2f}% of held tone ({dropouts} of {graded} x {fine_ms:.0f}ms windows)")
    print(f"timing          mean slot {mean_interval:.1f}ms vs {SLOT_MS:.1f}ms, jitter {jitter:.1f}ms, worst {worst:.1f}ms")
    print(f"pitch           {measured:.1f} Hz vs {expected:.0f} Hz = {cents:+.1f} cents")

    # Name every defective note, with the time it happened. A summary answers "is it broken"; a
    # listener who can hear three distinct faults needs to know WHICH notes, so the recording can be
    # listened to at that point and the count compared honestly between builds.
    faults = []
    for n in notes:
        why = []
        if abs(n["ms"] - ON_MS) > 10:
            why.append(f"length {n['ms']:.0f}ms")
        if n["cents"] > 10:
            why.append(f"pitch {n['cents']:.0f} cents")
        if n["dropWindows"]:
            why.append(f"{n['dropWindows']} dropout windows")
        if why:
            faults.append(f"    t={n['start'] / rate:6.2f}s tone {TONES_HZ[n['tone']]:4d}Hz  " + ", ".join(why))
    if faults:
        print(f"defective notes  {len(faults)} of {len(notes)}:")
        for line in faults[:25]:
            print(line)
    else:
        print(f"defective notes  none of {len(notes)}")

    ok = (
        sequence_errors == 0
        and dropout_pct < 1.0
        and jitter < 15.0
        and abs(cents) < 25
        and len(long_notes) == 0
        and pitch_worst["cents"] < 10
    )
    print("VERDICT         " + ("clean" if ok else "BREAKING UP"))
    return 0 if ok else 1


def capture_wire(path: str, seconds: float, iface: str) -> int:
    """Write the mirror's audio stream straight to a WAV, as it leaves the Ultimate.

    This is the reference. Grading it with the same analyser proves the stimulus itself is sound
    before anything is concluded about the phone — and if the wire is clean and the room is not, the
    fault is downstream of the network, which is exactly the distinction that matters.
    """
    import socket
    import struct

    group, port = "239.0.1.65", 11001
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 << 20)
    sock.bind(("", port))
    sock.setsockopt(
        socket.IPPROTO_IP,
        socket.IP_ADD_MEMBERSHIP,
        struct.pack("4s4s", socket.inet_aton(group), socket.inet_aton(iface)),
    )
    sock.settimeout(2.0)
    pcm = bytearray()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            data, _ = sock.recvfrom(4096)
        except socket.timeout:
            break
        pcm += data[2:]  # strip the u16 sequence prefix
    if len(pcm) < 48000:
        print(f"only {len(pcm)} bytes on the wire — is the mirror streaming?")
        return 2
    # Left channel only, at the C64's own rate; the analyser cares about frequencies, not the rate
    # label, and 47983 is close enough to 48000 that the barcode reads identically.
    mono = bytearray()
    for i in range(0, len(pcm) - 3, 4):
        mono += pcm[i : i + 2]
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(47983)
        fh.writeframes(bytes(mono))
    print(f"{path}  {len(mono) / 2 / 47983:.1f}s from the wire")
    return 0


def record(path: str, seconds: float, device: str) -> int:
    cmd = ["arecord", "-D", device, "-f", "S16_LE", "-r", "48000", "-c", "1", "-d", str(int(seconds)), path]
    return subprocess.run(cmd, check=False, capture_output=True).returncode


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("build", "build-sid", "play", "record", "wire", "analyse", "run"):
        p = sub.add_parser(name)
        p.add_argument("--host", default="c64u")
        p.add_argument("--password", default="pwd")
        p.add_argument("--seconds", type=float, default=30.0)
        p.add_argument("--device", default="plughw:CARD=SF558,DEV=0")
        p.add_argument("--out", default="/tmp/audio-e2e.wav")
        p.add_argument("--iface", default=None, help="local IPv4 to join the group on (default: detected)")
        if name == "run":
            p.add_argument(
                "--wire-out",
                default=None,
                help="also capture the multicast audio to this WAV while the microphone records",
            )
        if name == "analyse":
            p.add_argument("file")
    args = ap.parse_args()

    if args.cmd == "build":
        prg = build_prg()
        out = args.out if args.out.endswith(".prg") else "/tmp/audio-e2e-probe.prg"
        with open(out, "wb") as fh:
            fh.write(prg)
        print(f"{out}  {len(prg)} bytes, {len(TONES_HZ)} tones, slot {SLOT_MS:.2f}ms")
        return 0
    if args.cmd == "build-sid":
        sid = build_sid()
        out = args.out if args.out.endswith(".sid") else "/tmp/audio-e2e-probe.sid"
        with open(out, "wb") as fh:
            fh.write(sid)
        print(f"{out}  {len(sid)} bytes")
        return 0
    if args.cmd == "play":
        play(args.host, args.password, build_prg())
        return 0
    if args.cmd == "record":
        rc = record(args.out, args.seconds, args.device)
        print(args.out)
        return rc
    if args.cmd == "wire":
        rc = capture_wire(args.out, args.seconds, resolve_iface(args.iface))
        return rc if rc else analyse(args.out)
    if args.cmd == "analyse":
        return analyse(args.file)

    play(args.host, args.password, build_prg())
    time.sleep(3)  # let the program start and the mirror settle
    wire_thread = None
    if args.wire_out:
        # The wire and the room over the same span, so a tone out of order in the room can be checked
        # against what the Ultimate actually sent at that moment. Only captured; the verdict is the mic's.
        wire_thread = threading.Thread(
            target=capture_wire, args=(args.wire_out, args.seconds, resolve_iface(args.iface)), daemon=True
        )
        wire_thread.start()
    recorded = record(args.out, args.seconds, args.device)
    if wire_thread is not None:
        wire_thread.join(timeout=10)
    if recorded != 0:
        print("recording failed")
        return 2
    return analyse(args.out)


if __name__ == "__main__":
    sys.exit(main())
