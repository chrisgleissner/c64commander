/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  TONE_LADDER_EXPECTED_HZ,
  TONE_LADDER_EXPECTED_NAMES,
  TONE_LADDER_NOTE_SECONDS,
  centsBetween,
  detectFundamentalHz,
  gradeToneLadder,
  toneLadderSidBytes,
} from "@/lib/streams/toneLadder";

/**
 * The sound-playback-accuracy check exists because "the stream sounds rough" turned out to be a
 * second Ultimate streaming into the same multicast group: double the arrival rate, two interleaved
 * sequence spaces, no packet loss and no underruns. The ladder catches exactly that shape — notes at
 * the wrong pitch and roughly double length — so these tests pin the grading, not just the maths.
 */
describe("tone ladder", () => {
  it("carries a real PSID that plays C3 up to B3 and back", () => {
    const bytes = toneLadderSidBytes();

    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("PSID");
    expect(TONE_LADDER_EXPECTED_NAMES[0]).toBe("C3");
    expect(TONE_LADDER_EXPECTED_NAMES[11]).toBe("B3");
    expect(TONE_LADDER_EXPECTED_NAMES.at(-1)).toBe("C3");
    // 12 up + 11 back down, with no repeated turn-around note.
    expect(TONE_LADDER_EXPECTED_HZ).toHaveLength(23);
  });

  it("detects the fundamental of a synthesised note", () => {
    const rate = 48000;
    const hz = 220; // A3
    const samples = new Float32Array(rate * 0.3);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((2 * Math.PI * hz * i) / rate);

    expect(Math.abs(centsBetween(detectFundamentalHz(samples, rate), hz))).toBeLessThan(20);
  });

  it("grades a clean ladder as fully in tune", () => {
    const notes = TONE_LADDER_EXPECTED_HZ.map((hz) => ({ hz, seconds: TONE_LADDER_NOTE_SECONDS }));

    const result = gradeToneLadder(notes);

    expect(result.notesInTune).toBe(notes.length);
    expect(result.inTunePct).toBe(100);
    expect(result.medianCentsError).toBeLessThan(1);
    expect(result.shortNotes).toBe(0);
    expect(result.longNotes).toBe(0);
  });

  it("aligns to the ladder wherever the recording started", () => {
    // A looping tune is joined mid-ladder, so the offset is searched, not assumed.
    const rotated = [...TONE_LADDER_EXPECTED_HZ.slice(7), ...TONE_LADDER_EXPECTED_HZ.slice(0, 7)].map((hz) => ({
      hz,
      seconds: TONE_LADDER_NOTE_SECONDS,
    }));

    expect(gradeToneLadder(rotated).inTunePct).toBe(100);
  });

  it("catches the double-rate signature of a second sender on the group", () => {
    // Two Ultimates on one multicast group: notes arrive at roughly double length and the wrong
    // pitch, while nothing reports packet loss.
    const notes = TONE_LADDER_EXPECTED_HZ.map((hz) => ({ hz: hz / 2, seconds: TONE_LADDER_NOTE_SECONDS * 2 }));

    const result = gradeToneLadder(notes);

    expect(result.notesInTune).toBe(0);
    expect(result.longNotes).toBe(notes.length);
    expect(result.medianCentsError).toBeGreaterThan(1000); // an octave is 1200 cents
  });

  it("counts notes that lost audio in the middle as short", () => {
    const notes = TONE_LADDER_EXPECTED_HZ.map((hz, i) => ({
      hz,
      seconds: i < 5 ? TONE_LADDER_NOTE_SECONDS * 0.3 : TONE_LADDER_NOTE_SECONDS,
    }));

    expect(gradeToneLadder(notes).shortNotes).toBe(5);
  });

  it("returns an empty grade rather than throwing when nothing was heard", () => {
    expect(gradeToneLadder([]).notesInTune).toBe(0);
  });
});
