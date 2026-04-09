/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePlaylistListItems } from "@/pages/playFiles/hooks/usePlaylistListItems";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { FileOriginIcon } from "@/components/FileOriginIcon";
import type { ConfigFileReference } from "@/lib/config/configFileReference";

const { beginHvscPerfScope, endHvscPerfScope } = vi.hoisted(() => ({
  beginHvscPerfScope: vi.fn((scope: string, metadata?: Record<string, unknown>) => ({
    scope,
    name: `hvsc:perf:${scope}`,
    startMarkName: `${scope}:start`,
    startedAt: "2026-04-05T00:00:00.000Z",
    startedAtMs: 0,
    metadata: metadata ?? null,
  })),
  endHvscPerfScope: vi.fn(),
}));

const { recordSmokeBenchmarkSnapshot } = vi.hoisted(() => ({
  recordSmokeBenchmarkSnapshot: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  beginHvscPerfScope,
  endHvscPerfScope,
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  recordSmokeBenchmarkSnapshot,
}));

const buildItem = (
  source: "local" | "ultimate" | "hvsc",
  path: string,
  status: PlaylistItem["status"] = "ready",
  configRef: ConfigFileReference | null = null,
): PlaylistItem => ({
  id: `${source}:${path}`,
  request: { source, path },
  category: "sid",
  label: path.split("/").pop() || path,
  path,
  configRef,
  addedAt: "2026-02-12T00:00:00.000Z",
  status,
  unavailableReason: status === "unavailable" ? "file-inaccessible" : null,
});

describe("usePlaylistListItems", () => {
  it("does not include source-kind labels in playlist item details", () => {
    const playlist = [
      buildItem("ultimate", "/USB0/Music/track1.sid"),
      buildItem("local", "/Music/track2.sid"),
      buildItem("hvsc", "/MUSICIANS/Hubbard_Rob/Commando.sid"),
    ];

    const { result } = renderHook(() =>
      usePlaylistListItems({
        filteredPlaylist: playlist,
        playlist,
        selectedPlaylistIds: new Set<string>(),
        isPlaylistLoading: false,
        handlePlaylistSelect: vi.fn(),
        onAttachLocalConfig: vi.fn(),
        onAttachUltimateConfig: vi.fn(),
        onRemoveConfig: vi.fn(),
        startPlaylist: vi.fn(),
        playlistItemDuration: () => undefined,
        formatTime: () => "—:—",
        formatPlayCategory: () => "SID",
        formatBytes: () => "—",
        formatDate: () => "—",
        getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
        currentPlayingItemId: null,
      }),
    );

    const listItems = result.current.filter((entry) => entry.variant !== "header");
    expect(listItems).toHaveLength(3);

    listItems.forEach((entry) => {
      const sourceInfo = entry.menuItems?.find((menu) => menu.type === "info" && menu.label === "Source");
      expect(sourceInfo).toBeUndefined();
      expect(entry.subtitle).toBeTruthy();
      expect(entry.subtitle).not.toContain("This device");
      expect(entry.subtitle).not.toContain("C64 Ultimate");
      expect(entry.subtitle).not.toContain("HVSC");
      const metaChildren = Array.isArray((entry.meta as any)?.props?.children)
        ? (entry.meta as any).props.children
        : [(entry.meta as any)?.props?.children];
      expect(metaChildren.some((child: any) => child?.type === FileOriginIcon)).toBe(true);
    });

    expect(listItems[2]?.subtitle).toBe("/MUSICIANS/Hubbard_Rob/Commando.sid");
  });

  it("uses generic unavailable status metadata", () => {
    const playlist = [buildItem("hvsc", "/MUSICIANS/Hubbard_Rob/Commando.sid", "unavailable")];

    const { result } = renderHook(() =>
      usePlaylistListItems({
        filteredPlaylist: playlist,
        playlist,
        selectedPlaylistIds: new Set<string>(),
        isPlaylistLoading: false,
        handlePlaylistSelect: vi.fn(),
        onAttachLocalConfig: vi.fn(),
        onAttachUltimateConfig: vi.fn(),
        onRemoveConfig: vi.fn(),
        startPlaylist: vi.fn(),
        playlistItemDuration: () => undefined,
        formatTime: () => "—:—",
        formatPlayCategory: () => "SID",
        formatBytes: () => "—",
        formatDate: () => "—",
        getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
        currentPlayingItemId: null,
      }),
    );

    const row = result.current.find((entry) => entry.variant !== "header");
    const statusEntry = row?.menuItems?.find((menu) => menu.type === "info" && menu.label === "Status");
    expect(statusEntry).toEqual({
      type: "info",
      label: "Status",
      value: "Unavailable",
    });
  });

  it("adds config menu actions and attached config details", () => {
    const onAttachLocalConfig = vi.fn();
    const onAttachUltimateConfig = vi.fn();
    const onRemoveConfig = vi.fn();
    const playlist = [
      buildItem("local", "/Music/track.sid", "ready", {
        kind: "local",
        fileName: "track.cfg",
        path: "/Music/track.cfg",
        sourceId: "local-source",
      }),
    ];

    const { result } = renderHook(() =>
      usePlaylistListItems({
        filteredPlaylist: playlist,
        playlist,
        selectedPlaylistIds: new Set<string>(),
        isPlaylistLoading: false,
        handlePlaylistSelect: vi.fn(),
        onAttachLocalConfig,
        onAttachUltimateConfig,
        onRemoveConfig,
        startPlaylist: vi.fn(),
        playlistItemDuration: () => undefined,
        formatTime: () => "—:—",
        formatPlayCategory: () => "SID",
        formatBytes: () => "—",
        formatDate: () => "—",
        getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
        currentPlayingItemId: null,
      }),
    );

    const row = result.current.find((entry) => entry.variant !== "header");
    const attachedEntry = row?.menuItems?.find((menu) => menu.type === "info" && menu.label === "Attached");
    const locationEntry = row?.menuItems?.find((menu) => menu.type === "info" && menu.label === "Location");
    const localAction = row?.menuItems?.find((menu) => menu.type === "action" && menu.label === "Change to local .cfg");
    const ultimateAction = row?.menuItems?.find(
      (menu) => menu.type === "action" && menu.label === "Change to C64U .cfg",
    );
    const removeAction = row?.menuItems?.find(
      (menu) => menu.type === "action" && menu.label === "Remove config association",
    );

    expect(attachedEntry).toEqual({
      type: "info",
      label: "Attached",
      value: "track.cfg",
    });
    expect(locationEntry).toEqual({
      type: "info",
      label: "Location",
      value: "This device",
    });

    if (localAction?.type === "action") {
      localAction.onSelect();
    }
    if (ultimateAction?.type === "action") {
      ultimateAction.onSelect();
    }
    if (removeAction?.type === "action") {
      removeAction.onSelect();
    }

    expect(onAttachLocalConfig).toHaveBeenCalledWith(playlist[0]);
    expect(onAttachUltimateConfig).toHaveBeenCalledWith(playlist[0]);
    expect(onRemoveConfig).toHaveBeenCalledWith(playlist[0]);
  });

  it("records browse render timings for derived playlist rows", () => {
    const playlist = [
      buildItem("hvsc", "/MUSICIANS/Hubbard_Rob/Commando.sid"),
      buildItem("hvsc", "/MUSICIANS/Hubbard_Rob/Delta.sid"),
    ];

    renderHook(() =>
      usePlaylistListItems({
        filteredPlaylist: playlist,
        playlist,
        selectedPlaylistIds: new Set<string>(),
        isPlaylistLoading: false,
        handlePlaylistSelect: vi.fn(),
        onAttachLocalConfig: vi.fn(),
        onAttachUltimateConfig: vi.fn(),
        onRemoveConfig: vi.fn(),
        startPlaylist: vi.fn(),
        playlistItemDuration: () => undefined,
        formatTime: () => "—:—",
        formatPlayCategory: () => "SID",
        formatBytes: () => "—",
        formatDate: () => "—",
        getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
        currentPlayingItemId: null,
      }),
    );

    expect(beginHvscPerfScope).toHaveBeenCalledWith(
      "browse:render",
      expect.objectContaining({ filteredCount: 2, hvscItemCount: 2 }),
    );
    expect(endHvscPerfScope).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "browse:render" }),
      expect.objectContaining({ outcome: "success", renderedRowCount: 2 }),
    );
    expect(recordSmokeBenchmarkSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: "playlist-render",
        state: "complete",
        metadata: expect.objectContaining({
          filteredCount: 2,
          playlistCount: 2,
          renderedRowCount: 2,
        }),
      }),
    );
  });

  it("surfaces candidate and declined config states and wires row actions", () => {
    const handlePlaylistSelect = vi.fn();
    const onOpenConfig = vi.fn();
    const startPlaylist = vi.fn();
    const candidateItem: PlaylistItem = {
      ...buildItem("commoserve", "/COMMOSERVE/Demos/Candidate.sid"),
      configCandidates: [
        {
          ref: {
            kind: "local",
            fileName: "candidate.cfg",
            path: "/Configs/candidate.cfg",
            sourceId: "local-source",
          },
          strategy: "exact-name",
          distance: 0,
          confidence: "high",
        },
      ],
    };
    const declinedItem: PlaylistItem = {
      ...buildItem("hvsc", "/MUSICIANS/Hubbard_Rob/Declined.sid"),
      configOrigin: "manual-none",
    };
    const playlist = [candidateItem, declinedItem];

    const { result } = renderHook(() =>
      usePlaylistListItems({
        filteredPlaylist: playlist,
        playlist,
        selectedPlaylistIds: new Set<string>(),
        isPlaylistLoading: false,
        handlePlaylistSelect,
        onAttachLocalConfig: vi.fn(),
        onAttachUltimateConfig: vi.fn(),
        onOpenConfig,
        onRemoveConfig: vi.fn(),
        startPlaylist,
        playlistItemDuration: () => undefined,
        formatTime: () => "—:—",
        formatPlayCategory: () => "SID",
        formatBytes: () => "—",
        formatDate: () => "—",
        getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
        currentPlayingItemId: candidateItem.id,
      }),
    );

    const rows = result.current.filter((entry) => entry.variant !== "header");
    const candidateRow = rows.find((entry) => entry.id === candidateItem.id);
    const declinedRow = rows.find((entry) => entry.id === declinedItem.id);

    expect(candidateRow?.secondaryActionLabel).toBe("CFG?");
    expect(candidateRow?.isPlaying).toBe(true);
    expect(declinedRow?.secondaryActionLabel).toBe("No CFG");

    const candidateStatuses = candidateRow?.menuItems?.filter(
      (menu) => menu.type === "info" && menu.label === "Status",
    );
    const declinedStatuses = declinedRow?.menuItems?.filter((menu) => menu.type === "info" && menu.label === "Status");
    expect(candidateStatuses?.[0]).toEqual({
      type: "info",
      label: "Status",
      value: "Available",
    });
    expect(candidateStatuses?.[1]).toEqual({
      type: "info",
      label: "Status",
      value: "Candidates found",
    });
    expect(declinedStatuses?.[1]).toEqual({
      type: "info",
      label: "Status",
      value: "Declined",
    });

    candidateRow?.onSelectToggle?.(true);
    candidateRow?.onAction?.();
    candidateRow?.onSecondaryAction?.();
    candidateRow?.onTitleClick?.();
    declinedRow?.onRowClick?.();

    expect(handlePlaylistSelect).toHaveBeenCalledWith(candidateItem, true);
    expect(onOpenConfig).toHaveBeenCalledWith(candidateItem);
    expect(startPlaylist).toHaveBeenNthCalledWith(1, playlist, 0);
    expect(startPlaylist).toHaveBeenNthCalledWith(2, playlist, 0);
    expect(startPlaylist).toHaveBeenNthCalledWith(3, playlist, 1);

    const candidateMetaChildren = Array.isArray((candidateRow?.meta as any)?.props?.children)
      ? (candidateRow?.meta as any).props.children
      : [(candidateRow?.meta as any)?.props?.children];
    expect(candidateMetaChildren[0]?.props?.origin).toBe("commoserve");
  });
});
