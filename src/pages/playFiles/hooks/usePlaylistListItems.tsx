import { useMemo } from 'react';
import { Folder } from 'lucide-react';
import { FileOriginIcon } from '@/components/FileOriginIcon';
import type { ActionListItem, ActionListMenuItem } from '@/components/lists/SelectableActionList';
import type { PlayFileCategory } from '@/lib/playback/fileTypes';
import type { PlaylistItem } from '@/pages/playFiles/types';

export type PlaylistListItemsOptions = {
  filteredPlaylist: PlaylistItem[];
  playlist: PlaylistItem[];
  selectedPlaylistIds: Set<string>;
  isPlaylistLoading: boolean;
  handlePlaylistSelect: (item: PlaylistItem, selected: boolean) => void;
  startPlaylist: (items: PlaylistItem[], startIndex?: number) => Promise<void> | void;
  playlistItemDuration: (item: PlaylistItem, index: number) => number | undefined;
  formatTime: (ms?: number) => string;
  formatPlayCategory: (category: PlayFileCategory) => string;
  formatBytes: (value?: number | null) => string;
  formatDate: (value?: string | null) => string;
  getParentPath: (value: string) => string;
};

export const usePlaylistListItems = ({
  filteredPlaylist,
  playlist,
  selectedPlaylistIds,
  isPlaylistLoading,
  handlePlaylistSelect,
  startPlaylist,
  playlistItemDuration,
  formatTime,
  formatPlayCategory,
  formatBytes,
  formatDate,
  getParentPath,
}: PlaylistListItemsOptions) =>
  useMemo(() => {
    const items: ActionListItem[] = [];
    let lastFolder: string | null = null;
    filteredPlaylist.forEach((item) => {
      const folderPath = getParentPath(item.path);
      if (folderPath !== lastFolder) {
        items.push({
          id: `folder:${folderPath}`,
          title: folderPath,
          variant: 'header',
          icon: <Folder className="h-3.5 w-3.5" aria-hidden="true" />,
          selected: false,
          actionLabel: '',
          showMenu: false,
          showSelection: false,
          disableActions: true,
        });
        lastFolder = folderPath;
      }
      const playlistIndex = playlist.findIndex((entry) => entry.id === item.id);
      const durationLabel = formatTime(playlistItemDuration(item, Math.max(0, playlistIndex)));
      const detailsDate = item.modifiedAt ?? item.addedAt ?? null;
      const menuItems: ActionListMenuItem[] = [
        { type: 'label', label: 'Details' },
        { type: 'info', label: 'Type', value: formatPlayCategory(item.category) },
        { type: 'info', label: 'Duration', value: durationLabel },
        { type: 'info', label: 'Size', value: formatBytes(item.sizeBytes) },
        { type: 'info', label: 'Date', value: formatDate(detailsDate) },
        { type: 'info', label: 'Source', value: item.request.source === 'ultimate' ? 'C64 Ultimate' : 'This device' },
      ];
      items.push({
        id: item.id,
        title: item.label,
        titleClassName: 'line-clamp-2 whitespace-normal break-words block',
        meta: (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <FileOriginIcon
              origin={item.request.source === 'ultimate' ? 'ultimate' : 'local'}
              label={item.request.source === 'hvsc' ? 'HVSC library file' : undefined}
              className="h-3.5 w-3.5 shrink-0 opacity-60"
            />
            <span>{formatPlayCategory(item.category)}</span>
            <span>•</span>
            <span>{durationLabel}</span>
          </div>
        ),
        selected: selectedPlaylistIds.has(item.id),
        onSelectToggle: (selected) => handlePlaylistSelect(item, selected),
        menuItems,
        actionLabel: 'Play',
        onAction: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        onTitleClick: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        onRowClick: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        disableActions: isPlaylistLoading,
      } as ActionListItem);
    });
    return items;
  }, [
    filteredPlaylist,
    formatBytes,
    formatDate,
    formatPlayCategory,
    formatTime,
    getParentPath,
    handlePlaylistSelect,
    isPlaylistLoading,
    playlist,
    playlistItemDuration,
    selectedPlaylistIds,
    startPlaylist,
  ]);
