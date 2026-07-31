#!/usr/bin/env python3
"""
Build a synthetic SID tune for detecting audio dropouts acoustically.

## Why real music cannot answer the question

A dropout heard through a microphone is a collapse in level. SID music collapses in level
constantly and on purpose — ADSR gates, note-offs, rests — so a recording of real music cannot
separate "the audio stopped" from "the tune got quiet". Measured on 98 s of a real tune, a detector
tuned for fast collapse with fast recovery found five candidates, and not one of them can be
attributed with any confidence, because a hard note-off into a rest has the same acoustic signature
as an underrun.

## What this tune does differently

**Amplitude is constant.** Three voices are gated on once at init and never gated off. Attack is the
fastest available, decay is zero, sustain is maximum, and master volume never changes. From the
first frame to the last there is no envelope event of any kind, so the output level is flat and
*any* dip in the recording is the playback path failing rather than the music.

**The register write load is high**, which is the point — a probe that idles would not exercise what
real playback exercises. The play routine runs five times per frame, and each pass rewrites the
frequency of all three voices: 5 x 3 x 2 = 30 register writes per frame, 1,500 per second, against
roughly 50-150/sec for a typical tune. The five passes are spread across the frame by a calibrated
delay rather than bunched at its start, so the SID genuinely sees five distinct frequency values per
frame instead of holding the last one for 19 ms.

**It is meant to be listenable.** Three triangle waves — the softest waveform the SID has, no
harsh sawtooth or pulse — tuned to a major triad, with a gentle vibrato of a fraction of a semitone
at a few Hz, at different rates per voice so the three drift against each other and shimmer instead
of sitting still. The brief was explicit that a mid-range hum is not acceptable, so: the fundamentals
sit in the upper-middle register rather than droning low, the vibrato keeps the timbre moving, and
nothing about it is static except the loudness.

Tuning knobs are at the top. If it is still unpleasant the fix is almost certainly `CHORD_HZ`
(try a wider voicing or a higher register) or `VIBRATO_CENTS` (more movement), not the waveform.

## Detection

Any interval where in-band (300-6000 Hz) energy collapses is a dropout, full stop. There is no
musical event that could explain one. Analyse with `dropouts.py`, which band-limits — a broadband
RMS is dominated by sub-300 Hz room rumble and understates the usable range by over 30 dB.

Usage:  make-dropout-probe-sid.py [out.sid]
"""

import math
import struct
import sys

# --- tuning ------------------------------------------------------------------------------------

# A major triad, an octave above the middle of the piano.
#
# The register is chosen for the phone speaker, not for the SID. A triangle wave's harmonics fall
# off as 1/n^2, so an A4 triad puts 99% of its energy below 1 kHz -- and a phone speaker rolls off
# steeply below about 500 Hz, so most of that never reaches the microphone. Rendered and measured:
# at A4 only 0.9% of the energy sat above 1 kHz. An octave up puts all three fundamentals inside the
# band a phone speaker actually radiates, which is also where the detector looks.
#
# It is further from a hum for the same reason it is easier to hear.
CHORD_HZ = (880.00, 1108.73, 1318.51)        # A5, C#6, E6

VIBRATO_CENTS = 6.0                          # +/- depth. 6 cents is a shimmer, not a wobble.
VIBRATO_CYCLES = (1, 1, 2)                   # per table pass, per voice - different rates drift
VIBRATO_PHASE = (0.0, 0.25, 0.5)             # fraction of a cycle offset, so they never align

STEPS = 64                                   # table entries; 5/frame at 50 Hz = 3.9 Hz vibrato
UPDATES_PER_FRAME = 5
PAL_CLOCK = 985248.0
FRAME_CYCLES = 19656                         # PAL

LOAD = 0x1000
INIT = 0x1000
PLAY = 0x1040
TABLES = (0x1100, 0x1180, 0x1200)            # one 128-byte table per voice
PHASE = 0x02                                 # zero page: table index, 0..126 step 2
SUBCOUNT = 0x03                              # zero page: remaining passes this frame


def sid_freq(hz: float) -> int:
    """SID frequency register value for a pitch, PAL."""
    return max(0, min(0xFFFF, round(hz * 16_777_216 / PAL_CLOCK)))


def voice_table(base_hz: float, cycles: int, phase: float) -> bytes:
    out = bytearray()
    for step in range(STEPS):
        angle = 2 * math.pi * (cycles * step / STEPS + phase)
        cents = VIBRATO_CENTS * math.sin(angle)
        value = sid_freq(base_hz * (2 ** (cents / 1200.0)))
        out += bytes((value & 0xFF, (value >> 8) & 0xFF))
    return bytes(out)


def assemble() -> bytearray:
    """Hand-assembled 6502. Kept explicit so every write is visible and countable."""
    code = bytearray(0x200)  # $1000..$11FF window, tables appended after

    def emit(at: int, *values: int) -> int:
        for offset, value in enumerate(values):
            code[at - LOAD + offset] = value
        return at + len(values)

    # ---- init ($1000). Called once. Sets a state that never changes again. -------------------
    at = INIT
    at = emit(at, 0xA9, 0x0F)              # lda #$0f
    at = emit(at, 0x8D, 0x18, 0xD4)        # sta $d418      master volume, maximum, never touched
    # Per voice: AD = $00 (fastest attack, no decay), SR = $F0 (sustain max, release irrelevant).
    # With gate held on, the envelope reaches maximum immediately and stays there forever.
    for reg in (0x05, 0x0C, 0x13):
        at = emit(at, 0xA9, 0x00)
        at = emit(at, 0x8D, reg, 0xD4)
    for reg in (0x06, 0x0D, 0x14):
        at = emit(at, 0xA9, 0xF0)
        at = emit(at, 0x8D, reg, 0xD4)
    # Control: triangle + gate on. Never written again, so no envelope event can occur.
    for reg in (0x04, 0x0B, 0x12):
        at = emit(at, 0xA9, 0x11)
        at = emit(at, 0x8D, reg, 0xD4)
    at = emit(at, 0xA9, 0x00)
    at = emit(at, 0x85, PHASE)             # sta $02
    at = emit(at, 0x60)                    # rts
    assert at <= PLAY, f"init overran play at {at:04x}"

    # ---- play ($1030). Called once per frame; does UPDATES_PER_FRAME passes. -----------------
    at = PLAY
    at = emit(at, 0xA9, UPDATES_PER_FRAME)
    at = emit(at, 0x85, SUBCOUNT)          # sta $03
    loop = at
    at = emit(at, 0xA6, PHASE)             # ldx $02
    for table, lo_reg in zip(TABLES, (0x00, 0x07, 0x0E)):
        at = emit(at, 0xBD, table & 0xFF, table >> 8)          # lda table,x
        at = emit(at, 0x8D, lo_reg, 0xD4)                      # sta $d4xx
        at = emit(at, 0xBD, (table + 1) & 0xFF, (table + 1) >> 8)
        at = emit(at, 0x8D, lo_reg + 1, 0xD4)
    # phase += 2, wrap at 128
    at = emit(at, 0xA5, PHASE)             # lda $02
    at = emit(at, 0x18)                    # clc
    at = emit(at, 0x69, 0x02)              # adc #2
    at = emit(at, 0xC9, STEPS * 2)         # cmp #128
    at = emit(at, 0x90, 0x02)              # bcc +2
    at = emit(at, 0xA9, 0x00)              # lda #0
    at = emit(at, 0x85, PHASE)             # sta $02
    # Spread the passes across the frame. Without this the five writes land in the first few
    # hundred cycles and the SID holds the last value for the remaining 19 ms, which is one
    # update per frame wearing a disguise.
    outer, inner = 3, 200                  # ~3 * 200 * 5 = 3000 cycles
    at = emit(at, 0xA2, outer)             # ldx #3
    o = at
    at = emit(at, 0xA0, inner)             # ldy #200
    i = at
    at = emit(at, 0x88)                    # dey
    at = emit(at, 0xD0, (i - (at + 2)) & 0xFF)   # bne inner
    at = emit(at, 0xCA)                    # dex
    at = emit(at, 0xD0, (o - (at + 2)) & 0xFF)   # bne outer
    at = emit(at, 0xC6, SUBCOUNT)          # dec $03
    at = emit(at, 0xD0, (loop - (at + 2)) & 0xFF)  # bne loop
    at = emit(at, 0x60)                    # rts
    play_end = at

    budget = UPDATES_PER_FRAME * (outer * inner * 5 + 60)
    assert budget < FRAME_CYCLES, f"play would overrun a frame: {budget} of {FRAME_CYCLES}"
    return code, play_end, budget


def build() -> bytes:
    code, play_end, budget = assemble()
    image = bytearray(code)
    for index, (table, hz) in enumerate(zip(TABLES, CHORD_HZ)):
        data = voice_table(hz, VIBRATO_CYCLES[index], VIBRATO_PHASE[index])
        offset = table - LOAD
        if offset + len(data) > len(image):
            image.extend(bytes(offset + len(data) - len(image)))
        image[offset:offset + len(data)] = data

    header = bytearray()
    header += b"PSID"
    header += struct.pack(">H", 2)             # version
    header += struct.pack(">H", 0x7C)          # data offset
    header += struct.pack(">H", 0)             # load address: taken from the first two data bytes
    header += struct.pack(">H", INIT)
    header += struct.pack(">H", PLAY)
    header += struct.pack(">H", 1)             # songs
    header += struct.pack(">H", 1)             # start song
    header += struct.pack(">I", 0)             # speed: vertical blank
    header += b"SIDFlow Dropout Probe".ljust(32, b"\0")[:32]
    header += b"SIDFlow".ljust(32, b"\0")[:32]
    header += b"2026 SIDFlow".ljust(32, b"\0")[:32]
    header += struct.pack(">H", 0)             # flags
    # startPage, pageLength, secondSIDAddress, thirdSIDAddress are one byte each in PSID v2NG.
    # Packing the SID addresses as words is the obvious slip and yields a 126-byte header that
    # every reader then mis-parses from `flags` onward.
    header += bytes((0, 0, 0, 0))
    assert len(header) == 0x7C, len(header)

    return bytes(header) + struct.pack("<H", LOAD) + bytes(image), play_end, budget


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "dropout-probe.sid"
    blob, play_end, budget = build()
    with open(path, "wb") as handle:
        handle.write(blob)
    writes = UPDATES_PER_FRAME * 3 * 2
    print(f"wrote {path} ({len(blob)} bytes)")
    print(f"chord {CHORD_HZ[0]:.1f}/{CHORD_HZ[1]:.1f}/{CHORD_HZ[2]:.1f} Hz, triangle, gate held on")
    print(f"vibrato +/-{VIBRATO_CENTS:.0f} cents at "
          f"{', '.join(f'{c * UPDATES_PER_FRAME * 50 / STEPS:.1f}' for c in VIBRATO_CYCLES)} Hz per voice")
    print(f"{writes} SID register writes per frame = {writes * 50} per second")
    print(f"play routine costs about {budget} of {FRAME_CYCLES} cycles per frame")
    print(f"code ends at ${play_end:04x}, tables at " + ", ".join(f"${t:04x}" for t in TABLES))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
