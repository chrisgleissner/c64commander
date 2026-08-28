/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const connectionRef = vi.hoisted(() => ({
  current: { isConnected: false, deviceInfo: null as Record<string, string> | null },
}));
vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: connectionRef.current }),
  // Tier 2 scopes cached config categories to the epoch they were fetched under, so the previous
  // device's items are not offered after a handover.
  useConnectionRoutingEpoch: () => 0,
}));

const flagsRef = vi.hoisted(() => ({ current: {} as Record<string, boolean> }));
vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: flagsRef.current }),
  useFeatureFlag: (id: string) => ({ value: flagsRef.current[id] ?? true }),
  useFeatureFlagValue: (id: string) => flagsRef.current[id] ?? true,
}));

vi.mock("@/hooks/useTelnetActions", () => ({
  useTelnetActions: () => ({ isAvailable: false, getActionSupport: () => ({ status: "unsupported" }) }),
}));

const hvscRef = vi.hoisted(() => ({
  current: { hits: [] as Array<Record<string, unknown>>, isSearching: false, indexUnavailable: false },
}));
vi.mock("@/pages/playFiles/hooks/useHvscArchiveSearch", () => ({
  useHvscArchiveSearch: () => ({
    query: "",
    setQuery: vi.fn(),
    hits: hvscRef.current.hits,
    totalCount: hvscRef.current.hits.length,
    isSearching: hvscRef.current.isSearching,
    hasSearched: true,
    indexUnavailable: hvscRef.current.indexUnavailable,
    clear: vi.fn(),
  }),
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastSpy, useToast: () => ({ toast: toastSpy }) }));

import { SearchOverlayHost } from "@/components/search/SearchOverlayHost";
import { SKIP_ATTR } from "@/lib/input";
import { requestSearchOpen } from "@/lib/search/overlayState";
import { SEARCH_RECENT_KEY } from "@/lib/search/history";

/*
 * Rendered through the HOST, not the overlay directly. The host is what App mounts, and it loads
 * the overlay lazily so its archive, disk-store and config-cache reach never lands in the index
 * bundle — testing the overlay alone would leave that wiring unproven.
 */
const renderOverlay = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SearchOverlayHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const open = async () => {
  await act(async () => {
    requestSearchOpen({ source: "key" });
    // The overlay is behind React.lazy, so let its chunk resolve before anything asserts on it.
    await Promise.resolve();
  });
  // The first open in the file pays for resolving that chunk, which on a loaded runner takes
  // longer than the one-second default. Only the first two tests ever failed on it.
  await screen.findByTestId("search-overlay", {}, { timeout: 15_000 });
};

const type = (value: string) => {
  fireEvent.change(screen.getByTestId("search-input"), { target: { value } });
};

describe("SearchOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
    connectionRef.current = { isConnected: false, deviceInfo: null };
    flagsRef.current = {};
    hvscRef.current = { hits: [], isSearching: false, indexUnavailable: false };
    toastSpy.mockClear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is not on screen until a door asks for it", () => {
    renderOverlay();
    expect(screen.queryByTestId("search-overlay")).toBeNull();
  });

  it("opens on a request from any door", async () => {
    renderOverlay();
    await open();
    await waitFor(() => expect(screen.getByTestId("search-overlay")).toBeInTheDocument());
  });

  it("is a dialog whose result list the discovery engine skips", async () => {
    renderOverlay();
    await open();
    const overlay = screen.getByTestId("search-overlay");
    expect(overlay).toHaveAttribute("role", "dialog");
    expect(overlay).toHaveAttribute(SKIP_ATTR);
    expect(screen.getByTestId("search-results")).toHaveAttribute(SKIP_ATTR);
  });

  it("presents the field as a combobox over a listbox", async () => {
    renderOverlay();
    await open();
    const input = screen.getByTestId("search-input");
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-controls", "search-results-listbox");
    expect(screen.getByTestId("search-results")).toHaveAttribute("role", "listbox");
  });

  describe("keyboard model", () => {
    /*
     * The point of section 5.7. The focus ring moves real DOM focus through tabbables on Down
     * inside a dialog, which would take the user out of the field on the first press and stop them
     * typing. Down here moves aria-activedescendant and nothing else.
     */
    it("does not move DOM focus out of the field on Down", async () => {
      renderOverlay();
      await open();
      const input = screen.getByTestId("search-input");
      await waitFor(() => expect(document.activeElement).toBe(input));
      type("radio");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
      expect(document.activeElement).toBe(input);
    });

    it("advances aria-activedescendant on Down and returns it on Up", async () => {
      renderOverlay();
      await open();
      const input = screen.getByTestId("search-input");
      type("radio");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));

      const first = input.getAttribute("aria-activedescendant");
      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
      const second = input.getAttribute("aria-activedescendant");
      expect(second).not.toBe(first);
      expect(second).toBeTruthy();

      fireEvent.keyDown(input, { key: "ArrowUp", code: "ArrowUp" });
      expect(input.getAttribute("aria-activedescendant")).toBe(first);
    });

    it("marks exactly one row selected, and it is the one aria-activedescendant names", async () => {
      renderOverlay();
      await open();
      const input = screen.getByTestId("search-input");
      type("radio");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });

      const selected = screen.getAllByRole("option").filter((row) => row.getAttribute("aria-selected") === "true");
      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe(input.getAttribute("aria-activedescendant"));
    });

    it("closes on Escape", async () => {
      renderOverlay();
      await open();
      fireEvent.keyDown(screen.getByTestId("search-input"), { key: "Escape", code: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull());
    });

    it("closes on the close button", async () => {
      renderOverlay();
      await open();
      fireEvent.click(screen.getByTestId("search-close"));
      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull());
    });
  });

  describe("results", () => {
    it("shows the promoted chips and no results on an empty query", async () => {
      renderOverlay();
      await open();
      expect(screen.getByTestId("search-promoted")).toBeInTheDocument();
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    });

    it("shows recent searches on an empty query once there are some", async () => {
      localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(["radio"]));
      renderOverlay();
      await open();
      expect(within(screen.getByTestId("search-recent")).getByText("radio")).toBeInTheDocument();
    });

    it("names what was searched for when nothing matches, and offers the nearest group", async () => {
      renderOverlay();
      await open();
      type("zzzznotathing");
      await waitFor(() => expect(screen.getByTestId("search-empty")).toBeInTheDocument());
      expect(screen.getByTestId("search-empty").textContent).toContain("zzzznotathing");
      expect(screen.getByTestId("search-empty-play")).toBeInTheDocument();
    });

    it("lists an entry whose requirements are unmet, disabled, with the reason", async () => {
      // The flag is on, so the FIRST unmet requirement is the connection — which is the reason a
      // user with a working install and no machine attached actually reads.
      flagsRef.current = { live_view_enabled: true };
      renderOverlay();
      await open();
      type("live view");
      await waitFor(() => expect(screen.getByTestId("search-result-home.section.live-view")).toBeInTheDocument());
      const row = screen.getByTestId("search-result-home.section.live-view");
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row.textContent).toContain("Needs a connected C64 Ultimate");
    });

    it("names the switch when a row is gated on one that is off", async () => {
      flagsRef.current = { live_view_enabled: false };
      renderOverlay();
      await open();
      type("live view");
      await waitFor(() => expect(screen.getByTestId("search-result-home.section.live-view")).toBeInTheDocument());
      expect(screen.getByTestId("search-result-home.section.live-view").textContent).toContain(
        "turned off in Settings",
      );
    });

    it("puts the group holding the best match first, not a fixed group order", async () => {
      renderOverlay();
      await open();
      type("settings");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
      // "Settings" is an exact title match in Pages; "Config actions" only matches in its subtitle.
      expect(screen.getAllByRole("option")[0]).toHaveAttribute("data-testid", "search-result-page.settings");
    });

    it("folds the group name into each option's accessible name, and hides the header from it", async () => {
      renderOverlay();
      await open();
      type("settings");
      await waitFor(() => expect(screen.getByTestId("search-result-page.settings")).toBeInTheDocument());
      expect(screen.getByTestId("search-result-page.settings").getAttribute("aria-label")).toContain("Pages:");
    });

    it("every row meets the 44 px floor", async () => {
      renderOverlay();
      await open();
      type("s");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
      for (const row of screen.getAllByRole("option")) {
        expect(row.className).toContain("min-h-11");
      }
    });

    const rowsInGroup = (label: string) =>
      screen.getAllByRole("option").filter((row) => row.getAttribute("aria-label")?.startsWith(`${label}:`));

    it("caps a group at five rows and offers to expand it", async () => {
      renderOverlay();
      await open();
      type("s");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

      // The cap itself, asserted rather than assumed: the earlier version of this test wrapped the
      // expansion in `if (more)` and finished by checking the count was above zero, so raising
      // ROWS_PER_GROUP to fifty left it green.
      const more = screen.getByTestId("search-more-setting");
      expect(rowsInGroup("Settings")).toHaveLength(5);

      fireEvent.click(more);

      await waitFor(() => expect(rowsInGroup("Settings").length).toBeGreaterThan(5));
    });

    it("expands one group for one query, and caps it again on the next", async () => {
      renderOverlay();
      await open();
      type("s");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
      fireEvent.click(screen.getByTestId("search-more-setting"));
      await waitFor(() => expect(rowsInGroup("Settings").length).toBeGreaterThan(5));

      type("se");

      await waitFor(() => expect(screen.getByTestId("search-more-setting")).toBeInTheDocument());
      expect(rowsInGroup("Settings")).toHaveLength(5);
    });

    it("shows a spinner on the music group while the archive scan is running", async () => {
      hvscRef.current = { hits: [], isSearching: true, indexUnavailable: false };
      renderOverlay();
      await open();
      type("radio");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

      // The heading and its spinner while the scan runs, with no hit yet. Before, the music group
      // existed only once a hit landed, so the one thing the spinner is there to say was never on
      // screen during the wait it describes.
      expect(screen.getByTestId("search-music-spinner")).toBeInTheDocument();
      // "Nothing matches" would be a lie while the archive is still being read.
      expect(screen.queryByTestId("search-empty")).toBeNull();
    });
  });

  describe("activating a result", () => {
    it("records the query and the entry, then closes", async () => {
      renderOverlay();
      await open();
      type("settings");
      await waitFor(() => expect(screen.getByTestId("search-result-page.settings")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("search-result-page.settings"));

      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull());
      expect(JSON.parse(localStorage.getItem("c64u_search_recent:v1") ?? "[]")).toEqual(["settings"]);
      expect(JSON.parse(localStorage.getItem("c64u_search_picked:v1") ?? "[]")).toEqual(["page.settings"]);
    });

    it("never records a query that was abandoned without activating anything", async () => {
      renderOverlay();
      await open();
      type("settings");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
      fireEvent.keyDown(screen.getByTestId("search-input"), { key: "Escape", code: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull());
      expect(localStorage.getItem("c64u_search_recent:v1")).toBeNull();
    });

    it("activates the row aria-activedescendant names, not the first one drawn", async () => {
      renderOverlay();
      await open();
      const input = screen.getByTestId("search-input");
      type("settings");
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });

      const activeId = input.getAttribute("aria-activedescendant");
      const activeRow = screen.getAllByRole("option").find((row) => row.id === activeId);
      const expectedEntryId = activeRow?.getAttribute("data-testid")?.replace("search-result-", "");
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("c64u_search_picked:v1") ?? "[]")).toEqual([expectedEntryId]),
      );
    });

    it("stays open and toasts when the target never appears, rather than failing silently", async () => {
      renderOverlay();
      await open();
      // A Home section, with no Home page rendered: the resolver waits out its ceiling.
      type("config actions");
      await waitFor(() => expect(screen.getByTestId("search-result-home.section.config-actions")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("search-result-home.section.config-actions"));
      await waitFor(
        () =>
          expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ title: expect.stringContaining("Could not reach") }),
          ),
        { timeout: 4000 },
      );
    }, 10_000);

    it("takes a disabled row to the setting that would enable it", async () => {
      renderOverlay();
      await open();
      type("live view");
      await waitFor(() => expect(screen.getByTestId("search-result-home.section.live-view")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("search-result-home.section.live-view"));
      // The remedy is the Connection settings section; the overlay closes on its way there.
      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull(), { timeout: 4000 });
    });
  });

  /*
   * The overlay carries data-key-nav-skip, so the app's focus ring stays out of it and the arrow
   * keys are the only way around on a keypad. They used to cycle the result rows alone, which left
   * the promoted chips, the recent searches and each "More in ..." button reachable by pointer
   * only — in a keypad-first app that is the same as not being there.
   */
  describe("what the arrow keys can reach", () => {
    it("cycles the promoted chips when nothing has been typed", async () => {
      renderOverlay();
      await open();

      const field = screen.getByTestId("search-input");
      fireEvent.keyDown(field, { key: "ArrowDown", code: "ArrowDown" });

      const chips = screen.getAllByTestId(/^search-chip-/);
      expect(chips.length).toBeGreaterThan(1);
      await waitFor(() => expect(field).toHaveAttribute("aria-activedescendant", chips[1].id));
      expect(chips[1].id).not.toBe("");
    });

    it("activates the chip the arrow keys landed on, not the first one drawn", async () => {
      renderOverlay();
      await open();

      const field = screen.getByTestId("search-input");
      const chips = screen.getAllByTestId(/^search-chip-/);
      expect(chips.length).toBeGreaterThan(1);

      /*
       * Moved before activating, and the recorded pick names WHICH chip ran. The earlier version
       * pressed Enter without an arrow key and asserted only that a chip existed, so it could not
       * tell the second chip from the first — or from none of them.
       *
       * The target is the last chip that is enabled here: activating a disabled one navigates to
       * the switch that would enable it and records nothing, which would prove neither thing.
       */
      const target = chips.map((chip, index) => ({ chip, index })).filter(({ chip }) => !chip.hasAttribute("disabled"));
      const last = target[target.length - 1];
      expect(last.index).toBeGreaterThan(0);
      for (let step = 0; step < last.index; step += 1) {
        fireEvent.keyDown(field, { key: "ArrowDown", code: "ArrowDown" });
      }
      await waitFor(() => expect(field).toHaveAttribute("aria-activedescendant", last.chip.id));
      const expectedEntryId = last.chip.getAttribute("data-testid")?.replace("search-chip-", "");

      fireEvent.keyDown(field, { key: "Enter", code: "Enter" });

      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("c64u_search_picked:v1") ?? "[]")).toEqual([expectedEntryId]),
      );
    });
  });

  /*
   * A keypad handset's D-pad emits `code: "DpadDown"`, never `key: "ArrowDown"`. A handler that
   * compares key names is inert on exactly the hardware that has no pointer to fall back on, and
   * the overlay opts out of the focus ring, so these keys are the only way around it there.
   */
  describe("a keypad D-pad", () => {
    it("moves the selection and activates, the same as an arrow key", async () => {
      renderOverlay();
      await open();
      const field = screen.getByTestId("search-input");

      fireEvent.keyDown(field, { key: "Unidentified", code: "DpadDown" });

      const chips = screen.getAllByTestId(/^search-chip-/);
      await waitFor(() => expect(field).toHaveAttribute("aria-activedescendant", chips[1].id));

      // Back to the first chip, which is always enabled, then activate it.
      fireEvent.keyDown(field, { key: "Unidentified", code: "DpadUp" });
      await waitFor(() => expect(field).toHaveAttribute("aria-activedescendant", chips[0].id));

      fireEvent.keyDown(field, { key: "Unidentified", code: "DpadCenter" });
      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull());
    });

    it("closes on the Back key", async () => {
      renderOverlay();
      await open();

      fireEvent.keyDown(screen.getByTestId("search-input"), { key: "Unidentified", code: "Backspace", keyCode: 4 });

      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull());
    });

    /*
     * The handset's hardware Back arrives as {key:"Escape", code:"", keyCode:0} and matches no
     * keymap binding at all — spec.md 9.3 forbids binding keyCode 0, which would swallow every
     * event reporting no code. Reading keys through the keymap alone therefore left the one key a
     * keypad-only user has for "go back" unable to close the overlay.
     */
    it("closes on the device Back button, which no binding can express", async () => {
      renderOverlay();
      await open();

      fireEvent.keyDown(screen.getByTestId("search-input"), { key: "Escape", code: "", keyCode: 0 });

      await waitFor(() => expect(screen.queryByTestId("search-overlay")).toBeNull());
    });
  });
});
