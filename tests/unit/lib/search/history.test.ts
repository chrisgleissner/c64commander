/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  PICKED_ENTRY_LIMIT,
  RECENT_QUERY_LIMIT,
  SEARCH_PICKED_KEY,
  SEARCH_RECENT_KEY,
  clearSearchHistory,
  foldRecent,
  loadPickedEntryIds,
  loadRecentQueries,
  recordPickedEntry,
  recordRecentQuery,
} from "@/lib/search/history";

describe("search history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses the keys and caps the spec names", () => {
    expect(SEARCH_RECENT_KEY).toBe("c64u_search_recent:v1");
    expect(SEARCH_PICKED_KEY).toBe("c64u_search_picked:v1");
    expect(RECENT_QUERY_LIMIT).toBe(10);
    expect(PICKED_ENTRY_LIMIT).toBe(20);
  });

  describe("foldRecent", () => {
    it("puts the newest first", () => {
      expect(foldRecent(["b", "c"], "a", 10)).toEqual(["a", "b", "c"]);
    });

    it("moves a repeat to the top rather than adding a second row", () => {
      expect(foldRecent(["a", "b", "c"], "c", 10)).toEqual(["c", "a", "b"]);
    });

    it("de-duplicates without regard to case", () => {
      expect(foldRecent(["Radio"], "radio", 10)).toEqual(["radio"]);
    });

    it("prunes to the cap on write", () => {
      expect(foldRecent(["b", "c", "d"], "a", 2)).toEqual(["a", "b"]);
    });

    it("ignores an empty or whitespace-only value", () => {
      expect(foldRecent(["a"], "   ", 10)).toEqual(["a"]);
    });
  });

  it("records a query and reads it back newest first", () => {
    recordRecentQuery("radio");
    recordRecentQuery("text size");
    expect(loadRecentQueries()).toEqual(["text size", "radio"]);
  });

  it("keeps at most ten queries", () => {
    for (let index = 0; index < 15; index += 1) recordRecentQuery(`query ${index}`);
    expect(loadRecentQueries()).toHaveLength(RECENT_QUERY_LIMIT);
    expect(loadRecentQueries()[0]).toBe("query 14");
  });

  it("keeps at most twenty picked entry ids", () => {
    for (let index = 0; index < 30; index += 1) recordPickedEntry(`entry.${index}`);
    expect(loadPickedEntryIds()).toHaveLength(PICKED_ENTRY_LIMIT);
    expect(loadPickedEntryIds()[0]).toBe("entry.29");
  });

  it("survives an unreadable stored value rather than throwing", () => {
    localStorage.setItem(SEARCH_RECENT_KEY, "{not json");
    expect(loadRecentQueries()).toEqual([]);
  });

  it("ignores a stored value that is not a list of strings", () => {
    localStorage.setItem(SEARCH_PICKED_KEY, JSON.stringify([1, "keep", null]));
    expect(loadPickedEntryIds()).toEqual(["keep"]);
  });

  it("clears both lists", () => {
    recordRecentQuery("radio");
    recordPickedEntry("action.sid-radio");
    clearSearchHistory();
    expect(loadRecentQueries()).toEqual([]);
    expect(loadPickedEntryIds()).toEqual([]);
  });
});
