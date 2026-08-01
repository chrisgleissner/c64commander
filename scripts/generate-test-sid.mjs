#!/usr/bin/env node
/**
 * Build a SID file that holds one steady tone.
 *
 * Real music cannot settle questions about transitions. Both tunes are moving, so an overlap and a
 * hard cut look alike in a spectrum and sound alike to a tired ear. Two steady tones at
 * well-separated pitches make it arithmetic: during a crossfade BOTH are present at the same
 * instant, one falling and one rising, and a hard cut shows one stopping and the other starting with
 * no instant where both are there. That is how the crossfade in `localSidNativeSink` was proved, and
 * why this lives in the repository rather than in a scratch directory.
 *
 * The tunes themselves are NOT checked in — they are a few hundred bytes and regenerating them is
 * instant, so the generator is the artifact worth keeping.
 *
 * Usage:
 *   node scripts/generate-test-sid.mjs --note C3 --out /tmp/tone-c3.sid
 *   node scripts/generate-test-sid.mjs --hz 1760 --waveform pulse --out /tmp/tone-a6.sid
 *
 * Options:
 *   --note <name>      Scientific pitch, e.g. C3, A4, F#2. Mutually exclusive with --hz.
 *   --hz <number>      Pitch in Hz.
 *   --waveform <name>  triangle | sawtooth | pulse | noise. Default triangle, which has far fewer
 *                      harmonics than a sawtooth — harmonics are what let one tone masquerade as
 *                      another when you are trying to tell two apart.
 *   --volume <0-15>    SID master volume. Default 4, not 15: these play out loud in the room while
 *                      a test runs, and the measurement needs a clear tone rather than a loud one.
 *   --name <text>      Title stored in the SID header. Defaults to the pitch.
 *   --out <path>       Where to write. Defaults to ./tone-<pitch>.sid
 */

import { writeFileSync } from "node:fs";

/**
 * The C64's system clock on a PAL machine.
 *
 * The SID's oscillator counts against this, so the register value for a pitch depends on it. An
 * NTSC machine runs at 1022727 Hz and the same register would sound about 4% sharp — which is why
 * the generated header declares PAL rather than leaving it unspecified.
 */
const PAL_CLOCK = 985248;

/** Control-register bit for each waveform, as the SID lays them out. */
const WAVEFORMS = { triangle: 0x10, sawtooth: 0x20, pulse: 0x40, noise: 0x80 };

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Hz for a scientific pitch name such as `C3`, `A4` or `F#2`, with A4 = 440 Hz. */
export const noteToHz = (note) => {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!match) throw new Error(`Not a pitch name: ${note}`);
  const [, letter, accidental, octave] = match;
  const semitone =
    SEMITONES[letter.toUpperCase()] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + (Number(octave) + 1) * 12;
  // MIDI 69 is A4 = 440 Hz.
  return 440 * Math.pow(2, (semitone - 69) / 12);
};

/** The 16-bit value the SID's frequency registers need for `hz` on a PAL machine. */
export const frequencyRegister = (hz) => Math.min(0xffff, Math.max(1, Math.round((hz * 16777216) / PAL_CLOCK)));

/**
 * The player, as 6502 machine code.
 *
 * `init` programs voice 1 and gates it on; `play` does nothing at all, which is the point — the
 * envelope is set to full sustain, so the note holds indefinitely and the output is genuinely
 * constant rather than merely repetitive.
 */
const playerCode = (register, waveform, volume) => {
  const lo = register & 0xff;
  const hi = (register >> 8) & 0xff;
  const init = Uint8Array.from([
    0xa9, volume & 0x0f, 0x8d, 0x18, 0xd4, // LDA #vol : STA $D418   master volume
    0xa9, lo, 0x8d, 0x00, 0xd4, //   LDA #lo  : STA $D400   voice 1 frequency, low byte
    0xa9, hi, 0x8d, 0x01, 0xd4, //   LDA #hi  : STA $D401   voice 1 frequency, high byte
    0xa9, 0x08, 0x8d, 0x02, 0xd4, // LDA #$08 : STA $D402   pulse width, low (for the pulse wave)
    0xa9, 0x08, 0x8d, 0x03, 0xd4, // LDA #$08 : STA $D403   pulse width, high: a half-square
    0xa9, 0x00, 0x8d, 0x05, 0xd4, // LDA #$00 : STA $D405   attack 0, decay 0 — no onset ramp
    0xa9, 0xf0, 0x8d, 0x06, 0xd4, // LDA #$F0 : STA $D406   sustain full, release slow
    0xa9, waveform | 0x01, 0x8d, 0x04, 0xd4, // LDA #wave|gate : STA $D404
    0x60, //                         RTS
  ]);
  return { init, play: Uint8Array.from([0x60]) };
};

/** A PSID version 2 file. The layout is fixed by the format and every field here is required. */
export const buildTestSid = ({ hz, waveform = "triangle", name, volume = 4 }) => {
  const wave = WAVEFORMS[waveform];
  if (wave === undefined) throw new Error(`Unknown waveform: ${waveform}`);
  const loadAddress = 0x1000;
  const { init, play } = playerCode(frequencyRegister(hz), wave, volume);

  const header = Buffer.alloc(0x7c);
  header.write("PSID", 0, "ascii");
  header.writeUInt16BE(0x0002, 4); // version 2
  header.writeUInt16BE(0x007c, 6); // where the C64 data starts
  header.writeUInt16BE(loadAddress, 8);
  header.writeUInt16BE(loadAddress, 10); // init
  header.writeUInt16BE(loadAddress + init.length, 12); // play
  header.writeUInt16BE(1, 14); // one song
  header.writeUInt16BE(1, 16); // starting with the first
  header.writeUInt32BE(0, 18); // driven by the vertical blank
  header.write((name ?? `Tone ${Math.round(hz)}Hz`).slice(0, 31), 22, "latin1");
  header.write("C64 Commander test tone", 54, "latin1");
  header.write("2026", 86, "latin1");
  // Flags: built-in player, PAL, 6581. The clock matters — see PAL_CLOCK.
  header.writeUInt16BE(0b00100100, 118);
  return Buffer.concat([header, Buffer.from(init), Buffer.from(play)]);
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  return args;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.note && !args.hz) {
    console.error("Give --note <C3> or --hz <number>. See the header of this file for the rest.");
    process.exit(2);
  }
  const hz = args.note ? noteToHz(args.note) : Number(args.hz);
  const label = args.note ?? `${Math.round(hz)}Hz`;
  const out = args.out ?? `./tone-${label.toLowerCase().replace("#", "s")}.sid`;
  const volume = args.volume === undefined ? 4 : Number(args.volume);
  const waveform = args.waveform ?? "triangle";
  const sid = buildTestSid({ hz, waveform, name: args.name ?? `Tone ${label}`, volume });
  writeFileSync(out, sid);
  console.log(
    `${out}: ${label} = ${hz.toFixed(2)} Hz, ${waveform}, volume ${volume}/15, ` +
      `register ${frequencyRegister(hz)}, ${sid.length} bytes`,
  );
};

// Only run when invoked directly, so the builders above can be imported by tests.
if (process.argv[1] && process.argv[1].endsWith("generate-test-sid.mjs")) main();
