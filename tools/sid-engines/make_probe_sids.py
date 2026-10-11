#!/usr/bin/env python3
"""Generate the synthetic SID tunes the cross-engine equivalence check renders.

    python3 tools/sid-engines/make_probe_sids.py [-o tests/fixtures/sid-engines]

Real music compares engines statistically and cannot be committed here. These tunes are written
for the purpose, are small enough to keep in the repository, and each one isolates one area where
SID emulations are known to disagree, so a failing comparison names what broke:

    waveforms-6581 / -8580   every waveform and combined waveform, hard sync and ring modulation
    filter-6581 / -8580      low-, band-, high-pass and notch, cutoff swept at two resonances
    envelopes                attack, decay, sustain and release rates, and quick gate retriggers
    two-sid / three-sid      extra chips at $D420 and $D440 (PSID v3 and v4 headers)
    ntsc                     the waveform tune on an NTSC clock
    multispeed               a PSID whose init reprograms the CIA timer to 200 Hz
    digi-6581 / -8580        4-bit samples through the $D418 volume register at about 8 kHz
    rsid-irq                 an RSID that installs its own CIA interrupt handler with the ROMs banked out
    volume-steps-6581/-8580  master volume stepped at frame rate with no note ever gated: the DC
                             blocker, start-up handling and the 8580's EXT IN level

Most tunes are a register script: a list of frames, each a list of (address, value) writes, played
by one small routine per interrupt. The script loops when it ends.
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hil"))
from make_tone_ladder_sid import Asm as LadderAsm  # noqa: E402

LOAD_ADDR = 0x1000
PAL_CLOCK_HZ = 985248.0
NTSC_CLOCK_HZ = 1022727.0
PTR, TARGET, YSAVE, SAMPLE_INDEX = 0xFB, 0xFD, 0xF9, 0xFA

FLAG_PAL, FLAG_NTSC = 0x04, 0x08
FLAG_6581, FLAG_8580 = 0x10, 0x20
FLAG_SECOND_8580, FLAG_THIRD_8580 = 0x80, 0x200

Frame = list[tuple[int, int]]


class Asm(LadderAsm):
    """The tone ladder's emitter, plus `lda #<label` and `lda #>label`."""

    def lo_ref(self, name: str) -> None:
        self.emit(0xA9)
        self.fixups.append((len(self.code), name, "lo"))
        self.emit(0)

    def hi_ref(self, name: str) -> None:
        self.emit(0xA9)
        self.fixups.append((len(self.code), name, "hi"))
        self.emit(0)

    def link(self) -> bytes:
        local = ("lo", "hi", "abs+2")
        for offset, name, kind in [fixup for fixup in self.fixups if fixup[2] in local]:
            target = self.labels[name] + (2 if kind == "abs+2" else 0)
            if kind == "lo":
                self.code[offset] = target & 0xFF
            elif kind == "hi":
                self.code[offset] = target >> 8
            else:
                self.code[offset : offset + 2] = bytes([target & 0xFF, target >> 8])
        self.fixups = [fixup for fixup in self.fixups if fixup[2] not in local]
        return super().link()


@dataclass
class Tune:
    name: str
    title: str
    code: bytes
    init: int
    play: int
    flags: int
    rsid: bool = False
    cia_speed: bool = False
    second_sid: int = 0
    third_sid: int = 0


def sid_freq(hz: float, clock: float = PAL_CLOCK_HZ) -> int:
    return min(0xFFFF, int(round(hz * 16777216.0 / clock)))


def note_hz(semitones_from_a4: int) -> float:
    return 440.0 * 2 ** (semitones_from_a4 / 12.0)


def voice_writes(base: int, voice: int, *, freq: int | None = None, pulse: int | None = None,
                 control: int | None = None, ad: int | None = None, sr: int | None = None) -> Frame:
    reg = base + voice * 7
    writes: Frame = []
    if freq is not None:
        writes += [(reg, freq & 0xFF), (reg + 1, freq >> 8)]
    if pulse is not None:
        writes += [(reg + 2, pulse & 0xFF), (reg + 3, (pulse >> 8) & 0x0F)]
    if ad is not None:
        writes.append((reg + 5, ad))
    if sr is not None:
        writes.append((reg + 6, sr))
    if control is not None:
        writes.append((reg + 4, control))
    return writes


# A frame with nothing to change still needs one write, because an empty frame ends the script. It
# goes to free RAM: rewriting $D418 instead would be heard as a click on some emulations.
IDLE_WRITE = (0x02A7, 0x00)


def hold(frames: list[Frame], count: int) -> None:
    frames.extend([IDLE_WRITE] for _ in range(count))


def script_player(a: Asm, script_label: str) -> None:
    """The register-script player: one frame of writes per call, looping at the end."""
    a.label("play")
    a.emit(0xA0, 0x00)  # ldy #0
    a.emit(0xB1, PTR)  # lda (ptr),y   ; write count
    a.rel_ref(0xD0, "have")  # bne have
    init_pointer(a, script_label)  # the script has ended: start it again, and sound nothing this call
    a.emit(0x60)  # rts
    a.label("have")
    a.emit(0xAA)  # tax
    a.emit(0xC8)  # iny
    a.label("next")
    a.emit(0xB1, PTR, 0x85, TARGET, 0xC8)  # lda (ptr),y ; sta target ; iny
    a.emit(0xB1, PTR, 0x85, TARGET + 1, 0xC8)  # lda (ptr),y ; sta target+1 ; iny
    a.emit(0xB1, PTR, 0xC8, 0x84, YSAVE)  # lda (ptr),y ; iny ; sty ysave
    a.emit(0xA0, 0x00, 0x91, TARGET, 0xA4, YSAVE)  # ldy #0 ; sta (target),y ; ldy ysave
    a.emit(0xCA)  # dex
    a.rel_ref(0xD0, "next")  # bne next
    a.emit(0x98, 0x18, 0x65, PTR, 0x85, PTR)  # tya ; clc ; adc ptr ; sta ptr
    a.rel_ref(0x90, "advanced")  # bcc advanced
    a.emit(0xE6, PTR + 1)  # inc ptr+1
    a.label("advanced")
    a.emit(0x60)  # rts


def emit_script(a: Asm, label: str, frames: list[Frame]) -> None:
    a.label(label)
    for frame in frames:
        if not 0 < len(frame) <= 80:
            raise ValueError(f"a frame must hold 1..80 writes, not {len(frame)}")
        a.emit(len(frame))
        for address, value in frame:
            a.emit(address & 0xFF, address >> 8, value & 0xFF)
    a.emit(0x00)


def init_pointer(a: Asm, label: str) -> None:
    a.lo_ref(label)
    a.emit(0x85, PTR)
    a.hi_ref(label)
    a.emit(0x85, PTR + 1)


def set_cia_timer(a: Asm, cycles: int) -> None:
    a.emit(0xA9, cycles & 0xFF, 0x8D, 0x04, 0xDC)  # lda #<cycles ; sta $dc04
    a.emit(0xA9, cycles >> 8, 0x8D, 0x05, 0xDC)  # lda #>cycles ; sta $dc05


def script_tune(name: str, title: str, frames: list[Frame], flags: int, *, cia_cycles: int | None = None,
                second_sid: int = 0, third_sid: int = 0) -> Tune:
    a = Asm(LOAD_ADDR)
    a.label("init")
    init_pointer(a, "script")
    if cia_cycles is not None:
        set_cia_timer(a, cia_cycles)
    a.emit(0x60)
    script_player(a, "script")
    emit_script(a, "script", frames)
    return Tune(name, title, a.link(), a.labels["init"], a.labels["play"], flags,
                cia_speed=cia_cycles is not None, second_sid=second_sid, third_sid=third_sid)


# ── the scripts ─────────────────────────────────────────────────────────────────────────────────


def waveform_frames(clock: float = PAL_CLOCK_HZ, base: int = 0xD400) -> list[Frame]:
    frames: list[Frame] = [[(base + 0x18, 0x0F), (base + 0x17, 0x00)]]
    melody = [-21, -17, -14, -9]  # C4 E4 G4 C5 relative to A4
    for waveform in (0x10, 0x20, 0x40, 0x80, 0x30, 0x50, 0x60, 0x70):
        for semitone in melody:
            frames.append(voice_writes(base, 0, freq=sid_freq(note_hz(semitone), clock), pulse=0x0800,
                                       ad=0x08, sr=0xA6, control=waveform | 0x01))
            hold(frames, 20)
            frames.append(voice_writes(base, 0, control=waveform))
            hold(frames, 4)
    # Pulse width swept across its range.
    frames.append(voice_writes(base, 0, freq=sid_freq(note_hz(-21), clock), ad=0x00, sr=0xF0, control=0x41))
    for step in range(100):
        frames.append(voice_writes(base, 0, pulse=int(4095 * step / 99)))
    frames.append(voice_writes(base, 0, control=0x40))
    hold(frames, 5)
    # Hard sync of voice 1 to voice 3, with voice 3's frequency swept, then ring modulation.
    frames.append(voice_writes(base, 2, freq=sid_freq(110, clock), control=0x00) +
                  voice_writes(base, 0, freq=sid_freq(note_hz(-9), clock), ad=0x00, sr=0xF0, control=0x23))
    for step in range(75):
        frames.append(voice_writes(base, 2, freq=sid_freq(110 + step * 4, clock)))
    frames.append(voice_writes(base, 0, freq=sid_freq(note_hz(-9), clock), control=0x15))
    for step in range(75):
        frames.append(voice_writes(base, 2, freq=sid_freq(55 + step * 3, clock)))
    frames.append(voice_writes(base, 0, control=0x14))
    hold(frames, 5)
    # A three-voice chord, one waveform per voice.
    frames.append(voice_writes(base, 0, freq=sid_freq(note_hz(-21), clock), pulse=0x0600, ad=0x22, sr=0xC8, control=0x41) +
                  voice_writes(base, 1, freq=sid_freq(note_hz(-17), clock), ad=0x22, sr=0xC8, control=0x21) +
                  voice_writes(base, 2, freq=sid_freq(note_hz(-14), clock), ad=0x22, sr=0xC8, control=0x11))
    hold(frames, 75)
    frames.append(voice_writes(base, 0, control=0x40) + voice_writes(base, 1, control=0x20) +
                  voice_writes(base, 2, control=0x10))
    hold(frames, 25)
    return frames


def filter_frames(base: int = 0xD400) -> list[Frame]:
    chord = [(-33, 0x21), (-29, 0x21), (-26, 0x41)]  # C3 E3 G3: two saws and a pulse
    frames: list[Frame] = [[]]
    for voice, (semitone, control) in enumerate(chord):
        frames[0] += voice_writes(base, voice, freq=sid_freq(note_hz(semitone)), pulse=0x0800, ad=0x00, sr=0xF0,
                                  control=control)
    for mode in (0x10, 0x20, 0x40, 0x50):
        for resonance in (0x0, 0xF):
            frames.append([(base + 0x17, (resonance << 4) | 0x07), (base + 0x18, mode | 0x0F)])
            for step in range(120):
                position = step / 119
                cutoff = int(2047 * (1 - abs(2 * position - 1)))
                frames.append([(base + 0x15, cutoff & 0x07), (base + 0x16, cutoff >> 3)])
    frames.append(voice_writes(base, 0, control=0x20) + voice_writes(base, 1, control=0x20) +
                  voice_writes(base, 2, control=0x40))
    hold(frames, 25)
    return frames


def envelope_frames() -> list[Frame]:
    frames: list[Frame] = [[(0xD418, 0x0F)]]
    freq = sid_freq(note_hz(-21))
    # Each rate pair, held, then released.
    for ad, sr, gate_frames, release_frames in (
        (0x00, 0xF0, 25, 10), (0x40, 0xA0, 40, 20), (0x88, 0x84, 40, 30), (0xC4, 0x66, 50, 40),
        (0x0A, 0x09, 40, 40), (0x2C, 0x5B, 40, 50),
    ):
        frames.append(voice_writes(0xD400, 0, freq=freq, ad=ad, sr=sr, control=0x21))
        hold(frames, gate_frames)
        frames.append(voice_writes(0xD400, 0, control=0x20))
        hold(frames, release_frames)
    # Gate retriggered faster than the envelope completes, at three rates.
    for interval in (1, 2, 3):
        frames.append(voice_writes(0xD400, 1, freq=sid_freq(note_hz(-14)), ad=0x26, sr=0x88))
        for _ in range(60 // interval):
            frames.append(voice_writes(0xD400, 1, control=0x41))
            hold(frames, interval - 1)
            frames.append(voice_writes(0xD400, 1, control=0x40))
        hold(frames, 25)
    return frames


def multispeed_frames(calls_per_second: int) -> list[Frame]:
    """A fast arpeggio and vibrato, which only sound right when every call lands."""
    frames: list[Frame] = [[(0xD418, 0x0F)] + voice_writes(0xD400, 0, ad=0x00, sr=0xF0, control=0x41, pulse=0x0700)]
    steps = calls_per_second * 16
    for step in range(steps):
        semitone = (-21, -17, -14, -9)[(step // 2) % 4]
        vibrato = 1 + 0.01 * math.sin(2 * math.pi * 6 * step / calls_per_second)
        frames.append(voice_writes(0xD400, 0, freq=sid_freq(note_hz(semitone) * vibrato)))
    frames.append(voice_writes(0xD400, 0, control=0x40))
    hold(frames, calls_per_second)
    return frames


def volume_step_frames() -> list[Frame]:
    """Master volume toggled every 1, 2, 4 and 8 frames, then ramped, with no voice ever gated."""
    frames: list[Frame] = []
    for period in (1, 2, 4, 8):
        for step in range(200 // period):
            frames.append([(0xD418, 0x0F if step % 2 == 0 else 0x00)])
            hold(frames, period - 1)
    for level in list(range(16)) + list(range(15, -1, -1)):
        frames.append([(0xD418, level)])
        hold(frames, 5)
    return frames


def combine(*voices: list[Frame]) -> list[Frame]:
    """Play several scripts at once, frame by frame; the shorter ones hold their last state."""
    length = max(len(v) for v in voices)
    return [sum((v[i] for v in voices if i < len(v)), []) or [IDLE_WRITE] for i in range(length)]


# ── the special players ─────────────────────────────────────────────────────────────────────────


def digi_tune(model_flag: int, name: str) -> Tune:
    """4-bit samples written to $D418 from a CIA-timed play routine, as sample players do.

    Pages of 256 samples, each a tone at its own amplitude, so the level moves every 33 ms in a
    pattern that does not repeat within two seconds, which an envelope comparison can align on
    without locking onto the wrong repetition. The routine steps to the next page by rewriting the
    high byte of its own `lda samples,x`.
    """
    rate_hz = 7812
    seed = 0x2A
    amplitudes = []
    for _ in range(64):
        seed = (seed * 75 + 74) % 65537
        amplitudes.append((seed >> 8) % 8)
    a = Asm(LOAD_ADDR)
    a.label("init")
    a.emit(0xA9, 0x00, 0x85, SAMPLE_INDEX)  # lda #0 ; sta index
    set_cia_timer(a, int(PAL_CLOCK_HZ / rate_hz))
    a.emit(0x60)
    a.label("play")
    a.emit(0xA6, SAMPLE_INDEX)  # ldx index
    a.label("fetch")
    a.abs_ref(0xBD, "samples")  # lda samples,x   (its high byte is the current page)
    a.emit(0x8D, 0x18, 0xD4)  # sta $d418
    a.emit(0xE8, 0x86, SAMPLE_INDEX)  # inx ; stx index
    a.rel_ref(0xD0, "same_page")  # bne same_page
    a.emit(0xAE)  # ldx fetch+2
    a.fixups.append((len(a.code), "fetch", "abs+2"))
    a.emit(0, 0)
    a.emit(0xE8)  # inx
    a.emit(0xE0)  # cpx #>samples_end
    a.fixups.append((len(a.code), "samples_end", "hi"))
    a.emit(0)
    a.rel_ref(0x90, "store_page")  # bcc store_page
    a.emit(0xA2)  # ldx #>samples
    a.fixups.append((len(a.code), "samples", "hi"))
    a.emit(0)
    a.label("store_page")
    a.emit(0x8E)  # stx fetch+2
    a.fixups.append((len(a.code), "fetch", "abs+2"))
    a.emit(0, 0)
    a.label("same_page")
    a.emit(0x60)
    while a.pc & 0xFF:
        a.emit(0)
    a.label("samples")
    for page, amplitude in enumerate(amplitudes):
        periods = 4 if page % 2 == 0 else 8
        for i in range(256):
            # Floored around 8 rather than rounded: Python rounds halves to even, which gave pairs of
            # amplitudes the same peak and halved the number of distinct levels.
            a.emit(min(15, math.floor(8 + amplitude * math.sin(2 * math.pi * periods * i / 256))))
    a.label("samples_end")
    return Tune(name, "C64 Commander digi probe", a.link(), a.labels["init"], a.labels["play"],
                FLAG_PAL | model_flag, cia_speed=True)


def rsid_tune() -> Tune:
    """An RSID that banks out the ROMs, installs its own CIA interrupt handler and never returns."""
    a = Asm(LOAD_ADDR)
    a.label("init")
    a.emit(0x78)  # sei
    a.emit(0xA9, 0x35, 0x85, 0x01)  # lda #$35 ; sta $01   (RAM under the KERNAL, I/O visible)
    a.lo_ref("irq")
    a.emit(0x8D, 0xFE, 0xFF)  # sta $fffe
    a.hi_ref("irq")
    a.emit(0x8D, 0xFF, 0xFF)  # sta $ffff
    # Every other interrupt source off and acknowledged: a raster interrupt left pending re-enters
    # the handler as soon as it returns, and the script then runs as fast as the CPU can.
    a.emit(0xA9, 0x00, 0x8D, 0x1A, 0xD0)  # lda #0 ; sta $d01a  (no VIC interrupts)
    a.emit(0xA9, 0xFF, 0x8D, 0x19, 0xD0)  # lda #$ff ; sta $d019  (acknowledge any pending)
    a.emit(0xA9, 0x7F, 0x8D, 0x0D, 0xDD, 0xAD, 0x0D, 0xDD)  # lda #$7f ; sta $dd0d ; lda $dd0d  (no NMIs)
    a.emit(0xA9, 0x7F, 0x8D, 0x0D, 0xDC, 0xAD, 0x0D, 0xDC)  # lda #$7f ; sta $dc0d ; lda $dc0d
    set_cia_timer(a, 19656)  # one PAL frame
    a.emit(0xA9, 0x81, 0x8D, 0x0D, 0xDC)  # lda #$81 ; sta $dc0d  (timer A interrupts)
    a.emit(0xA9, 0x11, 0x8D, 0x0E, 0xDC)  # lda #$11 ; sta $dc0e  (load and start, continuous)
    init_pointer(a, "script")
    a.emit(0x58)  # cli
    a.label("idle")
    a.abs_ref(0x4C, "idle")  # jmp idle
    a.label("irq")
    a.emit(0x48, 0x8A, 0x48, 0x98, 0x48)  # pha ; txa ; pha ; tya ; pha
    a.abs_ref(0x20, "play")  # jsr play
    a.emit(0xAD, 0x0D, 0xDC)  # lda $dc0d  (acknowledge)
    a.emit(0x68, 0xA8, 0x68, 0xAA, 0x68, 0x40)  # pla ; tay ; pla ; tax ; pla ; rti
    script_player(a, "script")
    emit_script(a, "script", waveform_frames())
    return Tune("rsid-irq", "C64 Commander RSID probe", a.link(), a.labels["init"], 0, FLAG_PAL | FLAG_8580,
                rsid=True)


def tunes() -> list[Tune]:
    return [
        script_tune("waveforms-6581", "C64 Commander waveform probe", waveform_frames(), FLAG_PAL | FLAG_6581),
        script_tune("waveforms-8580", "C64 Commander waveform probe", waveform_frames(), FLAG_PAL | FLAG_8580),
        script_tune("filter-6581", "C64 Commander filter probe", filter_frames(), FLAG_PAL | FLAG_6581),
        script_tune("filter-8580", "C64 Commander filter probe", filter_frames(), FLAG_PAL | FLAG_8580),
        script_tune("envelopes", "C64 Commander envelope probe", envelope_frames(), FLAG_PAL | FLAG_8580),
        script_tune("two-sid", "C64 Commander 2SID probe", combine(waveform_frames(), filter_frames(0xD420)),
                    FLAG_PAL | FLAG_8580 | FLAG_SECOND_8580, second_sid=0x42),
        script_tune("three-sid", "C64 Commander 3SID probe",
                    combine(waveform_frames(), filter_frames(0xD420), envelope_frames_at(0xD440)),
                    FLAG_PAL | FLAG_8580 | FLAG_SECOND_8580 | FLAG_THIRD_8580, second_sid=0x42, third_sid=0x44),
        script_tune("ntsc", "C64 Commander NTSC probe", waveform_frames(NTSC_CLOCK_HZ), FLAG_NTSC | FLAG_8580),
        script_tune("multispeed", "C64 Commander multispeed probe", multispeed_frames(200), FLAG_PAL | FLAG_8580,
                    cia_cycles=int(PAL_CLOCK_HZ / 200)),
        script_tune("volume-steps-6581", "C64 Commander volume probe", volume_step_frames(), FLAG_PAL | FLAG_6581),
        script_tune("volume-steps-8580", "C64 Commander volume probe", volume_step_frames(), FLAG_PAL | FLAG_8580),
        digi_tune(FLAG_6581, "digi-6581"),
        digi_tune(FLAG_8580, "digi-8580"),
        rsid_tune(),
    ]


def envelope_frames_at(base: int) -> list[Frame]:
    return [[(base + (address - 0xD400), value) for address, value in frame] for frame in envelope_frames()]


def build_sid(tune: Tune) -> bytes:
    version = 4 if tune.third_sid else 3 if tune.second_sid else 2
    data = struct.pack("<H", LOAD_ADDR) + tune.code
    if LOAD_ADDR + len(tune.code) > 0xD000:
        raise ValueError(f"{tune.name} does not fit below $D000")
    header = b"RSID" if tune.rsid else b"PSID"
    header += struct.pack(">HHHHHHH", version, 0x7C, 0, tune.init, tune.play, 1, 1)
    header += struct.pack(">I", 1 if tune.cia_speed else 0)
    header += tune.title.encode().ljust(32, b"\0")[:32]
    header += b"C64 Commander".ljust(32, b"\0")[:32]
    header += b"2026".ljust(32, b"\0")[:32]
    header += struct.pack(">H", tune.flags)
    header += bytes([0, 0, tune.second_sid, tune.third_sid])
    assert len(header) == 0x7C, len(header)
    return header + data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--out", type=Path, default=Path("tests/fixtures/sid-engines"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for tune in tunes():
        path = args.out / f"{tune.name}.sid"
        path.write_bytes(build_sid(tune))
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
