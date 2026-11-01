/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useAppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";
import { useLatestCallback } from "@/hooks/useLatestCallback";
import { useMemo, useRef } from "react";
import { Folder } from "lucide-react";
import { SidChipBadge } from "@/components/playback/SidChipBadge";
import { resolveTrackDisplayName } from "@/lib/playback/sidDisplayName";
import { useFriendlySidNames } from "@/lib/playback/useFriendlySidNames";
import { describeConfigOrigin, describeConfigOutcome, resolvePlaybackConfigUiState } from "@/lib/config/playbackConfig";
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import { LOCAL_DEVICE_LABEL, connectedDeviceLabel, describeContentSource } from "@/lib/sourceNavigation/sourceTerms";
import type { ActionListItem, ActionListMenuItem } from "@/components/lists/SelectableActionList";
import { formatPlayCategoryTag, type PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { buildPlaylistRowSubtitle } from "@/pages/playFiles/playlistRowSubtitle";

export type PlaylistListItemsOptions = {
  filteredPlaylist: PlaylistItem[];
  playlist: PlaylistItem[];
  selectedPlaylistIds: Set<string>;
  isPlaylistLoading: boolean;
  handlePlaylistSelect: (item: PlaylistItem, selected: boolean) => void;
  onAttachLocalConfig: (item: PlaylistItem) => void;
  onAttachUltimateConfig: (item: PlaylistItem) => void;
  onOpenConfig: (item: PlaylistItem) => void;
  onRemoveConfig: (item: PlaylistItem) => void;
  startPlaylist: (items: PlaylistItem[], startIndex?: number) => Promise<unknown> | void;
  playlistItemDuration: (item: PlaylistItem, index: number) => number | undefined;
  formatTime: (ms?: number) => string;
  formatPlayCategory: (category: PlayFileCategory) => string;
  formatBytes: (value?: number | null) => string;
  formatDate: (value?: string | null) => string;
  getParentPath: (value: string) => string;
  currentPlayingItemId: string | null;
};

/** What a built row was built from; the row is reused while every one of these is unchanged. */
type CachedPlaylistRow = {
  item: PlaylistItem;
  playlistIndex: number;
  durationLabel: string;
  selected: boolean;
  isPlaying: boolean;
  row: ActionListItem;
};

type PlaylistRowCache = { shared: readonly unknown[]; rows: Map<string, CachedPlaylistRow | ActionListItem> };

const sameInputs = (left: readonly unknown[], right: readonly unknown[]) =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

export const usePlaylistListItems = ({
  filteredPlaylist,
  playlist,
  selectedPlaylistIds,
  isPlaylistLoading,
  handlePlaylistSelect,
  onAttachLocalConfig,
  onAttachUltimateConfig,
  onOpenConfig,
  onRemoveConfig,
  startPlaylist: startPlaylistLatest,
  playlistItemDuration,
  formatTime,
  formatPlayCategory,
  formatBytes,
  formatDate,
  getParentPath,
  currentPlayingItemId,
}: PlaylistListItemsOptions) => {
  const startPlaylist = useLatestCallback(startPlaylistLatest);
  const playlistIndexById = useMemo(() => new Map(playlist.map((entry, index) => [entry.id, index])), [playlist]);
  const friendlyNames = useFriendlySidNames();
  const appMode = useAppMode();
  const showItemConfig = isSurfaceVisible("play:item-config", appMode);
  // Rows outlive one call: the view-all list grows a page at a time, and rebuilding every row on each
  // page made the first jump to a far letter one render of several hundred milliseconds.
  const rowCacheRef = useRef<PlaylistRowCache | null>(null);

  return useMemo(() => {
    // Every row closes over these, so a change to any of them rebuilds every row.
    const shared = [
      playlist,
      playlistIndexById,
      friendlyNames,
      appMode,
      isPlaylistLoading,
      handlePlaylistSelect,
      onAttachLocalConfig,
      onAttachUltimateConfig,
      onOpenConfig,
      onRemoveConfig,
      startPlaylist,
      playlistItemDuration,
      formatTime,
      formatPlayCategory,
      formatBytes,
      formatDate,
      getParentPath,
    ];
    const previousCache = rowCacheRef.current;
    const cachedRows = previousCache && sameInputs(previousCache.shared, shared) ? previousCache.rows : new Map();
    rowCacheRef.current = { shared, rows: cachedRows };
    const renderScope = beginHvscPerfScope("browse:render", {
      filteredCount: filteredPlaylist.length,
      playlistCount: playlist.length,
      currentPlayingItemId,
      hvscItemCount: filteredPlaylist.filter((item) => item.request.source === "hvsc").length,
    });
    const items: ActionListItem[] = [];
    let lastFolder: string | null = null;
    filteredPlaylist.forEach((item) => {
      const folderPath = getParentPath(item.path);
      if (folderPath !== lastFolder) {
        // A folder can recur further down the list, so its path alone is not a unique React key.
        const headerId = `folder:${folderPath}:${item.id}`;
        const cachedHeader = cachedRows.get(headerId) as ActionListItem | undefined;
        const header: ActionListItem = cachedHeader ?? {
          id: headerId,
          title: folderPath,
          variant: "header",
          icon: <Folder className="h-3.5 w-3.5" aria-hidden="true" />,
          selected: false,
          actionLabel: "",
          showMenu: false,
          showSelection: false,
          disableActions: true,
        };
        cachedRows.set(headerId, header);
        items.push(header);
        lastFolder = folderPath;
      }
      const playlistIndex = playlistIndexById.get(item.id) ?? -1;
      const durationLabel = formatTime(playlistItemDuration(item, Math.max(0, playlistIndex)));
      const selected = selectedPlaylistIds.has(item.id);
      const isPlaying = currentPlayingItemId === item.id;
      const cached = cachedRows.get(item.id) as CachedPlaylistRow | undefined;
      if (
        cached &&
        cached.item === item &&
        cached.playlistIndex === playlistIndex &&
        cached.durationLabel === durationLabel &&
        cached.selected === selected &&
        cached.isPlaying === isPlaying
      ) {
        items.push(cached.row);
        return;
      }
      // Presentation only. `item.label`, `item.id` and `item.path` are untouched, so selection,
      // removal, the playlist filter and everything persisted still work off the raw values; the row
      // only draws something else. A playlist row has no file bytes, so the chip count here comes
      // from the file-name marker rather than from a parsed SID header.
      const display = resolveTrackDisplayName({ label: item.label, category: item.category, friendlyNames });
      const detailsDate = item.modifiedAt ?? item.addedAt ?? null;
      const configUiState = resolvePlaybackConfigUiState({
        configRef: item.configRef ?? null,
        configOrigin: item.configOrigin ?? "none",
        configOverrides: item.configOverrides ?? null,
        configCandidates: item.configCandidates ?? null,
      });
      const configStatusLabel = !showItemConfig
        ? null
        : configUiState === "edited"
          ? "CFG*"
          : configUiState === "resolved"
            ? "CFG"
            : configUiState === "candidates"
              ? "CFG?"
              : configUiState === "declined"
                ? "No CFG"
                : null;
      const titleSuffix = [
        formatPlayCategoryTag(item.category),
        durationLabel,
        item.status === "unavailable" ? "Unavailable" : null,
      ]
        .filter(Boolean)
        .join(" ");
      const configMenuItems: ActionListMenuItem[] = [
        { type: "separator" },
        { type: "label", label: "Config" },
        {
          type: "info",
          label: "Attached",
          value: item.configRef ? item.configRef.fileName : "None",
        },
        {
          type: "info",
          label: "Status",
          value:
            configUiState === "edited"
              ? "Edited"
              : configUiState === "resolved"
                ? "Resolved"
                : configUiState === "candidates"
                  ? "Found nearby, none chosen"
                  : configUiState === "declined"
                    ? "Declined"
                    : "No config",
        },
        {
          type: "info",
          label: "Origin",
          value: describeConfigOrigin(item.configOrigin ?? "none"),
        },
        {
          type: "info",
          label: "Candidates",
          value: String(item.configCandidates?.length ?? 0),
        },
        {
          type: "info",
          label: "Overrides",
          value: String(item.configOverrides?.length ?? 0),
        },
        ...(item.configRef
          ? [
              {
                type: "info" as const,
                label: "Location",
                value: item.configRef.kind === "local" ? LOCAL_DEVICE_LABEL : connectedDeviceLabel(),
              },
            ]
          : []),
        {
          type: "action",
          label: "Review playback config",
          onSelect: () => onOpenConfig(item),
          disabled: isPlaylistLoading,
        },
        {
          type: "action",
          label: item.configRef ? "Change to local .cfg" : "Attach local .cfg",
          onSelect: () => onAttachLocalConfig(item),
          disabled: isPlaylistLoading,
        },
        {
          type: "action",
          label: item.configRef ? "Change to C64U .cfg" : "Attach C64U .cfg",
          onSelect: () => onAttachUltimateConfig(item),
          disabled: isPlaylistLoading,
        },
        ...(item.configRef
          ? [
              {
                type: "action" as const,
                label: "Remove config association",
                onSelect: () => onRemoveConfig(item),
                disabled: isPlaylistLoading,
              },
            ]
          : []),
      ];
      const menuItems: ActionListMenuItem[] = [
        { type: "label", label: "Details" },
        {
          type: "info",
          label: "Type",
          value: formatPlayCategory(item.category),
        },
        { type: "info", label: "Duration", value: durationLabel },
        { type: "info", label: "Source", value: describeContentSource(item.request.source) },
        // The row may show something more useful than the path (see `buildPlaylistRowSubtitle`).
        { type: "info", label: "Path", value: item.path },
        {
          type: "info",
          label: "Status",
          value: item.status === "unavailable" ? "Unavailable" : "Available",
        },
        { type: "info", label: "Size", value: formatBytes(item.sizeBytes) },
        { type: "info", label: "Date", value: formatDate(detailsDate) },
        ...(showItemConfig ? configMenuItems : []),
      ];
      const row: ActionListItem = {
        id: item.id,
        title: display.title,
        titleClassName: "whitespace-normal break-words block",
        subtitle: buildPlaylistRowSubtitle(item, { sidPlayer: appMode === "sid-player" }),
        subtitleClassName: "truncate block",
        titleSuffix,
        meta: display.chipCount ? <SidChipBadge chipCount={display.chipCount} /> : undefined,
        selected,
        isPlaying,
        onSelectToggle: (nextSelected) => handlePlaylistSelect(item, nextSelected),
        menuItems,
        actionLabel: "Play",
        onAction: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        secondaryActionLabel: configStatusLabel ?? undefined,
        onSecondaryAction: configStatusLabel ? () => onOpenConfig(item) : undefined,
        // The chip is four letters; its accessible name is what actually says what will happen.
        secondaryActionAriaLabel: configStatusLabel
          ? `${display.title} config: ${describeConfigOutcome({
              uiState: configUiState,
              fileName: item.configRef?.fileName ?? null,
              overrideCount: item.configOverrides?.length ?? 0,
              candidateCount: item.configCandidates?.length ?? 0,
            })} Open config details.`
          : undefined,
        onTitleClick: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        onRowClick: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        disableActions: isPlaylistLoading,
      };
      cachedRows.set(item.id, { item, playlistIndex, durationLabel, selected, isPlaying, row });
      items.push(row);
    });
    endHvscPerfScope(renderScope, {
      outcome: "success",
      filteredCount: filteredPlaylist.length,
      playlistCount: playlist.length,
      renderedRowCount: items.filter((item) => item.variant !== "header").length,
      renderedGroupCount: items.filter((item) => item.variant === "header").length,
      currentPlayingItemId,
    });
    if (filteredPlaylist.length > 0) {
      void recordSmokeBenchmarkSnapshot({
        scenario: "playlist-render",
        state: "complete",
        metadata: {
          filteredCount: filteredPlaylist.length,
          playlistCount: playlist.length,
          renderedRowCount: items.filter((item) => item.variant !== "header").length,
          renderedGroupCount: items.filter((item) => item.variant === "header").length,
          currentPlayingItemId,
        },
      });
    }
    return items;
  }, [
    filteredPlaylist,
    friendlyNames,
    appMode,
    formatBytes,
    formatDate,
    formatPlayCategory,
    formatTime,
    getParentPath,
    handlePlaylistSelect,
    onAttachLocalConfig,
    onAttachUltimateConfig,
    onOpenConfig,
    onRemoveConfig,
    isPlaylistLoading,
    playlist,
    playlistIndexById,
    playlistItemDuration,
    selectedPlaylistIds,
    startPlaylist,
    currentPlayingItemId,
  ]);
};
