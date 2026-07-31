/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

import { createDeepScanSearch, matchesAllTokens, rankSearchMatches } from "@/lib/sourceNavigation/deepScanSearch";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

const file = (path: string, name = path.split("/").pop()!): SourceEntry => ({ type: "file", name, path });

describe("deep scan search", () => {
  it("matches every token, anywhere in the name or the path", () => {
    const entry = file("/GAMES/Hubbard/Commando.sid");
    expect(matchesAllTokens(entry, ["hubbard", "commando"])).toBe(true);
    expect(matchesAllTokens(entry, ["hubbard", "wizball"])).toBe(false);
  });

  it("ranks a name match above a path-only match", () => {
    const page = rankSearchMatches([file("/Hubbard/Something_Else.sid"), file("/Other/Commando.sid")], "commando");

    expect(page.entries.map((entry) => entry.path)).toEqual(["/Other/Commando.sid"]);
  });

  it("ranks a name that starts with the token above one that merely contains it", () => {
    const page = rankSearchMatches([file("/A/Super_Commando.sid"), file("/B/Commando.sid")], "commando");

    expect(page.entries.map((entry) => entry.name)).toEqual(["Commando.sid", "Super_Commando.sid"]);
  });

  it("says which folder each result came from", () => {
    const page = rankSearchMatches([file("/GAMES/Hubbard/Commando.sid")], "commando");

    expect(page.entries[0]?.detail).toBe("/GAMES/Hubbard");
  });

  it("never returns folders — a search result is a file you can add", () => {
    const page = rankSearchMatches(
      [{ type: "dir", name: "Commando", path: "/GAMES/Commando" }, file("/GAMES/Commando/x.sid", "Commando.sid")],
      "commando",
    );

    expect(page.entries.every((entry) => entry.type === "file")).toBe(true);
  });

  it("pages, reporting the total behind the page", () => {
    const entries = Array.from({ length: 5 }, (_, index) => file(`/A/Commando_${index}.sid`));
    const page = rankSearchMatches(entries, "commando", { offset: 0, limit: 2 });

    expect(page.entries).toHaveLength(2);
    expect(page.totalCount).toBe(5);
    expect(page.nextOffset).toBe(2);

    const last = rankSearchMatches(entries, "commando", { offset: 4, limit: 2 });
    expect(last.nextOffset).toBeNull();
  });

  it("does not walk the source at all for an empty query", () => {
    // The walk is the expensive part — seconds to minutes on an FTP card. An empty query must never
    // start one.
    const walk = vi.fn(async () => []);
    const search = createDeepScanSearch(walk);

    return search({ query: "   " }).then((page) => {
      expect(walk).not.toHaveBeenCalled();
      expect(page).toEqual({ entries: [], totalCount: 0, nextOffset: null });
    });
  });

  it("walks from the requested subtree, and passes the abort signal through", async () => {
    const walk = vi.fn(async () => [file("/DEMOS/Commando.sid")]);
    const search = createDeepScanSearch(walk, "/");
    const controller = new AbortController();

    const page = await search({ query: "commando", path: "/DEMOS", signal: controller.signal });

    expect(walk).toHaveBeenCalledWith("/DEMOS", { signal: controller.signal });
    expect(page.entries).toHaveLength(1);
  });

  it("walks from the source root when no subtree is given", async () => {
    const walk = vi.fn(async () => []);
    const search = createDeepScanSearch(walk, "/ROOT");

    await search({ query: "commando" });

    expect(walk).toHaveBeenCalledWith("/ROOT", { signal: undefined });
  });
});
