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
  romBasicDialogText,
  ROM_LISTED_DIALOG_TITLE,
  romListedDialogText,
  romListedSkippedNotice,
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

describe("decideRomListedPlayback for a song the phone cannot play at all", () => {
  it.each([
    // skipEnabled, autoAdvance, accepted -> outcome, with no usable C64
    [true, true, false, "skip"],
    [false, true, false, "skip"],
    [true, false, false, "blocked"],
    [false, false, false, "blocked"],
    [true, false, true, "blocked"],
  ] as const)("skipping %s, moving on by itself %s, accepted %s: %s", (skipEnabled, autoAdvance, accepted, outcome) => {
    expect(decideRomListedPlayback({ c64Usable: false, skipEnabled, autoAdvance, accepted, playable: false })).toBe(
      outcome,
    );
  });

  it("goes to a usable C64 whatever the phone can play", () => {
    expect(decideRomListedPlayback({ c64Usable: true, skipEnabled: true, autoAdvance: false, playable: false })).toBe(
      "c64",
    );
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
    expect(romBasicDialogText()).toBe(
      "This tune is a BASIC program and needs the C64’s BASIC ROM. Connect a C64, or add the ROMs in Settings.",
    );
    for (const text of texts) expect(text).not.toMatch(/lane|mask|sidromdep|incompatible/i);
  });
});
