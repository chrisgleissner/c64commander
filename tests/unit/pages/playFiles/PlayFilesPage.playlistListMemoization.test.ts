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

/**
 * usePlaylistListItems memoizes the derived ActionListItem array on its
 * handler props' identities. PlayFilesPage re-renders every second during
 * playback (elapsedMs ticks), so any handler passed as a fresh inline arrow
 * defeats that memoization and rebuilds the full row list (with menu items,
 * perf-scope recording, and a smoke-benchmark snapshot) twice per render -
 * once for the preview list, once for the view-all list. See HARD9-032.
 *
 * This is a source-text contract test (not a full component render) because
 * PlayFilesPage has no render harness elsewhere in this suite; it locks the
 * two handlers that were previously inline arrows to their useCallback-wrapped
 * identities so a regression re-introducing an inline arrow here is caught.
 */
const testFilePath = fileURLToPath(import.meta.url);
const pagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

const sliceHookCalls = (hookName: string): string[] => {
  const calls: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = pageSource.indexOf(`${hookName}({`, searchFrom);
    if (start < 0) break;
    const end = pageSource.indexOf("});", start);
    expect(end, `expected ${hookName}({ ... }) call to terminate`).toBeGreaterThan(start);
    calls.push(pageSource.slice(start, end));
    searchFrom = end;
  }
  return calls;
};

describe("PlayFilesPage playlist list memoization wiring", () => {
  it("defines onAttachLocalConfig/onOpenConfig as stable useCallback-wrapped handlers", () => {
    expect(pageSource).toMatch(/const handleAttachLocalConfigVoid = useCallback\(/);
    expect(pageSource).toMatch(/const handleOpenConfig = useCallback\(/);
  });

  it("passes both usePlaylistListItems calls the stable handlers, not fresh inline arrows", () => {
    const calls = sliceHookCalls("usePlaylistListItems");
    expect(calls, "expected both the preview and view-all usePlaylistListItems calls").toHaveLength(2);

    for (const call of calls) {
      expect(call).toContain("onAttachLocalConfig: handleAttachLocalConfigVoid,");
      expect(call).toContain("onOpenConfig: handleOpenConfig,");
      // The regression: an inline arrow recreated every render.
      expect(call).not.toMatch(/onAttachLocalConfig:\s*\(item\)\s*=>/);
      expect(call).not.toMatch(/onOpenConfig:\s*\(item\)\s*=>/);
    }
  });
});
