/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * The state rows in the config sheet are accurate and answer the wrong question first. "Origin:
 * Unresolved / Resolved file: None / Found nearby: 1" is three facts a user has to combine to learn
 * that nothing is going to happen. This is the sentence that says it outright, and it is also the
 * accessible name of the four-letter chip on the playlist row. It uses the sheet's own vocabulary,
 * so one screen does not call the same thing a config in one place and settings in another.
 */

import { describe, expect, it } from "vitest";
import { describeConfigOutcome } from "@/lib/config/playbackConfig";

const outcome = (over: Partial<Parameters<typeof describeConfigOutcome>[0]>) =>
  describeConfigOutcome({ uiState: "none", fileName: null, overrideCount: 0, candidateCount: 0, ...over });

describe("saying what will happen before an item plays", () => {
  it("names the file that will be applied", () => {
    expect(outcome({ uiState: "resolved", fileName: "Game.cfg" })).toBe("Game.cfg will be applied before this plays.");
  });

  it("counts the changes made on top of that file", () => {
    expect(outcome({ uiState: "edited", fileName: "Game.cfg", overrideCount: 1 })).toBe(
      "Game.cfg will be applied before this plays, with 1 changed setting.",
    );
    expect(outcome({ uiState: "edited", fileName: "Game.cfg", overrideCount: 3 })).toContain("3 changed settings");
  });

  /* Values edited with no file behind them are still applied, and the sentence has to say so. */
  it("describes changes with no file behind them", () => {
    expect(outcome({ uiState: "edited", fileName: null, overrideCount: 2 })).toBe(
      "2 changed settings will be applied before this plays.",
    );
  });

  /*
   * The case the rows read worst: something was found, nothing was chosen, and the row still shows
   * a config chip. The sentence has to lead with "no settings will be applied".
   */
  it("says outright that nothing is applied when a file was found but not chosen", () => {
    expect(outcome({ uiState: "candidates", candidateCount: 1 })).toMatch(/^No config file will be applied\./);
    expect(outcome({ uiState: "candidates", candidateCount: 1 })).toContain("One was found nearby");
    expect(outcome({ uiState: "candidates", candidateCount: 3 })).toContain("3 were found nearby");
  });

  it("distinguishes a choice of none from nothing to choose", () => {
    expect(outcome({ uiState: "declined" })).toContain("because you asked for none");
    expect(outcome({ uiState: "none" })).toContain("None was found beside this one");
  });

  /* One screen, one name for the thing. The sheet's own heading and buttons say "config". */
  it("uses the sheet's own word for the thing throughout", () => {
    (["none", "candidates", "declined"] as const).forEach((uiState) => {
      expect(outcome({ uiState, candidateCount: 2 })).not.toMatch(/settings file/i);
    });
  });

  /* Every state has a sentence: an unanswered one would leave the sheet blank where it matters. */
  it("answers for every state the sheet can be in", () => {
    (["none", "candidates", "resolved", "edited", "declined"] as const).forEach((uiState) => {
      expect(outcome({ uiState, fileName: "Game.cfg", candidateCount: 1, overrideCount: 1 }).length).toBeGreaterThan(
        10,
      );
    });
  });
});
