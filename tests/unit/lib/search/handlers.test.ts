/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { REFERENCED_SEARCH_HANDLER_IDS, STATIC_SEARCH_ENTRIES } from "@/generated/searchIndex";
import { SEARCH_HANDLERS, resolveSearchHandler } from "@/lib/search/handlers";

/**
 * The contract between the generated index and the handler map, held from both ends. A generated
 * module cannot hold a closure, so an action entry names an id; without these two tests an id can
 * be renamed on either side and the failure only shows up as a search result that does nothing.
 */
describe("search handler map", () => {
  const referenced = STATIC_SEARCH_ENTRIES.filter((entry) => entry.target.kind === "action").map((entry) =>
    entry.target.kind === "action" ? entry.target.handlerId : "",
  );

  it("agrees with the handler ids the compiler collected", () => {
    expect([...new Set(referenced)].sort()).toEqual([...REFERENCED_SEARCH_HANDLER_IDS].sort());
  });

  it.each([...new Set(referenced)])("resolves the handler named by an entry: %s", (handlerId) => {
    expect(resolveSearchHandler(handlerId)).toBeTypeOf("function");
  });

  it("has no handler that no entry names", () => {
    expect(Object.keys(SEARCH_HANDLERS).sort()).toEqual([...new Set(referenced)].sort());
  });

  it("returns null for an id that is not in the map", () => {
    expect(resolveSearchHandler("notAHandler")).toBeNull();
  });
});
