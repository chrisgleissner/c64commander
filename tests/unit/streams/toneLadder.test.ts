/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  AV_DETECTABLE_MS,
  C64_COLOUR_NAMES,
  TONE_LADDER_LOOP_SECONDS,
  TONE_LADDER_NOTES,
  TONE_LADDER_SLOTS,
  TONE_LADDER_SLOT_SECONDS,
  centsBetween,
  detectFundamentalHz,
  gradeToneLadder,
  slotForColour,
  toneLadderSidBytes,
} from "@/lib/streams/toneLadder";
import { sampleBackgroundColour, segmentNotes } from "@/hooks/useToneLadderTest";
import { VIC_FRAME_WIDTH } from "@/lib/streams/vicDecode";

/**
 * The ladder exists because "the stream sounds rough" turned out to be a second Ultimate streaming
 * into the same multicast group: double the arrival rate, two interleaved sequence spaces, no packet
 * loss and no underruns. These tests pin the grading of that exact shape — wrong pitch, roughly
 * double length, and silences that are not silent — not just the arithmetic underneath it.
 */
describe("the ladder itself", () => {
  it("is 18 slots: a silence, an octave up, a silence, an octave back down", () => {
    expect(TONE_LADDER_SLOTS).toHaveLength(18);
    expect(TONE_LADDER_NOTES).toHaveLength(16);
    expect(TONE_LADDER_SLOTS[0]!.hz).toBe(0);
    expect(TONE_LADDER_SLOTS[9]!.hz).toBe(0);

    const names = TONE_LADDER_NOTES.map((slot) => slot.name);
    expect(names.slice(0, 8)).toEqual(["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"]);
    expect(names.slice(8)).toEqual(["C4", "B3", "A3", "G3", "F3", "E3", "D3", "C3"]);
  });

  it("walks every C64 colour exactly once per loop, one per note", () => {
    const colours = TONE_LADDER_NOTES.map((slot) => slot.colour);

    expect(colours).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(new Set(colours).size).toBe(C64_COLOUR_NAMES.length);
    // Which is what lets a single frame identify the slot it belongs to.
    expect(slotForColour(7)?.name).toBe("C4");
    expect(slotForColour(15)?.name).toBe("C3");
  });

  it("times slots against PAL's real refresh, not a round 50 Hz", () => {
    // 25 frames at 985248/19656 Hz. Assuming 50 would put a constant -1 ms on every note.
    expect(TONE_LADDER_SLOT_SECONDS).toBeCloseTo(0.49876, 4);
    expect(TONE_LADDER_LOOP_SECONDS).toBeCloseTo(8.978, 2);
  });

  it("carries a real PSID", () => {
    const bytes = toneLadderSidBytes();

    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("PSID");
    expect(bytes.length).toBeGreaterThan(256);
  });
});

describe("pitch detection", () => {
  it("detects the fundamental of a synthesised note", () => {
    const rate = 48000;
    const hz = 220; // A3
    const samples = new Float32Array(rate * 0.3);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((2 * Math.PI * hz * i) / rate);

    expect(Math.abs(centsBetween(detectFundamentalHz(samples, rate), hz))).toBeLessThan(20);
  });

  it("can represent a pitch an octave below the ladder, which is how the two-sender fault looks", () => {
    const rate = 48000;
    const hz = TONE_LADDER_NOTES[0]!.hz / 2;
    const samples = new Float32Array(rate * 0.3);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((2 * Math.PI * hz * i) / rate);

    // A detector that cannot express the failure cannot report it.
    expect(Math.abs(centsBetween(detectFundamentalHz(samples, rate), hz))).toBeLessThan(50);
  });
});

describe("grading", () => {
  const cleanNotes = () =>
    TONE_LADDER_NOTES.map((slot, index) => ({
      hz: slot.hz,
      // The note before each silence is two slots from the next onset, not one.
      seconds: (index === 7 || index === 15 ? 2 : 1) * TONE_LADDER_SLOT_SECONDS,
    }));

  it("grades a clean ladder as fully in tune and correctly timed", () => {
    const result = gradeToneLadder(cleanNotes());

    expect(result.notesInTune).toBe(16);
    expect(result.inTunePct).toBe(100);
    expect(result.medianCentsError).toBeLessThan(1);
    expect(result.medianLengthErrorMs).toBeCloseTo(0, 1);
    expect(result.shortNotes).toBe(0);
    expect(result.longNotes).toBe(0);
  });

  it("aligns to the ladder wherever the recording started", () => {
    // A looping tune is joined mid-ladder, so the offset is searched, not assumed.
    const rotated = [...cleanNotes().slice(6), ...cleanNotes().slice(0, 6)];

    expect(gradeToneLadder(rotated).inTunePct).toBe(100);
  });

  it("catches the double-rate signature of a second sender on the group", () => {
    const notes = cleanNotes().map((note) => ({ hz: note.hz / 2, seconds: note.seconds * 2 }));

    const result = gradeToneLadder(notes);

    // Dropping an octave maps C4 exactly onto C3, which is a real ladder pitch, so the two C4s
    // still "match". Everything else lands between the scale degrees, and every note runs long.
    expect(result.notesInTune).toBeLessThanOrEqual(2);
    expect(result.inTunePct).toBeLessThanOrEqual(13);
    expect(result.longNotes).toBe(notes.length);
    expect(result.medianCentsError).toBeGreaterThan(1000); // an octave is 1200 cents
  });

  it("counts notes that lost audio in the middle as short", () => {
    const notes = cleanNotes().map((note, i) => ({ ...note, seconds: i < 5 ? note.seconds * 0.3 : note.seconds }));

    expect(gradeToneLadder(notes).shortNotes).toBe(5);
  });

  it("returns an empty grade rather than throwing when nothing was heard", () => {
    const result = gradeToneLadder([]);

    expect(result.notesInTune).toBe(0);
    expect(result.av.verdict).toBe("not measured");
    expect(result.silence.passed).toBe(false);
  });
});

describe("the silences", () => {
  it("passes when a slot that should be silent is silent", () => {
    const result = gradeToneLadder([], { silences: [{ rmsDbfs: -92, peakDbfs: -80 }] });

    expect(result.silence.measured).toBe(1);
    expect(result.silence.floorDbfs).toBe(-92);
    expect(result.silence.passed).toBe(true);
  });

  it("fails when something is mixing into a slot that should be silent", () => {
    // The two-sender fault produced no packet loss and no underruns, but it could never have
    // produced silence on cue — which is what makes this the cheapest detector for it.
    const result = gradeToneLadder([], {
      silences: [
        { rmsDbfs: -92, peakDbfs: -80 },
        { rmsDbfs: -30, peakDbfs: -12 },
      ],
    });

    expect(result.silence.passed).toBe(false);
    expect(result.silence.floorDbfs).toBe(-30);
  });

  it("does not claim a pass when no silence was found at all", () => {
    expect(gradeToneLadder(cleanish()).silence.passed).toBe(false);
  });

  const cleanish = () => TONE_LADDER_NOTES.map((slot) => ({ hz: slot.hz, seconds: TONE_LADDER_SLOT_SECONDS }));
});

describe("A/V sync", () => {
  const notesAt = (offsetMs: number) =>
    TONE_LADDER_NOTES.map((slot, index) => ({
      hz: slot.hz,
      seconds: TONE_LADDER_SLOT_SECONDS,
      atMs: 1000 + index * TONE_LADDER_SLOT_SECONDS * 1000 + offsetMs,
    }));
  const coloursAt = () =>
    TONE_LADDER_NOTES.map((slot, index) => ({
      colour: slot.colour!,
      atMs: 1000 + index * TONE_LADDER_SLOT_SECONDS * 1000,
    }));

  it("reports sound and picture arriving together as undetectable", () => {
    const result = gradeToneLadder(notesAt(0), { colourChanges: coloursAt() });

    expect(result.av.samples).toBe(16);
    expect(result.av.medianOffsetMs).toBeCloseTo(0, 1);
    expect(result.av.verdict).toBe("undetectable");
  });

  it("grades a lead against ITU-R BT.1359-1 rather than a threshold of our own", () => {
    // Just inside the standard's detectability threshold for sound ahead of picture.
    expect(gradeToneLadder(notesAt(AV_DETECTABLE_MS.lead - 5), { colourChanges: coloursAt() }).av.verdict).toBe(
      "undetectable",
    );
    expect(gradeToneLadder(notesAt(AV_DETECTABLE_MS.lead + 5), { colourChanges: coloursAt() }).av.verdict).toBe(
      "detectable",
    );
    expect(gradeToneLadder(notesAt(200), { colourChanges: coloursAt() }).av.verdict).toBe("unacceptable");
  });

  it("keeps the sign convention: positive means the sound is ahead of the picture", () => {
    expect(gradeToneLadder(notesAt(60), { colourChanges: coloursAt() }).av.medianOffsetMs).toBeGreaterThan(0);
    expect(gradeToneLadder(notesAt(-60), { colourChanges: coloursAt() }).av.medianOffsetMs).toBeLessThan(0);
  });

  it("says 'not measured' rather than zero when there is no video", () => {
    const result = gradeToneLadder(notesAt(0));

    expect(result.av.verdict).toBe("not measured");
    expect(result.av.samples).toBe(0);
    expect(result.colour.changes).toBe(0);
  });
});

describe("sampling the background colour from a frame", () => {
  /** A 4bpp frame with a black border and a solid background inside it. */
  const frameWith = (background: number, height = 272): Uint8Array => {
    const frame = new Uint8Array((VIC_FRAME_WIDTH * height) / 2);
    for (let y = 30; y < height - 30; y += 1) {
      for (let x = 40; x < VIC_FRAME_WIDTH - 40; x += 1) {
        const pixel = y * VIC_FRAME_WIDTH + x;
        const index = pixel >> 1;
        frame[index] = pixel & 1 ? (frame[index]! & 0x0f) | (background << 4) : (frame[index]! & 0xf0) | background;
      }
    }
    return frame;
  };

  it("reads the background rather than the border", () => {
    // The border is black for the whole tune, so sampling it would report colour 0 forever.
    expect(sampleBackgroundColour(frameWith(7), 272)).toBe(7);
    expect(sampleBackgroundColour(frameWith(6), 272)).toBe(6);
  });

  it("is not outvoted by text on the screen", () => {
    const frame = frameWith(6);
    // Scribble a band of glyph pixels across the middle; the background must still win.
    for (let x = 40; x < 300; x += 1) {
      const pixel = 136 * VIC_FRAME_WIDTH + x;
      const index = pixel >> 1;
      frame[index] = pixel & 1 ? (frame[index]! & 0x0f) | (1 << 4) : (frame[index]! & 0xf0) | 1;
    }

    expect(sampleBackgroundColour(frame, 272)).toBe(6);
  });
});

describe("segmenting a captured ladder", () => {
  const RATE = 48000;

  /** Synthesise notes with a clear attack and a gated tail, the way the fixture sounds. */
  const synth = (hzs: number[], seconds = TONE_LADDER_SLOT_SECONDS): Float32Array => {
    const out = new Float32Array(Math.round(RATE * seconds * hzs.length));
    hzs.forEach((hz, index) => {
      const start = Math.round(index * seconds * RATE);
      const length = Math.round(seconds * RATE);
      const sounding = Math.round(length * 0.84); // gated off 80 ms before the slot ends
      for (let i = 0; i < sounding; i += 1) {
        out[start + i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE);
      }
    });
    return out;
  };

  it("finds one note per slot and grades them in tune", () => {
    const expected = TONE_LADDER_NOTES.slice(0, 6).map((slot) => slot.hz);

    const { notes } = segmentNotes(synth(expected), RATE);

    expect(notes.length).toBeGreaterThanOrEqual(expected.length - 2);
    expect(gradeToneLadder(notes).inTunePct).toBeGreaterThanOrEqual(80);
  });

  it("times notes from onset to onset, so the release shape cannot skew the answer", () => {
    const { notes } = segmentNotes(synth(TONE_LADDER_NOTES.slice(0, 6).map((slot) => slot.hz)), RATE);

    for (const note of notes) expect(note.seconds).toBeCloseTo(TONE_LADDER_SLOT_SECONDS, 1);
  });

  it("carries a timestamp for every note so A/V sync has something to subtract", () => {
    const { notes } = segmentNotes(synth(TONE_LADDER_NOTES.slice(0, 4).map((slot) => slot.hz)), RATE, 5000);

    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note.atMs).toBeGreaterThanOrEqual(5000);
  });

  it("returns nothing for silence rather than inventing notes", () => {
    expect(segmentNotes(new Float32Array(RATE), RATE).notes).toEqual([]);
  });

  it("ignores a buffer too short to hold a note", () => {
    expect(segmentNotes(new Float32Array(64), RATE).notes).toEqual([]);
  });
});
