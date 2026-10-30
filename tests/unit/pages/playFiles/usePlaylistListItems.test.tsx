/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePlaylistListItems } from "@/pages/playFiles/hooks/usePlaylistListItems";
import type { PlaylistQueueActions } from "@/pages/playFiles/hooks/usePlaylistQueueActions";
import type { ActionListMenuItem } from "@/components/lists/SelectableActionList";
import type { PlaylistItem } from "@/pages/playFiles/types";
import type { ConfigFileReference } from "@/lib/config/configFileReference";
import { LOCAL_DEVICE_LABEL } from "@/lib/sourceNavigation/sourceTerms";

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
  it("gives each folder header its own id when a folder recurs further down the list", () => {
    // A SID Radio queue alternates folders; a header id taken from the path alone repeated, and React
    // kept the stale header rows of the repeated key on screen after the queue changed.
    const playlist = [
      buildItem("hvsc", "/MUSICIANS/A/one.sid"),
      buildItem("hvsc", "/MUSICIANS/B/two.sid"),
      buildItem("hvsc", "/MUSICIANS/A/three.sid"),
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

    const headers = result.current.filter((entry) => entry.variant === "header");
    expect(headers.map((entry) => entry.title)).toEqual(["/MUSICIANS/A", "/MUSICIANS/B", "/MUSICIANS/A"]);
    const ids = result.current.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows where each item lives in its details, not in the row", () => {
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

    const sourceValues = listItems.map(
      (entry) =>
        entry.menuItems?.find((menu) => menu.type === "info" && menu.label === "Source") as
          { value: string } | undefined,
    );
    expect(sourceValues.map((row) => row?.value)).toEqual(["C64U", "Local", "HVSC"]);

    listItems.forEach((entry) => {
      expect(entry.subtitle).toBeNull();
      expect(entry.titleSuffix).not.toContain("This device");
      expect(entry.titleSuffix).not.toContain("C64 Ultimate");
      expect(entry.titleSuffix).not.toContain("HVSC");
    });
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
    // "Local", the same word the source picker and the disks list use for this
    // device. It used to say "This device" here and "Local" there, for one place.
    expect(locationEntry).toEqual({
      type: "info",
      label: "Location",
      value: LOCAL_DEVICE_LABEL,
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
      value: "Found nearby, none chosen",
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

    expect(candidateRow?.secondaryActionLabel).toBe("CFG?");
    expect(candidateRow?.titleSuffix).not.toContain("CFG");
  });
});

describe("usePlaylistListItems queue actions", () => {
  const playlist = [
    buildItem("local", "/Music/one.sid"),
    buildItem("local", "/Music/two.sid"),
    buildItem("local", "/Music/three.sid"),
    buildItem("local", "/Music/four.sid"),
  ];

  const buildQueueActions = (overrides: Partial<PlaylistQueueActions> = {}): PlaylistQueueActions => ({
    shuffleEnabled: false,
    filterHidesRows: false,
    playNext: vi.fn(),
    moveUp: vi.fn(),
    moveDown: vi.fn(),
    ...overrides,
  });

  const menuOf = (
    queueActions: PlaylistQueueActions,
    rowIndex: number,
    { isPlaylistLoading = false, currentPlayingItemId = null as string | null } = {},
  ): ActionListMenuItem[] => {
    const { result } = renderHook(() =>
      usePlaylistListItems({
        filteredPlaylist: playlist,
        playlist,
        selectedPlaylistIds: new Set<string>(),
        isPlaylistLoading,
        handlePlaylistSelect: vi.fn(),
        onAttachLocalConfig: vi.fn(),
        onAttachUltimateConfig: vi.fn(),
        onOpenConfig: vi.fn(),
        onRemoveConfig: vi.fn(),
        startPlaylist: vi.fn(),
        playlistItemDuration: () => undefined,
        formatTime: () => "—:—",
        formatPlayCategory: () => "SID",
        formatBytes: () => "—",
        formatDate: () => "—",
        getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
        currentPlayingItemId,
        queueActions,
      }),
    );
    const rows = result.current.filter((entry) => entry.variant !== "header");
    return rows[rowIndex].menuItems ?? [];
  };

  const queueEntries = (menu: ActionListMenuItem[]) =>
    menu.filter((entry) => entry.type === "action").slice(0, 3) as Extract<ActionListMenuItem, { type: "action" }>[];

  const disabledLabels = (menu: ActionListMenuItem[]) =>
    queueEntries(menu)
      .filter((entry) => entry.disabled)
      .map((entry) => entry.label);

  it("opens the menu with Play next, Move up and Move down, then a separator, then the details", () => {
    const menu = menuOf(buildQueueActions(), 1);

    expect(menu.slice(0, 5).map((entry) => (entry.type === "action" ? entry.label : entry.type))).toEqual([
      "Play next",
      "Move up",
      "Move down",
      "separator",
      "label",
    ]);
    expect(menu[4]).toEqual({ type: "label", label: "Details" });
  });

  it("adds nothing to the menu when the page supplies no queue actions", () => {
    const { result } = renderHook(() =>
      usePlaylistListItems({
        filteredPlaylist: playlist,
        playlist,
        selectedPlaylistIds: new Set<string>(),
        isPlaylistLoading: false,
        handlePlaylistSelect: vi.fn(),
        onAttachLocalConfig: vi.fn(),
        onAttachUltimateConfig: vi.fn(),
        onOpenConfig: vi.fn(),
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

    expect(result.current.find((entry) => entry.variant !== "header")?.menuItems?.[0]).toEqual({
      type: "label",
      label: "Details",
    });
  });

  it("calls each handler with the id of the row whose menu it is", () => {
    const queueActions = buildQueueActions();
    const menu = queueEntries(menuOf(queueActions, 2));

    menu.forEach((entry) => entry.onSelect());

    expect(queueActions.playNext).toHaveBeenCalledWith(playlist[2].id);
    expect(queueActions.moveUp).toHaveBeenCalledWith(playlist[2].id);
    expect(queueActions.moveDown).toHaveBeenCalledWith(playlist[2].id);
  });

  it("enables all three actions on a middle row when nothing plays", () => {
    expect(disabledLabels(menuOf(buildQueueActions(), 2))).toEqual([]);
  });

  it("disables Move up on the first row and Move down on the last row", () => {
    expect(disabledLabels(menuOf(buildQueueActions(), 0))).toEqual(["Play next", "Move up"]);
    expect(disabledLabels(menuOf(buildQueueActions(), 3))).toEqual(["Move down"]);
  });

  it("disables Play next on the playing row and on the row directly after it", () => {
    const playing = { currentPlayingItemId: playlist[1].id };

    expect(disabledLabels(menuOf(buildQueueActions(), 1, playing))).toEqual(["Play next"]);
    expect(disabledLabels(menuOf(buildQueueActions(), 2, playing))).toEqual(["Play next"]);
    expect(disabledLabels(menuOf(buildQueueActions(), 3, playing))).toEqual(["Move down"]);
    expect(disabledLabels(menuOf(buildQueueActions(), 0, playing))).toEqual(["Move up"]);
  });

  it("disables all three actions and says why while Shuffle is on", () => {
    const menu = menuOf(buildQueueActions({ shuffleEnabled: true }), 2);

    expect(disabledLabels(menu)).toEqual(["Play next", "Move up", "Move down"]);
    expect(menu.filter((entry) => entry.type === "note")).toEqual([
      { type: "note", text: "Turn off Shuffle to change the order" },
    ]);
  });

  it("disables Move up and Move down but not Play next while a filter hides rows, and says why", () => {
    const menu = menuOf(buildQueueActions({ filterHidesRows: true }), 2);

    expect(disabledLabels(menu)).toEqual(["Move up", "Move down"]);
    expect(menu.filter((entry) => entry.type === "note")).toEqual([
      { type: "note", text: "Clear the filter to change the order" },
    ]);
  });

  it("names Shuffle, not the filter, when both apply", () => {
    const menu = menuOf(buildQueueActions({ shuffleEnabled: true, filterHidesRows: true }), 2);

    expect(menu.filter((entry) => entry.type === "note")).toEqual([
      { type: "note", text: "Turn off Shuffle to change the order" },
    ]);
  });

  it("shows no note when the order can be changed", () => {
    expect(menuOf(buildQueueActions(), 2).some((entry) => entry.type === "note")).toBe(false);
  });

  it("disables all three actions while the playlist loads", () => {
    const menu = menuOf(buildQueueActions(), 2, { isPlaylistLoading: true });

    expect(disabledLabels(menu)).toEqual(["Play next", "Move up", "Move down"]);
  });

  it("recomputes Play next for the rows when the playing tune changes", () => {
    const queueActions = buildQueueActions();
    const stable = {
      handlePlaylistSelect: vi.fn(),
      onAttachLocalConfig: vi.fn(),
      onAttachUltimateConfig: vi.fn(),
      onOpenConfig: vi.fn(),
      onRemoveConfig: vi.fn(),
      startPlaylist: vi.fn(),
      playlistItemDuration: () => undefined,
      formatTime: () => "—:—",
      formatPlayCategory: () => "SID",
      formatBytes: () => "—",
      formatDate: () => "—",
      getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
      selectedPlaylistIds: new Set<string>(),
    };
    const { result, rerender } = renderHook(
      ({ playingId }: { playingId: string | null }) =>
        usePlaylistListItems({
          filteredPlaylist: playlist,
          playlist,
          ...stable,
          isPlaylistLoading: false,
          currentPlayingItemId: playingId,
          queueActions,
        }),
      { initialProps: { playingId: playlist[0].id as string | null } },
    );
    const thirdRowPlayNext = () =>
      queueEntries(result.current.filter((entry) => entry.variant !== "header")[2].menuItems ?? [])[0];

    expect(thirdRowPlayNext().disabled).toBe(false);

    rerender({ playingId: playlist[1].id });

    expect(thirdRowPlayNext().disabled).toBe(true);
  });
});
