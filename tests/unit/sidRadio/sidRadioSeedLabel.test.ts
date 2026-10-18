/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { readableSeedLabel } from "@/pages/playFiles/sidRadioSeedLabel";

describe("readableSeedLabel", () => {
  it("replaces underscores and drops the .sid extension from a file name", () => {
    expect(readableSeedLabel("Monty_on_the_Run.sid")).toBe("Monty on the Run");
  });

  it("leaves an already readable title unchanged", () => {
    expect(readableSeedLabel("Monty on the Run")).toBe("Monty on the Run");
  });

  it("falls back to the original text when nothing readable remains", () => {
    expect(readableSeedLabel(".sid")).toBe(".sid");
  });
});
