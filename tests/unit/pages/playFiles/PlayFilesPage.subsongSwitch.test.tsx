/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const playFilesPagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const playFilesPageSource = readFileSync(playFilesPagePath, "utf8");

describe("PlayFilesPage subsong switch (HARD12-001)", () => {
  it("does not overwrite playItem's re-resolved playlist entry after the subsong launch resolves", () => {
    const handlerStart = playFilesPageSource.indexOf("const handleSongSelection = useCallback(");
    const handlerEnd = playFilesPageSource.indexOf("useEffect(() => {", handlerStart);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);

    const handlerSource = playFilesPageSource.slice(handlerStart, handlerEnd);
    expect(handlerSource).toContain("await playItem(nextItem, { playlistIndex: currentIndex });");
    expect(handlerSource).not.toContain(
      "setPlaylist((prev) => prev.map((item, index) => (index === currentIndex ? nextItem : item)))",
    );
  });
});
