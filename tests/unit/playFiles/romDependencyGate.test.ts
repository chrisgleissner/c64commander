/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  decideRomListedPlayback,
  ROM_LISTED_DIALOG_TITLE,
  romListedDialogText,
  romListedSkippedNotice,
  romUnplayableDialogText,
  romUnplayableSkippedNotice,
} from "@/pages/playFiles/romDependencyGate";

describe("decideRomListedPlayback", () => {
  it.each([
    // c64Usable, skipEnabled, autoAdvance -> outcome
    [true, true, true, "c64"],
    [true, true, false, "c64"],
    [true, false, true, "c64"],
    [true, false, false, "c64"],
    [false, true, true, "skip"],
    [false, true, false, "ask"],
    [false, false, true, "phone"],
    [false, false, false, "phone"],
  ] as const)(
    "usable C64 %s, skipping %s, moving on by itself %s: %s",
    (c64Usable, skipEnabled, autoAdvance, outcome) => {
      expect(decideRomListedPlayback({ c64Usable, skipEnabled, autoAdvance })).toBe(outcome);
    },
  );

  it.each([
    // c64Usable, skipEnabled, autoAdvance -> outcome for the song already accepted
    [true, true, true, "c64"],
    [false, true, true, "continue"],
    [false, true, false, "continue"],
    [false, false, true, "phone"],
  ] as const)(
    "an accepted song, usable C64 %s, skipping %s, moving on by itself %s: %s, never skipped or asked again",
    (c64Usable, skipEnabled, autoAdvance, outcome) => {
      expect(decideRomListedPlayback({ c64Usable, skipEnabled, autoAdvance, accepted: true })).toBe(outcome);
    },
  );
});

describe("decideRomListedPlayback for a song the phone's engine cannot start without the ROMs", () => {
  it.each([
    // c64Usable, skipEnabled, autoAdvance, accepted -> outcome
    [true, true, true, false, "c64"],
    [true, false, false, false, "c64"],
    [false, true, true, false, "skip"],
    [false, false, true, false, "skip"],
    [false, true, false, false, "ask"],
    [false, false, false, false, "ask"],
    [false, true, true, true, "skip"],
    [false, false, false, true, "ask"],
  ] as const)(
    "usable C64 %s, skipping %s, moving on by itself %s, accepted %s: %s, never played on the phone",
    (c64Usable, skipEnabled, autoAdvance, accepted, outcome) => {
      expect(decideRomListedPlayback({ c64Usable, skipEnabled, autoAdvance, accepted, engineCanStart: false })).toBe(
        outcome,
      );
    },
  );

  it("treats a missing engineCanStart as a song the engine can start", () => {
    expect(decideRomListedPlayback({ c64Usable: false, skipEnabled: false, autoAdvance: false })).toBe("phone");
  });
});

describe("wording for a song the phone cannot play without the ROMs", () => {
  it("says it cannot play here and offers no way to play it anyway", () => {
    const notice = romUnplayableSkippedNotice("Comic Bakery");
    const dialog = romUnplayableDialogText("Comic Bakery");
    expect(notice).toContain("Comic Bakery");
    expect(notice).toContain("Connect your C64");
    expect(notice).not.toContain("Skip songs that need the C64 ROMs");
    expect(dialog).toContain("Comic Bakery");
    expect(dialog).toContain("cannot play on this phone");
    expect(dialog).not.toMatch(/anyway|may sound wrong/i);
  });
});

describe("wording", () => {
  it("names the song and says what to do, without jargon", () => {
    const texts = [
      romListedSkippedNotice("Comic Bakery"),
      romListedDialogText("Comic Bakery"),
      ROM_LISTED_DIALOG_TITLE,
    ];
    expect(texts[0]).toContain("Comic Bakery");
    expect(texts[0]).toContain("Skip songs that need the C64 ROMs");
    expect(texts[1]).toContain("needs the C64’s ROMs to play correctly on this phone");
    for (const text of texts) expect(text).not.toMatch(/lane|mask|sidromdep|incompatible/i);
  });
});
