/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

export type PlaylistPanelProps = {
  previewItems: ActionListItem[];
  viewAllItems: ActionListItem[];
  totalItemCount: number;
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onRemoveSelected: () => void;
  maxVisible: number;
  categoryOptions: PlayFileCategory[];
  playlistTypeFilters: PlayFileCategory[];
  onToggleFilter: (category: PlayFileCategory) => void;
  formatCategory: (category: PlayFileCategory) => string;
  hasPlaylist: boolean;
  onAddItems: () => void;
  onClearPlaylist: () => void;
  playlistFilterText: string;
  onPlaylistFilterTextChange: (value: string) => void;
  hasMoreViewAllItems: boolean;
  onViewAllEndReached: () => void;
};

export const PlaylistPanel = ({
  previewItems,
  viewAllItems,
  totalItemCount,
  selectedCount,
  allSelected,
  onToggleSelectAll,
  onRemoveSelected,
  maxVisible,
  categoryOptions,
  playlistTypeFilters,
  onToggleFilter,
  formatCategory,
  hasPlaylist,
  onAddItems,
  onClearPlaylist,
  playlistFilterText,
  onPlaylistFilterTextChange,
  hasMoreViewAllItems,
  onViewAllEndReached,
}: PlaylistPanelProps) => {
  const { profile } = useDisplayProfile();

  const compactSheetCategoryLabels: Partial<Record<PlayFileCategory, string>> = {
    sid: "SID",
    mod: "MOD",
    prg: "PRG",
    crt: "CRT",
    disk: "Disks",
  };

  const renderCategoryFilters = (useCompactSheetLabels: boolean) => (
    <div className="flex flex-wrap gap-2">
      {categoryOptions.map((category) => {
        const label = useCompactSheetLabels
          ? (compactSheetCategoryLabels[category] ?? formatCategory(category))
          : formatCategory(category);
        return (
          <label key={category} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Checkbox
              checked={playlistTypeFilters.includes(category)}
              onCheckedChange={() => onToggleFilter(category)}
              aria-label={label}
              data-testid={`playlist-type-${category}`}
            />
            {label}
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <SelectableActionList
        title="Playlist"
        selectionLabel="items"
        items={previewItems}
        viewAllItems={viewAllItems}
        totalItemCount={totalItemCount}
        emptyLabel="No tracks in playlist yet."
        selectAllLabel="Select all"
        deselectAllLabel="Deselect all"
        removeSelectedLabel={selectedCount ? "Remove selected items" : undefined}
        selectedCount={selectedCount}
        allSelected={allSelected}
        onToggleSelectAll={onToggleSelectAll}
        onRemoveSelected={onRemoveSelected}
        maxVisible={maxVisible}
        viewAllTitle="Playlist"
        listTestId="playlist-list"
        rowTestId="playlist-item"
        filterHeader={renderCategoryFilters(false)}
        viewAllFilterHeader={profile === "compact" ? renderCategoryFilters(true) : undefined}
        filterValue={playlistFilterText}
        onFilterValueChange={onPlaylistFilterTextChange}
        viewAllFilterValue={playlistFilterText}
        onViewAllFilterValueChange={onPlaylistFilterTextChange}
        disableClientFiltering
        hasMoreViewAllItems={hasMoreViewAllItems}
        onViewAllEndReached={onViewAllEndReached}
        viewAllMode="non-empty"
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAddItems}
              aria-label="Add items to playlist"
              id="add-items-to-playlist"
              data-testid="add-items-to-playlist"
            >
              {hasPlaylist ? "Add more items" : "Add items"}
            </Button>
            {hasPlaylist ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onClearPlaylist}
                aria-label="Clear playlist"
                className="text-destructive hover:text-destructive"
              >
                Clear playlist
              </Button>
            ) : null}
          </div>
        }
      />
    </div>
  );
};
