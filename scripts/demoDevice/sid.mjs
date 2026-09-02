/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Real PSID tunes for the simulated device.
 *
 * The simulated device used to hold one 122-byte file whose player did nothing, so every screen
 * that reads a tune — the playlist, the metadata lines, the songlength, the local engine — had
 * nothing true to show. These are genuine SIDs: a 6502 player, a note table, three voices, and a
 * header a metadata parser reads the same way it reads a tune from HVSC.
 *
 * `scripts/generate-test-sid.mjs` builds a single steady tone and is kept for the transition probes
 * that need exactly that. This builds music.
 */

const PAL_CLOCK = 985248;

const WAVEFORMS = { triangle: 0x10, sawtooth: 0x20, pulse: 0x40, noise: 0x80 };

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Hz for a scientific pitch name such as `C3`, `A4` or `F#2`, with A4 = 440 Hz. */
export const noteToHz = (note) => {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!match) throw new Error(`Not a pitch name: ${note}`);
  const [, letter, accidental, octave] = match;
  const semitone =
    SEMITONES[letter.toUpperCase()] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + (Number(octave) + 1) * 12;
  return 440 * Math.pow(2, (semitone - 69) / 12);
};

/** The 16-bit value the SID's frequency registers need for `hz` on a PAL machine. */
export const frequencyRegister = (hz) => Math.min(0xffff, Math.max(1, Math.round((hz * 16777216) / PAL_CLOCK)));

/**
 * A rest, written where a pitch would go.
 *
 * The player gates the voice off for it rather than playing a zero frequency, which is silent for a
 * different reason and leaves the envelope where it was.
 */
export const REST = "r";

/**
 * A two-pass assembler with labels, including relative branches.
 *
 * Hand-counting offsets is how a player ends up branching one byte into the middle of an
 * instruction and playing noise that reads as a SID emulation bug. Pass one records where every
 * label lands and pass two emits with the addresses filled in; both passes emit the same number of
 * bytes because every reference has a fixed width.
 */
const assemble = (origin, program) => {
  const labels = new Map();
  let bytes = [];
  for (let pass = 0; pass < 2; pass += 1) {
    bytes = [];
    const api = {
      emit: (...values) => bytes.push(...values.map((value) => value & 0xff)),
      label: (name) => labels.set(name, origin + bytes.length),
      /** Two bytes, little-endian, of an absolute address. */
      abs: (name) => {
        const address = labels.get(name) ?? origin;
        bytes.push(address & 0xff, (address >> 8) & 0xff);
      },
      /** One byte of branch displacement, measured from the instruction after the operand. */
      rel: (name) => {
        const target = labels.get(name) ?? origin;
        const next = origin + bytes.length + 1;
        const delta = target - next;
        if (pass === 1 && (delta < -128 || delta > 127)) {
          throw new Error(`branch to ${name} is ${delta} bytes away, out of range`);
        }
        bytes.push(delta & 0xff);
      },
    };
    program(api);
  }
  return { code: Uint8Array.from(bytes), labels };
};

// 6502 opcodes, only the ones this player uses.
const LDA_IMM = 0xa9;
const LDA_ZP = 0xa5;
const LDA_ABSX = 0xbd;
const STA_ABS = 0x8d;
const STA_ZP = 0x85;
const LDX_ZP = 0xa6;
const INC_ZP = 0xe6;
const CMP_IMM = 0xc9;
const BNE = 0xd0;
const BEQ = 0xf0;
const RTS = 0x60;

const SID = 0xd400;
const ZP_FRAME = 0xfb; // frames elapsed inside the current step
const ZP_STEP = 0xfc; // index into the note tables

/**
 * The tune's C64 side: an init routine, and a play routine the host calls once per frame.
 *
 * `voices` is one to three arrays of the same length. Each entry is a pitch name or {@link REST}
 * and lasts `framesPerStep` frames, so the voices stay in step by construction rather than through
 * three counters that can drift apart.
 */
const buildPlayer = ({ voices, framesPerStep, volume, waveform, attackDecay, sustainRelease, pulseWidth }) => {
  const steps = voices[0].length;
  for (const voice of voices) {
    if (voice.length !== steps) throw new Error("every voice needs the same number of steps");
  }
  if (steps > 255) throw new Error("a tune is limited to 255 steps");
  if (voices.length > 3) throw new Error("the SID has three voices");

  const wave = WAVEFORMS[waveform];
  if (wave === undefined) throw new Error(`Unknown waveform: ${waveform}`);

  const registers = voices.map((voice) => voice.map((note) => (note === REST ? 0 : frequencyRegister(noteToHz(note)))));
  const gates = voices.map((voice) => voice.map((note) => (note === REST ? 0 : 1)));

  return assemble(0x1000, ({ emit, label, abs, rel }) => {
    const write = (address, value) => emit(LDA_IMM, value, STA_ABS, address & 0xff, (address >> 8) & 0xff);

    label("init");
    emit(LDA_IMM, 0x00, STA_ZP, ZP_FRAME);
    // 0xff so the first tick wraps to step 0 and the tune starts on its first note rather than its
    // second.
    emit(LDA_IMM, 0xff, STA_ZP, ZP_STEP);
    write(SID + 0x18, volume & 0x0f);
    for (let voice = 0; voice < voices.length; voice += 1) {
      const base = SID + voice * 7;
      write(base + 2, pulseWidth & 0xff);
      write(base + 3, (pulseWidth >> 8) & 0x0f);
      write(base + 5, attackDecay & 0xff);
      write(base + 6, sustainRelease & 0xff);
      write(base + 4, 0x00);
    }
    emit(RTS);

    label("play");
    emit(INC_ZP, ZP_FRAME);
    emit(LDA_ZP, ZP_FRAME);
    emit(CMP_IMM, framesPerStep & 0xff);
    emit(BEQ);
    rel("step");
    emit(RTS);

    label("step");
    emit(LDA_IMM, 0x00, STA_ZP, ZP_FRAME);
    emit(INC_ZP, ZP_STEP);
    emit(LDA_ZP, ZP_STEP);
    emit(CMP_IMM, steps & 0xff);
    emit(BNE);
    rel("advance");
    emit(LDA_IMM, 0x00, STA_ZP, ZP_STEP);

    label("advance");
    emit(LDX_ZP, ZP_STEP);
    for (let voice = 0; voice < voices.length; voice += 1) {
      const base = SID + voice * 7;
      emit(LDA_ABSX);
      abs(`lo${voice}`);
      emit(STA_ABS, base & 0xff, base >> 8);
      emit(LDA_ABSX);
      abs(`hi${voice}`);
      emit(STA_ABS, (base + 1) & 0xff, (base + 1) >> 8);
      // The gate is dropped and re-raised on every step, which is what gives each note its own
      // attack rather than one held tone that only changes pitch.
      write(base + 4, 0x00);
      emit(LDA_ABSX);
      abs(`gate${voice}`);
      emit(BEQ);
      rel(`silent${voice}`);
      write(base + 4, wave | 0x01);
      label(`silent${voice}`);
    }
    emit(RTS);

    for (let voice = 0; voice < voices.length; voice += 1) {
      label(`lo${voice}`);
      emit(...registers[voice].map((value) => value & 0xff));
      label(`hi${voice}`);
      emit(...registers[voice].map((value) => (value >> 8) & 0xff));
      label(`gate${voice}`);
      emit(...gates[voice]);
    }
  });
};

/** A PSID version 2 file, laid out as PSIDv2NG defines it and as `src/lib/sid/sidUtils.ts` reads it. */
export const buildSid = ({
  voices,
  title,
  author,
  released = "2026 C64 Commander",
  framesPerStep = 12,
  volume = 12,
  waveform = "pulse",
  attackDecay = 0x18,
  sustainRelease = 0xa8,
  pulseWidth = 0x0800,
}) => {
  const { code, labels } = buildPlayer({
    voices,
    framesPerStep,
    volume,
    waveform,
    attackDecay,
    sustainRelease,
    pulseWidth,
  });
  const loadAddress = 0x1000;

  const header = Buffer.alloc(0x7c);
  header.write("PSID", 0, "ascii");
  header.writeUInt16BE(0x0002, 4); // version 2
  header.writeUInt16BE(0x007c, 6); // where the C64 data starts
  header.writeUInt16BE(loadAddress, 8);
  header.writeUInt16BE(labels.get("init"), 10);
  header.writeUInt16BE(labels.get("play"), 12);
  header.writeUInt16BE(1, 14); // one song
  header.writeUInt16BE(1, 16); // starting with the first
  header.writeUInt32BE(0, 18); // driven by the vertical blank
  header.write(title.slice(0, 31), 22, "latin1");
  header.write(author.slice(0, 31), 54, "latin1");
  header.write(released.slice(0, 31), 86, "latin1");
  // bit 0 clear = built-in player, bits 2-3 = clock (01 PAL), bits 4-5 = SID model (01 = 6581).
  header.writeUInt16BE(0b00010100, 118);
  return Buffer.concat([header, Buffer.from(code)]);
};

/** How long one pass of a tune takes, for the songlength database the app reads. */
export const tuneSeconds = (voices, framesPerStep) => (voices[0].length * framesPerStep) / (985248 / 19656);
