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

const renderSheet = () =>
  render(
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
    </DisplayProfileProvider>,
  );

describe("ItemSelectionDialog search scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigatorState.searchScope = "folder";
    navigatorState.isSearching = false;
    navigatorState.searchIsInstant = true;
    navigatorState.canSearchSource = true;
    navigatorState.entries = [];
    navigatorState.totalCount = 0;
    navigatorState.query = "";
  });

  it("offers to search the whole source, not just the folder on screen", () => {
    navigatorState.query = "commando";
    renderSheet();

    expect(screen.getByTestId("add-items-scope-folder")).toBeTruthy();
    expect(screen.getByTestId("add-items-scope-source")).toBeTruthy();
  });

  it("widens the search when the whole source is chosen", () => {
    navigatorState.query = "commando";
    renderSheet();

    fireEvent.click(screen.getByTestId("add-items-scope-source"));

    expect(navigatorState.setSearchScope).toHaveBeenCalledWith("source");
  });

  /*
   * On the compact profile the scope row costs a row of the file list, and until there is
   * something typed it answers a question the user has not asked. It appears with the text.
   * Only there: on a wider screen the row costs nothing worth saving, so it stays put.
   */
  it("holds the scope control back until there is something to scope, on the compact profile", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 320 });
    try {
      navigatorState.query = "";
      renderSheet();

      expect(screen.queryByTestId("add-items-search-scope")).toBeNull();

      fireEvent.change(screen.getByTestId("add-items-filter"), { target: { value: "commando" } });

      expect(navigatorState.setQuery).toHaveBeenCalledWith("commando");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: original });
    }
  });

  it("keeps the scope control in view on a wider screen, where the row costs nothing", () => {
    navigatorState.query = "";
    renderSheet();

    expect(screen.getByTestId("add-items-search-scope")).toBeTruthy();
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
    navigatorState.query = "commando";
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
});
