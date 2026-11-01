/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSearchResults } from "@/hooks/useSearchResults";
import { registerSearchEntries, resetSearchRegistryForTests } from "@/lib/search/registry";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { STATIC_SEARCH_ENTRIES } from "@/generated/searchIndex";
import { isSearchEntryShown } from "@/lib/appMode/searchVisibility";
import type { SearchEntry } from "@/lib/search/types";

const entry = (overrides: Partial<SearchEntry>): SearchEntry => ({
  id: "test.entry",
  titleKey: "t",
  titleDefault: "Test",
  group: "action",
  target: { kind: "action", handlerId: "x" },
  ...overrides,
});

describe("search in SID Player", () => {
  it("SPM-SRCH-01 SID Player hides device and capability entries", () => {
    expect(isSearchEntryShown(entry({ requires: [{ kind: "device" }] }), "sid-player")).toBe(false);
    expect(
      isSearchEntryShown(entry({ requires: [{ kind: "capability", capability: "supportsStreaming" }] }), "sid-player"),
    ).toBe(false);
    expect(isSearchEntryShown(entry({ requires: [{ kind: "telnet" }] }), "sid-player")).toBe(false);
    expect(isSearchEntryShown(entry({ requires: [{ kind: "flag", flag: "live_view_enabled" }] }), "sid-player")).toBe(
      false,
    );
  });

  it("SPM-SRCH-01 SID Player keeps entries that need only music, HVSC or a session", () => {
    expect(isSearchEntryShown(entry({ requires: [{ kind: "hvsc" }, { kind: "session" }] }), "sid-player")).toBe(true);
    expect(isSearchEntryShown(entry({ requires: [{ kind: "flag", flag: "hvsc_enabled" }] }), "sid-player")).toBe(true);
    expect(isSearchEntryShown(entry({}), "sid-player")).toBe(true);
  });

  it("SPM-SRCH-01 SID Player hides entries targeting Config, Disks and Home", () => {
    for (const path of ["/config", "/disks", "/"]) {
      expect(isSearchEntryShown(entry({ target: { kind: "route", path } }), "sid-player"), path).toBe(false);
    }
    expect(
      isSearchEntryShown(
        entry({ target: { kind: "configItem", category: "Audio Mixer", itemName: "Vol" } }),
        "sid-player",
      ),
    ).toBe(false);
    expect(
      isSearchEntryShown(
        entry({ target: { kind: "section", path: "/settings", scope: "settings", id: "connection" } }),
        "sid-player",
      ),
    ).toBe(false);
    expect(
      isSearchEntryShown(
        entry({
          target: { kind: "control", path: "/settings", scope: "settings", sectionId: "device-safety", testId: "x" },
        }),
        "sid-player",
      ),
    ).toBe(false);
    expect(isSearchEntryShown(entry({ target: { kind: "route", path: "/play" } }), "sid-player")).toBe(true);
  });

  it("SPM-SRCH-01 the Full App shows every entry", () => {
    for (const candidate of STATIC_SEARCH_ENTRIES) {
      expect(isSearchEntryShown(candidate, "full"), candidate.id).toBe(true);
    }
  });

  it("SPM-SRCH-01 no entry of the real index that SID Player shows needs a device or leads to a hidden page", () => {
    const shown = STATIC_SEARCH_ENTRIES.filter((candidate) => isSearchEntryShown(candidate, "sid-player"));
    expect(shown.length).toBeGreaterThan(5);
    for (const candidate of shown) {
      const kinds = (candidate.requires ?? []).map((requirement) => requirement.kind);
      expect(kinds, candidate.id).not.toEqual(expect.arrayContaining(["device"]));
      const target = candidate.target;
      if ("path" in target) expect(["/", "/disks", "/config"], candidate.id).not.toContain(target.path);
    }
    expect(shown.some((candidate) => candidate.id === "page.home")).toBe(false);
  });

  it("SPM-SRCH-01 the search results hook leaves out entries the mode hides", () => {
    resetSearchRegistryForTests();
    registerSearchEntries("test", [
      entry({ id: "t.disk", titleDefault: "Mount a disk", target: { kind: "route", path: "/disks" } }),
      entry({ id: "t.play", titleDefault: "Mount music", target: { kind: "route", path: "/play" } }),
    ]);
    const ctx = {
      deviceConnected: false,
      capabilities: {},
      telnetAvailable: false,
      flagValue: () => true,
      variantId: "x",
      hvscReady: true,
      hasRestorableSession: false,
    } as never;
    saveStartupModeByUser("sid-player");
    try {
      const { result } = renderHook(() => useSearchResults("mount", ctx));
      const ids = result.current.results.map((scored) => scored.resolved.entry.id);
      expect(ids).toContain("t.play");
      expect(ids).not.toContain("t.disk");
    } finally {
      saveStartupModeByUser("default");
      resetSearchRegistryForTests();
    }
  });
});
