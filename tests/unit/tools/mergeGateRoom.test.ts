/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { gradeRoomOutput, ROOM_MAX_BURSTS, roomVerdict } from "../../../tools/hil/merge_gate.mjs";

describe("the room check before the audible stages", () => {
  it("counts the tones the probe reports when it found too few to grade", () => {
    expect(
      gradeRoomOutput("recording 8.0s\nonly 2 tone bursts found - is the probe running and the phone audible?"),
    ).toBe(2);
  });

  it("counts a silent room as zero bursts", () => {
    expect(gradeRoomOutput("only 0 tone bursts found - is the probe running")).toBe(0);
  });

  it("counts the tones the probe reports when it graded a ladder", () => {
    expect(gradeRoomOutput("bursts read     81  sequence errors 0\nVERDICT         clean")).toBe(81);
  });

  it("refuses to guess when the probe printed neither form", () => {
    expect(() => gradeRoomOutput("Traceback (most recent call last):\n  OSError: no such device")).toThrow(
      /could not tell how many tones/,
    );
  });

  it("accepts the faint stray tones a quiet room still shows", () => {
    expect(roomVerdict(0)).toBeNull();
    expect(roomVerdict(ROOM_MAX_BURSTS)).toBeNull();
  });

  it("names a loudspeaker on the Ultimate and a phone still playing when a ladder is heard with both phones idle", () => {
    const verdict = roomVerdict(ROOM_MAX_BURSTS + 1);
    expect(verdict).toMatch(/loudspeaker wired to the Ultimate/);
    expect(verdict).toMatch(/a phone still playing/);
    expect(verdict).toMatch(/heard 4 of the probe's tones/);
  });
});
