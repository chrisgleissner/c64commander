/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { Folder } from "lucide-react";
import { FileOriginIcon } from "@/components/FileOriginIcon";
import { describeConfigOrigin, resolvePlaybackConfigUiState } from "@/lib/config/playbackConfig";
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import type { ActionListItem, ActionListMenuItem } from "@/components/lists/SelectableActionList";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaylistItem } from "@/pages/playFiles/types";

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
  startPlaylist: (items: PlaylistItem[], startIndex?: number) => Promise<void> | void;
  playlistItemDuration: (item: PlaylistItem, index: number) => number | undefined;
  formatTime: (ms?: number) => string;
  formatPlayCategory: (category: PlayFileCategory) => string;
  formatBytes: (value?: number | null) => string;
  formatDate: (value?: string | null) => string;
  getParentPath: (value: string) => string;
  currentPlayingItemId: string | null;
};

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
  startPlaylist,
  playlistItemDuration,
  formatTime,
  formatPlayCategory,
  formatBytes,
  formatDate,
  getParentPath,
  currentPlayingItemId,
}: PlaylistListItemsOptions) =>
  useMemo(() => {
    const renderScope = beginHvscPerfScope("browse:render", {
      filteredCount: filteredPlaylist.length,
      playlistCount: playlist.length,
      currentPlayingItemId,
      hvscItemCount: filteredPlaylist.filter((item) => item.request.source === "hvsc").length,
    });
    const items: ActionListItem[] = [];
    const playlistIndexById = new Map(playlist.map((entry, index) => [entry.id, index]));
    let lastFolder: string | null = null;
    filteredPlaylist.forEach((item) => {
      const folderPath = getParentPath(item.path);
      if (folderPath !== lastFolder) {
        items.push({
          id: `folder:${folderPath}`,
          title: folderPath,
          variant: "header",
          icon: <Folder className="h-3.5 w-3.5" aria-hidden="true" />,
          selected: false,
          actionLabel: "",
          showMenu: false,
          showSelection: false,
          disableActions: true,
        });
        lastFolder = folderPath;
      }
      const playlistIndex = playlistIndexById.get(item.id) ?? -1;
      const durationLabel = formatTime(playlistItemDuration(item, Math.max(0, playlistIndex)));
      const detailsDate = item.modifiedAt ?? item.addedAt ?? null;
      const configUiState = resolvePlaybackConfigUiState({
        configRef: item.configRef ?? null,
        configOrigin: item.configOrigin ?? "none",
        configOverrides: item.configOverrides ?? null,
        configCandidates: item.configCandidates ?? null,
      });
      const configStatusLabel =
        configUiState === "edited"
          ? "CFG*"
          : configUiState === "resolved"
            ? "CFG"
            : configUiState === "candidates"
              ? "CFG?"
              : configUiState === "declined"
                ? "No CFG"
                : null;
      const menuItems: ActionListMenuItem[] = [
        { type: "label", label: "Details" },
        {
          type: "info",
          label: "Type",
          value: formatPlayCategory(item.category),
        },
        { type: "info", label: "Duration", value: durationLabel },
        {
          type: "info",
          label: "Status",
          value: item.status === "unavailable" ? "Unavailable" : "Available",
        },
        { type: "info", label: "Size", value: formatBytes(item.sizeBytes) },
        { type: "info", label: "Date", value: formatDate(detailsDate) },
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
                  ? "Candidates found"
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
                value: item.configRef.kind === "local" ? "This device" : "C64 Ultimate",
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
      items.push({
        id: item.id,
        title: item.label,
        titleClassName: "whitespace-normal break-words block",
        subtitle: item.path,
        subtitleClassName: "truncate block",
        meta: (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <FileOriginIcon
              origin={
                item.request.source === "ultimate"
                  ? "ultimate"
                  : item.request.source === "hvsc"
                    ? "hvsc"
                    : item.request.source === "commoserve"
                      ? "commoserve"
                      : "local"
              }
              className="h-3.5 w-3.5 shrink-0 opacity-60"
            />
            <span>{formatPlayCategory(item.category)}</span>
            <span>•</span>
            <span>{durationLabel}</span>
            {configStatusLabel ? (
              <>
                <span>•</span>
                <span>{configStatusLabel}</span>
              </>
            ) : null}
            {item.status === "unavailable" ? (
              <>
                <span>•</span>
                <span>Unavailable</span>
              </>
            ) : null}
          </div>
        ),
        selected: selectedPlaylistIds.has(item.id),
        isPlaying: currentPlayingItemId === item.id,
        onSelectToggle: (selected) => handlePlaylistSelect(item, selected),
        menuItems,
        actionLabel: "Play",
        onAction: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        secondaryActionLabel: configStatusLabel,
        onSecondaryAction: configStatusLabel ? () => onOpenConfig(item) : undefined,
        secondaryActionAriaLabel: configStatusLabel ? `Open config details for ${item.label}` : undefined,
        onTitleClick: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        onRowClick: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        disableActions: isPlaylistLoading,
      } as ActionListItem);
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
    playlistItemDuration,
    selectedPlaylistIds,
    startPlaylist,
    currentPlayingItemId,
  ]);
