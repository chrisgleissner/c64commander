/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { DisplayProfile } from "@/lib/displayProfiles";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { ClearPlaylistDialog } from "@/pages/playFiles/components/ClearPlaylistDialog";
import type { LetterIndexSource } from "@/lib/lists/letterIndex";
import {
  PLAYLIST_TYPE_GROUPS,
  describePlaylistTypeFilter,
  isPlaylistTypeGroupShown,
  playlistTypeGroupToggles,
} from "@/pages/playFiles/playlistTypeGroups";

export type PlaylistPanelProps = {
  previewItems: ActionListItem[];
  viewAllItems: ActionListItem[];
  totalItemCount: number;
  hiddenItemCount: number;
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onRemoveSelected: () => void;
  maxVisible: number;
  playlistTypeFilters: PlayFileCategory[];
  onToggleFilter: (category: PlayFileCategory) => void;
  hasPlaylist: boolean;
  /** The saved playlist is still being read, so an empty list does not yet mean there is nothing in it. */
  playlistLoading: boolean;
  playlistItemCount: number;
  onAddItems: () => void;
  onClearPlaylist: () => void;
  playlistFilterText: string;
  onPlaylistFilterTextChange: (value: string) => void;
  hasMoreViewAllItems: boolean;
  onViewAllEndReached: () => void;
  letterIndexSource?: LetterIndexSource;
};

const PLAY_PLAYLIST_FOCUS_ORDER = {
  addItems: 300,
  clear: 310,
} as const;

const COLLAPSIBLE_FILTER_PROFILES: readonly DisplayProfile[] = ["compact"];

export const PlaylistPanel = ({
  previewItems,
  viewAllItems,
  totalItemCount,
  hiddenItemCount,
  selectedCount,
  allSelected,
  onToggleSelectAll,
  onRemoveSelected,
  maxVisible,
  playlistTypeFilters,
  onToggleFilter,
  hasPlaylist,
  playlistLoading,
  playlistItemCount,
  onAddItems,
  onClearPlaylist,
  playlistFilterText,
  onPlaylistFilterTextChange,
  hasMoreViewAllItems,
  onViewAllEndReached,
  letterIndexSource,
}: PlaylistPanelProps) => {
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const addItemsFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-playlist-add-items",
    order: PLAY_PLAYLIST_FOCUS_ORDER.addItems,
    group: "play-playlist",
  });
  const clearPlaylistFocusRef = useFocusItem<HTMLButtonElement>({
    id: hasPlaylist ? "play-playlist-clear" : "",
    order: PLAY_PLAYLIST_FOCUS_ORDER.clear,
    group: "play-playlist",
  });

  const typeFilters = (
    <div className="flex flex-wrap gap-x-3 gap-y-0">
      {PLAYLIST_TYPE_GROUPS.map((group) => (
        // min-h-11 gives the 44px target size. The checkbox itself is small, but the label
        // is what the user presses, so the floor belongs here.
        <label key={group.id} className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={isPlaylistTypeGroupShown(playlistTypeFilters, group)}
            onCheckedChange={() => playlistTypeGroupToggles(playlistTypeFilters, group).forEach(onToggleFilter)}
            aria-label={group.label}
            data-testid={`playlist-type-${group.id}`}
          />
          {group.label}
        </label>
      ))}
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-panel p-4 space-y-4">
      <SelectableActionList
        title="Playlist"
        selectionLabel="items"
        items={previewItems}
        viewAllItems={viewAllItems}
        totalItemCount={totalItemCount}
        hiddenItemCount={hiddenItemCount}
        emptyLabel={playlistLoading ? "Loading playlist…" : "No tracks in playlist yet."}
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
        filterHeader={typeFilters}
        filterHeaderSummary={describePlaylistTypeFilter(playlistTypeFilters)}
        collapsibleFilterProfiles={COLLAPSIBLE_FILTER_PROFILES}
        filterValue={playlistFilterText}
        onFilterValueChange={onPlaylistFilterTextChange}
        viewAllFilterValue={playlistFilterText}
        onViewAllFilterValueChange={onPlaylistFilterTextChange}
        disableClientFiltering
        hasMoreViewAllItems={hasMoreViewAllItems}
        onViewAllEndReached={onViewAllEndReached}
        letterIndexSource={letterIndexSource}
        viewAllMode="non-empty"
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={addItemsFocusRef}
              variant="outline"
              size="sm"
              onClick={onAddItems}
              aria-label="Add items to playlist"
              id="add-items-to-playlist"
              data-testid="add-items-to-playlist"
              className="min-h-11 flex-auto whitespace-nowrap px-2"
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Add
            </Button>
            {hasPlaylist ? (
              <Button
                ref={clearPlaylistFocusRef}
                variant="outline"
                size="sm"
                onClick={() => setClearConfirmOpen(true)}
                aria-label="Clear playlist"
                className="min-h-11 flex-auto whitespace-nowrap px-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>
        }
      />
      <ClearPlaylistDialog
        open={clearConfirmOpen}
        itemCount={playlistItemCount}
        onOpenChange={setClearConfirmOpen}
        onConfirm={onClearPlaylist}
      />
    </div>
  );
};
