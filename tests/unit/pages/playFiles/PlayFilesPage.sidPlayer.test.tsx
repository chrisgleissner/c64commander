/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

const page = vi.hoisted(() => ({
  flags: { hvsc_enabled: true, commoserve_enabled: true } as Record<string, boolean>,
  shortcutsEmpty: [] as boolean[],
  groups: null as null | Array<{ sources: Array<{ type: string }> }>,
  filterEntry: null as null | ((entry: { type: string; path: string }) => boolean),
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: page.flags, resolved: {}, isLoaded: true }),
  useFeatureFlag: (id: string) => ({ value: page.flags[id] ?? false, isLoaded: true }),
  useFeatureFlagValue: (id: string) => page.flags[id] ?? false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: (props: {
    title: string;
    sourceGroups: typeof page.groups;
    filterEntry: typeof page.filterEntry;
  }) => {
    if (props.title === "Add items") {
      page.groups = props.sourceGroups;
      page.filterEntry = props.filterEntry;
    }
    return null;
  },
}));

vi.mock("@/pages/playFiles/components/PlayListeningShortcuts", () => ({
  PlayListeningShortcuts: (props: { playlistEmpty: boolean }) => {
    page.shortcutsEmpty.push(props.playlistEmpty);
    return null;
  },
}));

import PlayFilesPage from "@/pages/PlayFilesPage";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/play"]}>
        <PlayFilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("PlayFilesPage in SID Player", () => {
  beforeEach(() => {
    page.shortcutsEmpty = [];
    page.groups = null;
    page.filterEntry = null;
    localStorage.clear();
    saveStartupModeByUser("sid-player");
  });
  afterEach(() => saveStartupModeByUser("default"));

  it("SPM-START-01 the Start listening area waits for the playlist to be restored", async () => {
    renderPage();
    await waitFor(() => expect(page.shortcutsEmpty.at(-1)).toBe(true));

    expect(page.shortcutsEmpty[0]).toBe(false);
  });

  it("SPM-PLAY-01 Add items lists no C64U source and keeps HVSC and CommoServe", async () => {
    renderPage();
    await waitFor(() => expect(page.groups).not.toBeNull());

    const types = page.groups!.flatMap((group) => group.sources.map((source) => source.type));
    expect(types).not.toContain("ultimate");
    expect(types).toEqual(expect.arrayContaining(["hvsc", "commoserve"]));
  });

  it("SPM-PLAY-01 the Full App still lists the C64U source", async () => {
    saveStartupModeByUser("default");
    renderPage();
    await waitFor(() => expect(page.groups).not.toBeNull());

    expect(page.groups!.flatMap((group) => group.sources.map((source) => source.type))).toContain("ultimate");
  });

  it("SPM-PLAY-02 Add items shows folders and SID files only", async () => {
    renderPage();
    await waitFor(() => expect(page.filterEntry).toBeTypeOf("function"));

    expect(page.filterEntry!({ type: "dir", path: "/Music" })).toBe(true);
    expect(page.filterEntry!({ type: "file", path: "/Music/a.sid" })).toBe(true);
    expect(page.filterEntry!({ type: "file", path: "/Music/a.prg" })).toBe(false);
    expect(page.filterEntry!({ type: "file", path: "/Music/a.d64" })).toBe(false);
  });
});
