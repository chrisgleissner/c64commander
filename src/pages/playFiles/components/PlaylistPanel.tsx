import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectableActionList, type ActionListItem } from '@/components/lists/SelectableActionList';
import type { PlayFileCategory } from '@/lib/playback/fileTypes';

export type PlaylistPanelProps = {
  items: ActionListItem[];
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
};

export const PlaylistPanel = ({
  items,
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
}: PlaylistPanelProps) => (
  <div className="bg-card border border-border rounded-xl p-4 space-y-4">
    <SelectableActionList
      title="Playlist"
      selectionLabel="items"
      items={items}
      emptyLabel="No tracks in playlist yet."
      selectAllLabel="Select all"
      deselectAllLabel="Deselect all"
      removeSelectedLabel={selectedCount ? 'Remove selected items' : undefined}
      selectedCount={selectedCount}
      allSelected={allSelected}
      onToggleSelectAll={onToggleSelectAll}
      onRemoveSelected={onRemoveSelected}
      maxVisible={maxVisible}
      viewAllTitle="Playlist"
      listTestId="playlist-list"
      rowTestId="playlist-item"
      filterHeader={(
        <div className="flex flex-wrap gap-2">
          {categoryOptions.map((category) => (
            <label key={category} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Checkbox
                checked={playlistTypeFilters.includes(category)}
                onCheckedChange={() => onToggleFilter(category)}
                aria-label={formatCategory(category)}
                data-testid={`playlist-type-${category}`}
              />
              {formatCategory(category)}
            </label>
          ))}
        </div>
      )}
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
            {hasPlaylist ? 'Add more items' : 'Add items'}
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
