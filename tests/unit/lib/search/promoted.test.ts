/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { PROMOTED_ENTRY_IDS } from "@/lib/search/promoted";
import { STATIC_SEARCH_ENTRIES } from "@/generated/searchIndex";

/*
 * Home's tiles and the search overlay's chips are the same four promoted actions (spec.md 6.3).
 * They were held as two lists and had already disagreed about the fourth: Home offered Live View
 * and the overlay offered the Play page.
 */
describe("the promoted actions", () => {
  it("are the four the specification names", () => {
    expect(PROMOTED_ENTRY_IDS).toEqual([
      "action.sid-radio",
      "action.resume-session",
      "action.recently-played",
      "home.section.live-view",
    ]);
  });

  it("every one of them is an entry the index actually holds", () => {
    for (const id of PROMOTED_ENTRY_IDS) {
      expect(
        STATIC_SEARCH_ENTRIES.some((entry) => entry.id === id),
        `promoted id ${id} is not in the generated index`,
      ).toBe(true);
    }
  });
});
