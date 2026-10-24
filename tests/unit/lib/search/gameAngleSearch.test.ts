/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { STATIC_SEARCH_ENTRIES } from "@/generated/searchIndex";
import { scoreTerm, toScorableText } from "@/lib/search/score";

const matchingIds = (term: string) =>
  STATIC_SEARCH_ENTRIES.filter(
    (entry) =>
      scoreTerm(
        toScorableText({ title: entry.titleDefault, subtitle: entry.subtitleDefault, keywords: entry.keywords }),
        term,
      ) > 0,
  ).map((entry) => entry.id);

describe("Game Mode angle control search", () => {
  it.each(["orientation", "angle"])("finds Game Mode, which holds the Angle control, for '%s'", (term) => {
    expect(matchingIds(term)).toContain("action.game-mode");
  });
});
