/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ItemSelectionDialog, type SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import type { SourceNavigatorState } from "@/lib/sourceNavigation/useSourceNavigator";

/**
 * The reach of the search box in the add-items sheet.
 *
 * It filtered the folder on screen, and only that. In HVSC — sixty thousand files arranged by
 * composer — that means a query can only find what was already visible, which is the one situation
 * in which nobody needs to search. The sheet now says how far the text reaches and lets it be
 * changed, for any source that can answer a whole-source search.
 */

const navigatorState = {
  path: "/music",
  entries: [] as SourceNavigatorState["entries"],
  isLoading: false,
  showLoadingIndicator: false,
  error: null,
  query: "",
  setQuery: vi.fn(),
  hasMore: false,
  loadMore: vi.fn(),
  totalCount: 0,
  isQueryBacked: true,
  canSearchSource: true,
  searchIsInstant: true,
  searchScope: "folder" as SourceNavigatorState["searchScope"],
  setSearchScope: vi.fn(),
  isSearching: false,
  runSourceSearch: vi.fn(),
  clearSearch: vi.fn(),
  navigateTo: vi.fn(),
  navigateUp: vi.fn(),
  navigateRoot: vi.fn(),
  refresh: vi.fn(),
} satisfies SourceNavigatorState;

vi.mock("@/lib/sourceNavigation/useSourceNavigator", () => ({
  useSourceNavigator: () => navigatorState,
}));

const sourceGroups: SourceGroup[] = [
  {
    label: "HVSC",
    sources: [
      {
        id: "hvsc-library",
        type: "hvsc",
        name: "HVSC",
        rootPath: "/",
        isAvailable: true,
        listEntries: async () => [],
        listFilesRecursive: async () => [],
      },
    ],
  },
];

const renderedTree = () => (
  <DisplayProfileProvider>
    <ItemSelectionDialog
      open
      onOpenChange={vi.fn()}
      title="Add items"
      confirmLabel="Add"
      initialSourceId="hvsc-library"
      sourceGroups={sourceGroups}
      onAddLocalSource={async () => null}
      onConfirm={async () => true}
    />
  </DisplayProfileProvider>
);

const renderSheet = () => render(renderedTree());

describe("ItemSelectionDialog search scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    navigatorState.query = "";
    navigatorState.searchScope = "folder";
    navigatorState.path = "/music";
    navigatorState.isQueryBacked = true;
    navigatorState.isSearching = false;
    navigatorState.searchIsInstant = true;
    navigatorState.canSearchSource = true;
    navigatorState.entries = [];
    navigatorState.totalCount = 0;
  });

  it("offers to search the whole source, not just the folder on screen", () => {
    renderSheet();

    expect(screen.getByTestId("add-items-scope-folder")).toBeTruthy();
    expect(screen.getByTestId("add-items-scope-source")).toBeTruthy();
  });

  it("widens the search when the whole source is chosen", () => {
    renderSheet();

    fireEvent.click(screen.getByTestId("add-items-scope-source"));

    expect(navigatorState.setSearchScope).toHaveBeenCalledWith("source");
  });

  it("hides the scope control for a source that can only be browsed", () => {
    navigatorState.canSearchSource = false;
    renderSheet();

    expect(screen.queryByTestId("add-items-search-scope")).toBeNull();
  });

  it("gives a source that has to be walked an explicit scan action", () => {
    navigatorState.searchIsInstant = false;
    navigatorState.searchScope = "source";
    navigatorState.query = "commando";
    renderSheet();

    expect(screen.getByTestId("add-items-deep-scan")).toBeTruthy();
  });

  it("does not offer a scan button for an indexed source, which answers on its own", () => {
    navigatorState.searchScope = "source";
    renderSheet();

    expect(screen.queryByTestId("add-items-deep-scan")).toBeNull();
  });

  it("shows how many results a search found", () => {
    navigatorState.searchScope = "source";
    navigatorState.isSearching = true;
    navigatorState.totalCount = 42;
    renderSheet();

    expect(screen.getByTestId("add-items-search-summary").textContent).toContain("42");
  });

  it("still filters the folder locally for a source that has no paged listing of its own", () => {
    // A source that can be deep-scanned but pages nothing (a phone folder, the Ultimate's card)
    // routes its text through the navigator so the scope control can widen it — but in folder scope
    // the navigator has no listing call to apply it, so the filtering still has to happen here.
    navigatorState.isQueryBacked = false;
    navigatorState.query = "beta";
    navigatorState.entries = [
      { type: "file", name: "Alpha.sid", path: "/music/Alpha.sid" },
      { type: "file", name: "Beta.sid", path: "/music/Beta.sid" },
    ];
    renderSheet();

    const rows = screen.getAllByTestId("source-entry-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Beta.sid");
    navigatorState.isQueryBacked = true;
    navigatorState.query = "";
  });

  it("shows where a result lives, because the list spans the whole source", () => {
    navigatorState.searchScope = "source";
    navigatorState.isSearching = true;
    navigatorState.entries = [
      {
        type: "file",
        name: "Commando",
        path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
        subtitle: "Rob Hubbard",
        detail: "/MUSICIANS/H/Hubbard_Rob",
      },
    ];
    renderSheet();

    expect(screen.getByTestId("source-entry-detail").textContent).toBe("/MUSICIANS/H/Hubbard_Rob");
  });

  /*
   * On the smallest screen the two scope buttons took a row of their own once text was typed, and
   * with the phone's system bars that left the file list 69 px on a Pixel 4 — less than one row.
   */
  describe("on the compact display profile", () => {
    beforeEach(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
      navigatorState.query = "games";
    });

    it("switches the reach with one button on the filter's own row", () => {
      renderSheet();

      const toggle = screen.getByTestId("add-items-scope-toggle");
      expect(toggle.parentElement).toBe(screen.getByTestId("add-items-filter").parentElement);
      expect(toggle).toHaveTextContent("This folder");
      expect(screen.queryByTestId("add-items-scope-folder")).toBeNull();
      expect(screen.queryByTestId("add-items-search-scope")).toBeNull();

      fireEvent.click(toggle);
      expect(navigatorState.setSearchScope).toHaveBeenCalledWith("source");
    });

    it("keeps the scan action for a source that has to be walked", () => {
      navigatorState.searchIsInstant = false;
      navigatorState.searchScope = "source";
      renderSheet();

      expect(screen.getByTestId("add-items-scope-toggle")).toHaveTextContent("Everywhere");
      fireEvent.click(screen.getByTestId("add-items-deep-scan"));
      expect(navigatorState.runSourceSearch).toHaveBeenCalledTimes(1);
    });

    // A visible "0 selected" line under the title cost the list a row on a 320 x 427 screen.
    it("counts the selection on the confirm button instead of a line under the title", () => {
      navigatorState.query = "";
      navigatorState.entries = [
        { type: "file", name: "a.prg", path: "/music/a.prg" },
        { type: "file", name: "b.prg", path: "/music/b.prg" },
      ] as SourceNavigatorState["entries"];
      renderSheet();

      const count = screen.getByTestId("add-items-selection-count");
      expect(count.className).toContain("sr-only");
      expect(screen.getByTestId("add-items-confirm")).toHaveTextContent(/^Add$/);

      fireEvent.click(screen.getByRole("checkbox", { name: "Select a.prg" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select b.prg" }));

      expect(screen.getByTestId("add-items-confirm")).toHaveTextContent(/^Add 2$/);
      expect(count).toHaveTextContent("2 selected");
    });

    it("shows no scope control before anything is typed", () => {
      navigatorState.query = "";
      renderSheet();

      expect(screen.queryByTestId("add-items-scope-toggle")).toBeNull();
    });
  });

  describe("a folder filter on a source that can only be browsed", () => {
    beforeEach(() => {
      navigatorState.canSearchSource = false;
      navigatorState.isQueryBacked = false;
      navigatorState.path = "/USB2/Games";
      navigatorState.entries = [
        { type: "dir", name: "_AD", path: "/USB2/Games/_AD" },
        { type: "dir", name: "6000Games", path: "/USB2/Games/6000Games" },
      ] as SourceNavigatorState["entries"];
    });

    // Every entry's path contains the folder it is in, so matching paths made "Games" match all of
    // /USB2/Games.
    it("matches entry names, not the folder they are in", () => {
      renderSheet();
      fireEvent.change(screen.getByTestId("add-items-filter"), { target: { value: "Games" } });

      const rows = screen.getAllByTestId("source-entry-row").map((row) => row.textContent);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("6000Games");
    });

    it("starts each new folder unfiltered", () => {
      const view = renderSheet();
      fireEvent.change(screen.getByTestId("add-items-filter"), { target: { value: "Games" } });
      expect(screen.getAllByTestId("source-entry-row")).toHaveLength(1);

      navigatorState.path = "/USB2/Games/_AD";
      view.rerender(renderedTree());

      expect(screen.getByTestId("add-items-filter")).toHaveValue("");
      expect(screen.getAllByTestId("source-entry-row")).toHaveLength(2);
    });
  });
});
