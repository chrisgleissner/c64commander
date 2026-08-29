/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildRecentPlaylistItem } from "@/pages/playFiles/insertTuneNext";

describe("buildRecentPlaylistItem", () => {
  // A row written before the source was recorded is an archive tune, which is what every one of
  // them was: nothing else was ever written to Recent.
  it("treats a row with no recorded source as an archive tune", () => {
    const item = buildRecentPlaylistItem({ virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", title: "Commando" });

    expect(item.request.source).toBe("hvsc");
    expect(item.category).toBe("sid");
  });

  it("rebuilds a local disk from its source kind and id", () => {
    const item = buildRecentPlaylistItem({
      virtualPath: "/Games/Elite.d64",
      title: "Elite",
      category: "disk",
      source: "local",
      sourceId: "local-source-2",
    });

    expect(item.request.source).toBe("local");
    expect(item.request.path).toBe("/Games/Elite.d64");
    expect(item.category).toBe("disk");
    expect(item.sourceId).toBe("local-source-2");
  });

  it("rebuilds a program as a prg", () => {
    const item = buildRecentPlaylistItem({
      virtualPath: "/Usb0/tool.prg",
      title: "Tool",
      category: "program",
      source: "ultimate",
    });

    expect(item.category).toBe("prg");
    expect(item.request.source).toBe("ultimate");
  });
});
