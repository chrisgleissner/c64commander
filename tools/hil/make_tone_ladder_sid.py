#!/usr/bin/env python3
"""Generate a PSID that plays a known tone ladder AND steps the screen colour with it.

Audio and video move in perfect unison: every note advance writes the next background colour in the
same instruction sequence as the note, so a capture of the two together measures playback accuracy
*and* A/V sync from the same 16 events per loop — rather than from a single flash.

WHY AN ARTIFICIAL TUNE

Real HVSC music is a poor measuring instrument. Its spectrum moves constantly, so "the stream sounds
rough" can only be answered statistically — a correlation score that says *something* differs, but
not what. A ladder of known pitches, each held for a fixed time with a deliberate gap between them,
turns the same question into arithmetic:

  - every note has ONE expected fundamental, so a detected pitch is either right or wrong, and by
    how many cents;
  - every note starts at a known time, so a late or missing note is visible;
  - the gaps make note onsets unambiguous, so a dropout inside a note cannot be confused with the
    boundary between two notes.

Play it locally and over the C64 stream and the difference stops being a judgement call.

THE LADDER — 18 slots of 0.5 s, 9.0 s per loop

    [silence] C3 D3 E3 F3 G3 A3 B3 C4 [silence] C4 B3 A3 G3 F3 E3 D3 C3
              └──────── 8 up ───────┘           └──────── 8 down ─────┘

A full octave up and a full octave back, the way a singer actually rehearses a scale — C3 to C4 and
return, both runs complete, so the turn-around note sounds at each end. Diatonic rather than
chromatic: whole-tone steps survive a phone speaker and a room, so a mis-detected note is a real
fault rather than a marginal reading. Triangle wave, whose strong fundamental and odd-only harmonics
pitch-detect cleanly.

THE SILENCES

Two per loop — one before the rise, one at the turn. They serve three purposes at once:

  - they are the only unambiguous landmark in a looping tune, so a capture that joins mid-ladder
    ALIGNS to them rather than brute-force searching a rotation offset;
  - they separate the two C4 notes at the turn, so a repeated pitch still has a clean boundary;
  - they are a measurement in their own right: the noise floor during a slot that is supposed to be
    digitally silent. That is the cheapest possible detector for the fault that started all this —
    a second machine streaming into the same multicast group produced zero packet loss and zero
    underruns, but it could never have produced silence on cue.

THE COLOUR

The 16 note slots step through all 16 C64 palette entries in register order, exactly one sweep per
loop: black white red cyan purple green blue yellow on the way up, orange brown light-red dark-grey
grey light-green light-blue light-grey on the way down. So every pitch carries a different colour
ascending than descending, every note boundary is a colour change, and one loop exercises the entire
palette — which makes colour accuracy measurable too, not just colour timing.

The BORDER is written black once at init and never again, so the measured region is unambiguous and
a border artefact cannot be mistaken for a colour change. During the silences the background is left
UNTOUCHED: silence is defined by the absence of sound, and holding the colour keeps every colour
transition coincident with a note onset.

    python3 tools/hil/make_tone_ladder_sid.py -o tests/fixtures/tone-ladder.sid
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

# PAL: the SID's frequency register is f_hz * 16777216 / clock.
PAL_CLOCK_HZ = 985248.0
FREQ_SCALE = 16777216.0 / PAL_CLOCK_HZ

# The C-major scale over one octave, C3 to C4.
SCALE_NAMES = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"]
SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12]
# Equal temperament from A3 = 220 Hz. C3 is 9 semitones below A3.
NOTE_HZ = [220.0 * (2 ** ((semitone - 9) / 12.0)) for semitone in SCALE_SEMITONES]

# The C64 palette in register order — one full sweep per loop, one entry per note.
C64_COLOUR_NAMES = [
    "black", "white", "red", "cyan", "purple", "green", "blue", "yellow",
    "orange", "brown", "light red", "dark grey", "grey", "light green", "light blue", "light grey",
]

FRAMES_PER_NOTE = 25  # 25 PAL frames = 0.5 s per slot, 9.0 s for one loop
SILENT_FRAMES = 4  # 80 ms gated off at the end of each note, to mark the boundary
# Master volume across those frames, indexed by the frame counter as it runs down to 1. Slot 0 is
# never read; it exists so the table can be indexed directly by the counter.
VOLUME_RAMP = [0] + [round(15 * (frame - 1) / SILENT_FRAMES) for frame in range(1, SILENT_FRAMES + 1)]
SILENT_SLOT = -1  # marker for a slot that sounds nothing and leaves the colour alone
COLOUR_NONE = 0xFF  # table sentinel for the same
LOAD_ADDR = 0x1000


def ladder() -> list[int]:
    """The 18 slots: silence, a full octave up, silence, a full octave down.

    Slot values index SCALE_NAMES; SILENT_SLOT marks a silent slot.
    """
    top = len(SCALE_NAMES) - 1
    up = list(range(len(SCALE_NAMES)))  # C3 .. C4
    down = list(range(top, -1, -1))  # C4 .. C3
    return [SILENT_SLOT] + up + [SILENT_SLOT] + down


def colour_for_slots(slots: list[int]) -> list[int]:
    """One palette entry per sounding slot, in register order; silences hold the colour."""
    colours: list[int] = []
    next_colour = 0
    for slot in slots:
        if slot == SILENT_SLOT:
            colours.append(COLOUR_NONE)
        else:
            colours.append(next_colour % len(C64_COLOUR_NAMES))
            next_colour += 1
    return colours


class Asm:
    """Tiny 6502 emitter with labels, so offsets are never hand-counted."""

    def __init__(self, origin: int) -> None:
        self.origin = origin
        self.code = bytearray()
        self.labels: dict[str, int] = {}
        self.fixups: list[tuple[int, str, str]] = []

    @property
    def pc(self) -> int:
        return self.origin + len(self.code)

    def label(self, name: str) -> None:
        self.labels[name] = self.pc

    def emit(self, *values: int) -> None:
        self.code.extend(values)

    def abs_ref(self, opcode: int, name: str) -> None:
        self.emit(opcode)
        self.fixups.append((len(self.code), name, "abs"))
        self.emit(0, 0)

    def rel_ref(self, opcode: int, name: str) -> None:
        self.emit(opcode)
        self.fixups.append((len(self.code), name, "rel"))
        self.emit(0)

    def link(self) -> bytes:
        for offset, name, kind in self.fixups:
            target = self.labels[name]
            if kind == "abs":
                self.code[offset] = target & 0xFF
                self.code[offset + 1] = (target >> 8) & 0xFF
            else:
                delta = target - (self.origin + offset + 1)
                if not -128 <= delta <= 127:
                    raise ValueError(f"branch to {name} out of range ({delta})")
                self.code[offset] = delta & 0xFF
        return bytes(self.code)


def build_player(slots: list[int], colours: list[int]) -> tuple[bytes, int, int]:
    a = Asm(LOAD_ADDR)
    # $FB-$FE are the classic free zero-page bytes. $02/$03 are NOT free — the
    # KERNAL/BASIC use them, and a clobbered frame counter made the note timer
    # skip its silent frames, so the ladder ran as one continuous tone with no
    # note boundaries to measure.
    SLOT_IDX, FRAME_CNT = 0xFB, 0xFC

    # ── init ────────────────────────────────────────────────────
    a.label("init")
    a.emit(0xA9, 0x00, 0x85, SLOT_IDX)  # lda #0    ; sta slotIdx
    a.emit(0xA9, 0x01, 0x85, FRAME_CNT)  # lda #1   ; sta frameCnt -> advance on first play
    a.emit(0xA9, 0x0F, 0x8D, 0x18, 0xD4)  # lda #$0f ; sta $d418   (volume 15)
    a.emit(0xA9, 0x00, 0x8D, 0x20, 0xD0)  # lda #0   ; sta $d020   (border black, written once)
    a.emit(0xA9, 0x00, 0x8D, 0x21, 0xD0)  # lda #0   ; sta $d021   (background black to start)
    a.emit(0xA9, 0x00, 0x8D, 0x05, 0xD4)  # lda #0   ; sta $d405   (attack 2ms, decay 6ms)
    a.emit(0xA9, 0xF0, 0x8D, 0x06, 0xD4)  # lda #$f0 ; sta $d406   (sustain 15, release 0)
    a.emit(0xA9, 0x00, 0x8D, 0x04, 0xD4)  # lda #0   ; sta $d404   (gate off)
    a.emit(0x60)  # rts

    # ── play (called once per frame) ────────────────────────────
    a.label("play")
    a.emit(0xC6, FRAME_CNT)  # dec frameCnt
    a.rel_ref(0xF0, "advance")  # beq advance
    a.emit(0xA5, FRAME_CNT, 0xC9, SILENT_FRAMES + 1)  # lda frameCnt ; cmp #silent+1
    a.rel_ref(0xB0, "done")  # bcs done  (still sounding)
    # The last SILENT_FRAMES frames are silenced, so every note ends with an
    # unmistakable gap. Two earlier attempts were not enough: one frame (20 ms)
    # did not survive an RMS envelope, and gate-off alone only ducks the note by
    # ~8 dB because the SID's release still rings.
    #
    # Master volume is RAMPED to 0 across those frames rather than slammed there.
    # Slamming it left a large DC step, and a step is infrasonic energy: rendered
    # through the SID's DC blocker it rang for ~0.6 s at around 1 Hz, loud enough
    # (-13 dBFS unweighted) that a plain RMS envelope read the ring as a note and
    # the click as its onset. A ramp keeps the gaps clean for a measuring
    # instrument and stops the tune clicking on real speakers.
    a.label("silence")
    a.emit(0xAA)  # tax  (A = frameCnt, 1..SILENT_FRAMES)
    a.abs_ref(0xBD, "volramp")  # lda volramp,x
    a.emit(0x8D, 0x18, 0xD4)  # sta $d418
    a.emit(0xA9, 0x10, 0x8D, 0x04, 0xD4)  # lda #$10 ; sta $d404 (triangle, gate off)
    a.emit(0x60)  # rts

    a.label("advance")
    a.emit(0xA6, SLOT_IDX)  # ldx slotIdx
    a.emit(0xE0, len(slots))  # cpx #count
    a.rel_ref(0x90, "setslot")  # bcc setslot
    a.emit(0xA2, 0x00)  # ldx #0   (loop the ladder)
    a.label("setslot")
    # A silent slot sounds nothing and — deliberately — leaves $d021 alone, so every
    # colour transition in the tune coincides with a note onset and never with a gap.
    a.abs_ref(0xBD, "colours")  # lda colours,x
    a.emit(0xC9, COLOUR_NONE)  # cmp #$ff
    a.rel_ref(0xF0, "quiet")  # beq quiet
    # The colour is written in the SAME instruction sequence as the note, so the two are
    # simultaneous on the machine and any measured offset belongs to the transport, not the tune.
    a.emit(0x8D, 0x21, 0xD0)  # sta $d021 (background)
    a.abs_ref(0xBD, "freqlo")  # lda freqlo,x
    a.emit(0x8D, 0x00, 0xD4)  # sta $d400
    a.abs_ref(0xBD, "freqhi")  # lda freqhi,x
    a.emit(0x8D, 0x01, 0xD4)  # sta $d401
    a.emit(0xA9, 0x0F, 0x8D, 0x18, 0xD4)  # lda #$0f ; sta $d418 (master volume back to 15)
    a.emit(0xA9, 0x11, 0x8D, 0x04, 0xD4)  # lda #$11 ; sta $d404 (triangle + gate on)
    a.rel_ref(0xD0, "slotdone")  # bne slotdone  (A = $11, always taken)
    a.label("quiet")
    a.emit(0xA9, 0x10, 0x8D, 0x04, 0xD4)  # lda #$10 ; sta $d404 (gate off)
    a.emit(0xA9, 0x00, 0x8D, 0x18, 0xD4)  # lda #0   ; sta $d418 (master volume 0)
    a.label("slotdone")
    a.emit(0xE8, 0x86, SLOT_IDX)  # inx ; stx slotIdx
    a.emit(0xA9, FRAMES_PER_NOTE, 0x85, FRAME_CNT)  # lda #frames ; sta frameCnt
    a.label("done")
    a.emit(0x60)  # rts

    # A silent slot still needs a table entry; 0 is never read because the colour
    # sentinel branches away before the frequency load.
    a.label("freqlo")
    for slot in slots:
        value = 0 if slot == SILENT_SLOT else int(round(NOTE_HZ[slot] * FREQ_SCALE))
        a.emit(value & 0xFF)
    a.label("freqhi")
    for slot in slots:
        value = 0 if slot == SILENT_SLOT else int(round(NOTE_HZ[slot] * FREQ_SCALE))
        a.emit((value >> 8) & 0xFF)

    a.label("colours")
    for colour in colours:
        a.emit(colour & 0xFF)

    a.label("volramp")
    for level in VOLUME_RAMP:
        a.emit(level & 0x0F)

    code = a.link()
    return code, a.labels["init"], a.labels["play"]


def build_psid(code: bytes, init: int, play: int) -> bytes:
    data = struct.pack("<H", LOAD_ADDR) + code  # C64 load address, little-endian
    header = b"PSID"
    header += struct.pack(">H", 2)  # version 2
    header += struct.pack(">H", 0x7C)  # data offset
    header += struct.pack(">H", 0)  # loadAddress (0 = taken from the data)
    header += struct.pack(">H", init)
    header += struct.pack(">H", play)
    header += struct.pack(">H", 1)  # songs
    header += struct.pack(">H", 1)  # startSong
    header += struct.pack(">I", 0)  # speed: 0 = 50 Hz vertical blank
    header += b"C64 Commander tone & colour ladder".ljust(32, b"\0")[:32]
    header += b"C64 Commander HIL".ljust(32, b"\0")[:32]
    header += b"2026".ljust(32, b"\0")[:32]
    header += struct.pack(">H", 0)  # flags
    header += bytes([0, 0, 0, 0])  # startPage, pageLength, secondSIDAddress, thirdSIDAddress
    assert len(header) == 0x7C, len(header)
    return header + data


def describe(slots: list[int], colours: list[int]) -> list[str]:
    rows = []
    for index, (slot, colour) in enumerate(zip(slots, colours)):
        name = "—" if slot == SILENT_SLOT else SCALE_NAMES[slot]
        hz = "silence" if slot == SILENT_SLOT else f"{NOTE_HZ[slot]:.1f} Hz"
        paint = "(hold)" if colour == COLOUR_NONE else C64_COLOUR_NAMES[colour]
        rows.append(f"  {index:>2}  {name:>4}  {hz:>9}  {paint}")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--out", default="tests/fixtures/tone-ladder.sid")
    args = parser.parse_args()

    slots = ladder()
    colours = colour_for_slots(slots)
    code, init, play = build_player(slots, colours)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(build_psid(code, init, play))

    seconds_per_slot = FRAMES_PER_NOTE / 50.0
    sounding = sum(1 for slot in slots if slot != SILENT_SLOT)
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    print(f"init=${init:04X} play=${play:04X}")
    print(
        f"slots={len(slots)} ({sounding} notes, {len(slots) - sounding} silences) "
        f"{seconds_per_slot:.2f}s each, {len(slots) * seconds_per_slot:.1f}s per loop"
    )
    print("\n slot  note         Hz  background")
    print("\n".join(describe(slots, colours)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
