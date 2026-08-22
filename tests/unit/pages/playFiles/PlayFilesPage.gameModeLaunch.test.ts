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

// GM-18. `handleUserLaunchedItem` decides whether a launch goes straight into
// Game Mode, and `usePlaybackController` is the only thing that can tell it a
// launch happened. Between #336 and this test the handler was written, covered
// through `shouldEnterGameModeOnLaunch`, and never passed to the controller, so
// Settings -> Game Mode -> "on launch" had no effect for its whole shipped life.
// Every part of that chain was individually tested; only the connection was not.
describe("PlayFilesPage Game Mode launch wiring", () => {
  it("passes the launch handler to the playback controller", () => {
    expect(playFilesPageSource).toContain("onUserLaunchedItem: handleUserLaunchedItem,");
  });

  it("decides through shouldEnterGameModeOnLaunch and starts Game Mode", () => {
    expect(playFilesPageSource).toContain("const handleUserLaunchedItem = useCallback(");
    expect(playFilesPageSource).toContain("!shouldEnterGameModeOnLaunch({");
    expect(playFilesPageSource).toContain('origin: "user",');
    expect(playFilesPageSource).toContain("enabled: loadGameModeOnLaunch(),");
    expect(playFilesPageSource).toContain("void startGameMode();");
  });
});
