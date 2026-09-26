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
    viewAllFilterHeader,
    removeSelectedLabel,
    headerActions,
    hiddenItemCount,
  }: {
    filterHeader: React.ReactNode;
    viewAllFilterHeader?: React.ReactNode;
    removeSelectedLabel?: string;
    headerActions?: React.ReactNode;
    hiddenItemCount?: number;
  }) => (
    <div>
      <div data-testid="playlist-hidden-item-count">{hiddenItemCount}</div>
      <div data-testid="playlist-filter-header">{filterHeader}</div>
      <div data-testid="playlist-view-all-filter-header">{viewAllFilterHeader}</div>
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
  categoryOptions?: PlayFileCategory[];
  playlistTypeFilters?: PlayFileCategory[];
  playlistFilterText?: string;
  hiddenItemCount?: number;
  playlistItemCount?: number;
};

const PlaylistPanelHarness = ({
  compact = false,
  selectedCount = 0,
  hasPlaylist = true,
  onAddItems = vi.fn(),
  onClearPlaylist = vi.fn(),
  categoryOptions = ["sid", "mod", "prg", "crt", "disk"] satisfies PlayFileCategory[],
  playlistTypeFilters = ["sid", "mod", "prg", "crt", "disk"],
  playlistFilterText = "",
  hiddenItemCount = 0,
  playlistItemCount = items.length,
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
      categoryOptions={categoryOptions}
      playlistTypeFilters={playlistTypeFilters}
      onToggleFilter={vi.fn()}
      formatCategory={(category) =>
        ({
          sid: "SID music",
          mod: "MOD music",
          prg: "PRG program",
          crt: "CRT cartridge",
          disk: "Disk image",
        })[category] ?? category
      }
      hasPlaylist={hasPlaylist}
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
  it("shortens category labels only inside the compact playlist sheet", () => {
    renderPanel({ compact: true });

    const inlineHeader = screen.getByTestId("playlist-filter-header");
    const viewAllHeader = screen.getByTestId("playlist-view-all-filter-header");

    expect(inlineHeader).toHaveTextContent("SID music");
    expect(inlineHeader).toHaveTextContent("MOD music");
    expect(inlineHeader).toHaveTextContent("PRG program");
    expect(inlineHeader).toHaveTextContent("CRT cartridge");
    expect(inlineHeader).toHaveTextContent("Disk image");

    expect(viewAllHeader).toHaveTextContent("SID");
    expect(viewAllHeader).toHaveTextContent("MOD");
    expect(viewAllHeader).toHaveTextContent("PRG");
    expect(viewAllHeader).toHaveTextContent("CRT");
    expect(viewAllHeader).toHaveTextContent("Disks");
    expect(viewAllHeader).not.toHaveTextContent("SID music");
  });

  it("hands the list the number of playlist items its filters hide", () => {
    renderPanel({ hiddenItemCount: 153 });

    expect(screen.getByTestId("playlist-hidden-item-count")).toHaveTextContent("153");
  });

  it("keeps the view-all filter header empty outside compact mode", () => {
    renderPanel();

    expect(screen.getByTestId("playlist-view-all-filter-header")).toBeEmptyDOMElement();
  });

  it("falls back to the formatted label when compact sheet shorthand is unavailable", () => {
    renderPanel({
      compact: true,
      categoryOptions: ["sid", "tape" as PlayFileCategory],
      playlistTypeFilters: ["sid", "tape" as PlayFileCategory],
    });

    const viewAllHeader = screen.getByTestId("playlist-view-all-filter-header");

    expect(viewAllHeader).toHaveTextContent("SID");
    expect(viewAllHeader).toHaveTextContent("tape");
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
