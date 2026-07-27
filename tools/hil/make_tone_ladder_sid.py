#!/usr/bin/env python3
"""Generate a PSID that plays a known tone ladder: C3 → B3 → C3.

WHY AN ARTIFICIAL TUNE

Real HVSC music is a poor measuring instrument. Its spectrum moves constantly,
so "the stream sounds rough" can only be answered statistically — a correlation
score that says *something* differs but not *what*. A ladder of known pitches,
each held for a fixed time with a deliberate gap between them, turns the same
question into arithmetic:

  - every note has ONE expected fundamental, so a detected pitch is either right
    or wrong, and by how many cents;
  - every note starts at a known time, so a late or missing note is visible;
  - the gaps make note onsets unambiguous, so dropouts inside a note cannot be
    confused with the boundary between two notes.

Play it locally and over the C64 stream and the difference stops being a
judgement call.

THE LADDER

Chromatic C3 up to B3 (12 notes), then back down to C3 — 23 notes. Triangle
wave: a strong fundamental with only odd harmonics, which is the easiest thing
to pitch-detect through a phone speaker and a room.

    python3 tools/hil/make_tone_ladder_sid.py -o tests/fixtures/tone-ladder.sid
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

# PAL: the SID's frequency register is f_hz * 16777216 / clock.
PAL_CLOCK_HZ = 985248.0
FREQ_SCALE = 16777216.0 / PAL_CLOCK_HZ

NOTE_NAMES = ["C3", "C#3", "D3", "D#3", "E3", "F3", "F#3", "G3", "G#3", "A3", "A#3", "B3"]
# Equal temperament from A3 = 220 Hz. C3 is 9 semitones below A3.
NOTE_HZ = [220.0 * (2 ** ((i - 9) / 12.0)) for i in range(12)]

FRAMES_PER_NOTE = 25  # 25 PAL frames = 0.5 s per note, 11.5 s for the ladder
SILENT_FRAMES = 4  # 80 ms gated off at the end of each note, to mark the boundary
LOAD_ADDR = 0x1000


def ladder() -> list[int]:
    """C3..B3 then B3-1 back down to C3 — 23 notes, no repeated turn-around note."""
    return list(range(12)) + list(range(10, -1, -1))


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


def build_player(notes: list[int]) -> tuple[bytes, int, int]:
    a = Asm(LOAD_ADDR)
    # $FB-$FE are the classic free zero-page bytes. $02/$03 are NOT free — the
    # KERNAL/BASIC use them, and a clobbered frame counter made the note timer
    # skip its silent frames, so the ladder ran as one continuous 14 s tone with
    # no note boundaries to measure.
    NOTE_IDX, FRAME_CNT = 0xFB, 0xFC

    # ── init ────────────────────────────────────────────────────
    a.label("init")
    a.emit(0xA9, 0x00, 0x85, NOTE_IDX)  # lda #0    ; sta noteIdx
    a.emit(0xA9, 0x01, 0x85, FRAME_CNT)  # lda #1   ; sta frameCnt -> advance on first play
    a.emit(0xA9, 0x0F, 0x8D, 0x18, 0xD4)  # lda #$0f ; sta $d418   (volume 15)
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
    # ~8 dB because the SID's release still rings. Master volume 0 is a hard
    # silence, which is what makes note onsets exact.
    a.emit(0xA9, 0x10, 0x8D, 0x04, 0xD4)  # lda #$10 ; sta $d404 (triangle, gate off)
    a.emit(0xA9, 0x00, 0x8D, 0x18, 0xD4)  # lda #0   ; sta $d418 (master volume 0)
    a.emit(0x60)  # rts

    a.label("advance")
    a.emit(0xA6, NOTE_IDX)  # ldx noteIdx
    a.emit(0xE0, len(notes))  # cpx #count
    a.rel_ref(0x90, "setnote")  # bcc setnote
    a.emit(0xA2, 0x00)  # ldx #0   (loop the ladder)
    a.label("setnote")
    a.abs_ref(0xBD, "freqlo")  # lda freqlo,x
    a.emit(0x8D, 0x00, 0xD4)  # sta $d400
    a.abs_ref(0xBD, "freqhi")  # lda freqhi,x
    a.emit(0x8D, 0x01, 0xD4)  # sta $d401
    a.emit(0xA9, 0x0F, 0x8D, 0x18, 0xD4)  # lda #$0f ; sta $d418 (master volume back to 15)
    a.emit(0xA9, 0x11, 0x8D, 0x04, 0xD4)  # lda #$11 ; sta $d404 (triangle + gate on)
    a.emit(0xE8, 0x86, NOTE_IDX)  # inx ; stx noteIdx
    a.emit(0xA9, FRAMES_PER_NOTE, 0x85, FRAME_CNT)  # lda #frames ; sta frameCnt
    a.label("done")
    a.emit(0x60)  # rts

    a.label("freqlo")
    for n in notes:
        a.emit(int(round(NOTE_HZ[n] * FREQ_SCALE)) & 0xFF)
    a.label("freqhi")
    for n in notes:
        a.emit((int(round(NOTE_HZ[n] * FREQ_SCALE)) >> 8) & 0xFF)

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
    header += b"C64 Commander tone ladder C3-B3-C3".ljust(32, b"\0")[:32]
    header += b"C64 Commander HIL".ljust(32, b"\0")[:32]
    header += b"2026".ljust(32, b"\0")[:32]
    header += struct.pack(">H", 0)  # flags
    header += bytes([0, 0, 0, 0])  # startPage, pageLength, secondSIDAddress, thirdSIDAddress
    assert len(header) == 0x7C, len(header)
    return header + data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--out", default="tests/fixtures/tone-ladder.sid")
    args = parser.parse_args()

    notes = ladder()
    code, init, play = build_player(notes)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(build_psid(code, init, play))

    seconds_per_note = FRAMES_PER_NOTE / 50.0
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    print(f"init=${init:04X} play=${play:04X} notes={len(notes)} {seconds_per_note:.2f}s each")
    print("ladder: " + " ".join(NOTE_NAMES[n] for n in notes))
    print("expected fundamentals (Hz): " + " ".join(f"{NOTE_HZ[n]:.1f}" for n in notes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
