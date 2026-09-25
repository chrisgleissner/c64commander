/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { APP_STYLES } from "@/generated/appStyles";

// User-visible text is American English (AGENTS.md), and these names are shown in Settings and the manual.
const BRITISH_SPELLINGS = /\b(grey|greys|colour|colours|centre|behaviour|favourite)\b/i;

describe("appearance style names", () => {
  it("names and describes every style in American English", () => {
    const shown = APP_STYLES.flatMap((style) => [style.name, style.description]);

    expect(shown.filter((text) => BRITISH_SPELLINGS.test(text))).toEqual([]);
  });
});
