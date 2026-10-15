import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { DisplayProfileProvider, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { PlaylistPanel } from "@/pages/playFiles/components/PlaylistPanel";
import type { ActionListItem } from "@/components/lists/SelectableActionList";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";

vi.mock("@/components/lists/SelectableActionList", () => ({
  SelectableActionList: ({
    filterHeader,
    filterHeaderSummary,
    collapsibleFilterProfiles,
    removeSelectedLabel,
    headerActions,
    hiddenItemCount,
    emptyLabel,
  }: {
    filterHeader: React.ReactNode;
    filterHeaderSummary?: string | null;
    collapsibleFilterProfiles?: readonly string[];
    removeSelectedLabel?: string;
    headerActions?: React.ReactNode;
    hiddenItemCount?: number;
    emptyLabel: string;
  }) => (
    <div>
      <div data-testid="playlist-empty-label">{emptyLabel}</div>
      <div data-testid="playlist-hidden-item-count">{hiddenItemCount}</div>
      <div data-testid="playlist-filter-header">{filterHeader}</div>
      <div data-testid="playlist-filter-summary">{filterHeaderSummary ?? "none"}</div>
      <div data-testid="playlist-collapsible-profiles">{collapsibleFilterProfiles?.join(",")}</div>
      <div data-testid="playlist-remove-selected-label">{removeSelectedLabel}</div>
      <div data-testid="playlist-header-actions">{headerActions}</div>
    </div>
  ),
}));

const items: ActionListItem[] = [
  {
    id: "track-1",
    title: "Track 1.sid",
    subtitle: "/Music/Track 1.sid",
    selected: false,
    actionLabel: "Play",
    onAction: vi.fn(),
  },
];

type HarnessProps = {
  compact?: boolean;
  selectedCount?: number;
  hasPlaylist?: boolean;
  onAddItems?: () => void;
  onClearPlaylist?: () => void;
  playlistTypeFilters?: PlayFileCategory[];
  onToggleFilter?: (category: PlayFileCategory) => void;
  playlistFilterText?: string;
  hiddenItemCount?: number;
  playlistItemCount?: number;
  playlistLoading?: boolean;
};

const PlaylistPanelHarness = ({
  compact = false,
  selectedCount = 0,
  hasPlaylist = true,
  onAddItems = vi.fn(),
  onClearPlaylist = vi.fn(),
  playlistTypeFilters = ["sid", "mod", "prg", "crt", "disk"],
  onToggleFilter = vi.fn(),
  playlistFilterText = "",
  hiddenItemCount = 0,
  playlistItemCount = items.length,
  playlistLoading = false,
}: HarnessProps) => {
  const { setOverride } = useDisplayProfilePreference();

  useEffect(() => {
    setOverride(compact ? "compact" : null);
  }, [compact, setOverride]);

  return (
    <PlaylistPanel
      previewItems={items}
      viewAllItems={items}
      totalItemCount={items.length}
      hiddenItemCount={hiddenItemCount}
      selectedCount={selectedCount}
      allSelected={false}
      onToggleSelectAll={vi.fn()}
      onRemoveSelected={vi.fn()}
      maxVisible={0}
      playlistTypeFilters={playlistTypeFilters}
      onToggleFilter={onToggleFilter}
      hasPlaylist={hasPlaylist}
      playlistLoading={playlistLoading}
      playlistItemCount={playlistItemCount}
      onAddItems={onAddItems}
      onClearPlaylist={onClearPlaylist}
      playlistFilterText={playlistFilterText}
      onPlaylistFilterTextChange={vi.fn()}
      hasMoreViewAllItems={false}
      onViewAllEndReached={vi.fn()}
    />
  );
};

const renderPanel = (props?: HarnessProps) =>
  render(
    <DisplayProfileProvider>
      <PlaylistPanelHarness {...props} />
    </DisplayProfileProvider>,
  );

describe("PlaylistPanel", () => {
  it("says the playlist is loading, not empty, while the saved playlist is still being read", () => {
    renderPanel({ hasPlaylist: false, playlistItemCount: 0, playlistLoading: true });
    expect(screen.getByTestId("playlist-empty-label")).toHaveTextContent("Loading playlist…");
  });

  it("says the playlist is empty once the saved playlist has been read", () => {
    renderPanel({ hasPlaylist: false, playlistItemCount: 0, playlistLoading: false });
    expect(screen.getByTestId("playlist-empty-label")).toHaveTextContent("No tracks in playlist yet.");
  });

  it("offers three type filters, Songs, Progs and Disks, in place of one per file type", () => {
    renderPanel({ compact: true });

    const header = screen.getByTestId("playlist-filter-header");
    expect(Array.from(header.querySelectorAll("label")).map((label) => label.textContent)).toEqual([
      "Songs",
      "Progs",
      "Disks",
    ]);
    expect(screen.getByTestId("playlist-type-songs")).toBeChecked();
    expect(screen.queryByTestId("playlist-type-sid")).not.toBeInTheDocument();
  });

  it("hides SID and MOD files together when Songs is unchecked", () => {
    const onToggleFilter = vi.fn();
    renderPanel({ onToggleFilter });

    fireEvent.click(screen.getByTestId("playlist-type-songs"));

    expect(onToggleFilter.mock.calls.map(([category]) => category)).toEqual(["sid", "mod"]);
  });

  it("shows PRG and CRT files together again when Progs is checked", () => {
    const onToggleFilter = vi.fn();
    renderPanel({ onToggleFilter, playlistTypeFilters: ["sid", "mod", "disk"] });

    expect(screen.getByTestId("playlist-type-progs")).not.toBeChecked();
    fireEvent.click(screen.getByTestId("playlist-type-progs"));

    expect(onToggleFilter.mock.calls.map(([category]) => category)).toEqual(["prg", "crt"]);
  });

  it("names the types the filter still shows, for the folded filter to display", () => {
    renderPanel({ playlistTypeFilters: ["prg", "crt", "disk"] });
    expect(screen.getByTestId("playlist-filter-summary")).toHaveTextContent("Progs, Disks");
  });

  it("folds the filter on the compact profile only", () => {
    renderPanel();
    expect(screen.getByTestId("playlist-collapsible-profiles")).toHaveTextContent(/^compact$/);
  });

  it("hands the list the number of playlist items its filters hide", () => {
    renderPanel({ hiddenItemCount: 153 });

    expect(screen.getByTestId("playlist-hidden-item-count")).toHaveTextContent("153");
  });

  it("switches playlist actions and removal label based on playlist state", () => {
    const onAddItems = vi.fn();
    const onClearPlaylist = vi.fn();

    const { rerender } = render(
      <DisplayProfileProvider>
        <PlaylistPanelHarness
          compact
          selectedCount={2}
          hasPlaylist
          onAddItems={onAddItems}
          onClearPlaylist={onClearPlaylist}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("playlist-remove-selected-label")).toHaveTextContent("Remove selected items");

    fireEvent.click(screen.getByRole("button", { name: "Add items to playlist" }));

    expect(onAddItems).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Clear playlist" })).toBeVisible();

    rerender(
      <DisplayProfileProvider>
        <PlaylistPanelHarness
          selectedCount={0}
          hasPlaylist={false}
          onAddItems={onAddItems}
          onClearPlaylist={onClearPlaylist}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("playlist-remove-selected-label")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Add items to playlist" })).toHaveTextContent("Add items");
    expect(screen.queryByRole("button", { name: "Clear playlist" })).not.toBeInTheDocument();
  });

  it("registers playlist header CTAs into the keypad focus ring, and OK twice on Clear playlist cancels", async () => {
    const onAddItems = vi.fn();
    const onClearPlaylist = vi.fn();

    render(
      <DisplayProfileProvider>
        <FocusNavigationProvider profileId="keypad">
          <PlaylistPanelHarness hasPlaylist onAddItems={onAddItems} onClearPlaylist={onClearPlaylist} />
        </FocusNavigationProvider>
      </DisplayProfileProvider>,
    );

    const addItems = screen.getByRole("button", { name: "Add items to playlist" });
    for (let step = 0; step < 20 && document.activeElement !== addItems; step += 1) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
    }
    expect(addItems).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(onAddItems).toHaveBeenCalledTimes(1);

    const clearPlaylist = screen.getByRole("button", { name: "Clear playlist" });
    for (let step = 0; step < 20 && document.activeElement !== clearPlaylist; step += 1) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
    }
    expect(clearPlaylist).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(await screen.findByTestId("clear-playlist-dialog")).toBeVisible();
    expect(onClearPlaylist).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("clear-playlist-cancel")).toHaveFocus());

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    await waitFor(() => expect(screen.queryByTestId("clear-playlist-dialog")).not.toBeInTheDocument());
    expect(onClearPlaylist).not.toHaveBeenCalled();
  });

  it("asks before clearing, naming how many items go, and does not clear on the first press", async () => {
    const onClearPlaylist = vi.fn();
    renderPanel({ onClearPlaylist, playlistItemCount: 350 });

    fireEvent.click(screen.getByRole("button", { name: "Clear playlist" }));

    const dialog = await screen.findByTestId("clear-playlist-dialog");
    expect(dialog).toHaveTextContent("This removes all 350 items from the playlist. It cannot be undone.");
    expect(onClearPlaylist).not.toHaveBeenCalled();
  });

  it("clears the playlist once when the confirmation's Clear is pressed", async () => {
    const onClearPlaylist = vi.fn();
    renderPanel({ onClearPlaylist, playlistItemCount: 350 });

    fireEvent.click(screen.getByRole("button", { name: "Clear playlist" }));
    fireEvent.click(await screen.findByTestId("clear-playlist-confirm"));

    expect(onClearPlaylist).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("clear-playlist-dialog")).not.toBeInTheDocument());
  });

  it("keeps the playlist when the confirmation is cancelled", async () => {
    const onClearPlaylist = vi.fn();
    renderPanel({ onClearPlaylist });

    fireEvent.click(screen.getByRole("button", { name: "Clear playlist" }));
    expect(await screen.findByTestId("clear-playlist-dialog")).toHaveTextContent(
      "This removes the 1 item in the playlist.",
    );
    fireEvent.click(screen.getByTestId("clear-playlist-cancel"));

    await waitFor(() => expect(screen.queryByTestId("clear-playlist-dialog")).not.toBeInTheDocument());
    expect(onClearPlaylist).not.toHaveBeenCalled();
  });
});
