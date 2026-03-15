import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { DisplayProfileProvider, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";
import { PlaylistPanel } from "@/pages/playFiles/components/PlaylistPanel";
import type { ActionListItem } from "@/components/lists/SelectableActionList";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";

vi.mock("@/components/lists/SelectableActionList", () => ({
  SelectableActionList: ({
    filterHeader,
    viewAllFilterHeader,
    removeSelectedLabel,
    headerActions,
  }: {
    filterHeader: React.ReactNode;
    viewAllFilterHeader?: React.ReactNode;
    removeSelectedLabel?: string;
    headerActions?: React.ReactNode;
  }) => (
    <div>
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
};

const PlaylistPanelHarness = ({
  compact = false,
  selectedCount = 0,
  hasPlaylist = true,
  onAddItems = vi.fn(),
  onClearPlaylist = vi.fn(),
  categoryOptions = ["sid", "mod", "prg", "crt", "disk"] satisfies PlayFileCategory[],
  playlistTypeFilters = ["sid", "mod", "prg", "crt", "disk"],
}: HarnessProps) => {
  const { setOverride } = useDisplayProfilePreference();

  useEffect(() => {
    setOverride(compact ? "compact" : null);
  }, [compact, setOverride]);

  return (
    <PlaylistPanel
      items={items}
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
      onAddItems={onAddItems}
      onClearPlaylist={onClearPlaylist}
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
    fireEvent.click(screen.getByRole("button", { name: "Clear playlist" }));

    expect(onAddItems).toHaveBeenCalledTimes(1);
    expect(onClearPlaylist).toHaveBeenCalledTimes(1);

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
});
