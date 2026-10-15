/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePlaylistListItems, type PlaylistListItemsOptions } from "@/pages/playFiles/hooks/usePlaylistListItems";
import type { ActionListItem } from "@/components/lists/SelectableActionList";
import type { PlaylistItem } from "@/pages/playFiles/types";

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  beginHvscPerfScope: vi.fn(() => ({})),
  endHvscPerfScope: vi.fn(),
}));
vi.mock("@/lib/smoke/smokeMode", () => ({ recordSmokeBenchmarkSnapshot: vi.fn() }));

const buildItem = (index: number): PlaylistItem => ({
  id: `ultimate:/Music/Track_${index}.sid`,
  request: { source: "ultimate", path: `/Music/Track_${index}.sid` },
  category: "sid",
  label: `Track_${index}.sid`,
  path: `/Music/Track_${index}.sid`,
  configRef: null,
  addedAt: "2026-02-12T00:00:00.000Z",
  status: "ready",
  unavailableReason: null,
});

const playlist = Array.from({ length: 6 }, (_, index) => buildItem(index));

/** Stable identities, as PlayFilesPage passes them, so only what a test changes differs between renders. */
const baseOptions: PlaylistListItemsOptions = {
  filteredPlaylist: playlist.slice(0, 2),
  playlist,
  selectedPlaylistIds: new Set<string>(),
  isPlaylistLoading: false,
  handlePlaylistSelect: vi.fn(),
  onAttachLocalConfig: vi.fn(),
  onAttachUltimateConfig: vi.fn(),
  onOpenConfig: vi.fn(),
  onRemoveConfig: vi.fn(),
  startPlaylist: vi.fn(),
  playlistItemDuration: () => 60_000,
  formatTime: (ms?: number) => (ms === undefined ? "—" : `${ms / 1000}s`),
  formatPlayCategory: () => "SID",
  formatBytes: () => "—",
  formatDate: () => "—",
  getParentPath: () => "/Music",
  currentPlayingItemId: null,
};

const rowsById = (rows: ActionListItem[]) => new Map(rows.map((row) => [row.id, row]));
const detail = (row: ActionListItem | undefined, label: string) =>
  row?.menuItems?.find((entry) => entry.type === "info" && entry.label === label);

const renderRows = () =>
  renderHook((options: PlaylistListItemsOptions) => usePlaylistListItems(options), { initialProps: baseOptions });

describe("usePlaylistListItems row reuse", () => {
  it("keeps the row objects of items already shown when the next page of the list loads", () => {
    const { result, rerender } = renderRows();
    const firstPage = rowsById(result.current);

    rerender({ ...baseOptions, filteredPlaylist: playlist.slice(0, 4) });
    const secondPage = rowsById(result.current);

    for (const item of playlist.slice(0, 2)) expect(secondPage.get(item.id)).toBe(firstPage.get(item.id));
    expect(secondPage.get(playlist[3].id)?.title).toBe("Track 3");
    expect(secondPage.get("folder:/Music:" + playlist[0].id)).toBe(firstPage.get("folder:/Music:" + playlist[0].id));
  });

  it("rebuilds only the row whose selection changed", () => {
    const { result, rerender } = renderRows();
    const before = rowsById(result.current);

    rerender({ ...baseOptions, selectedPlaylistIds: new Set([playlist[1].id]) });
    const after = rowsById(result.current);

    expect(after.get(playlist[1].id)).not.toBe(before.get(playlist[1].id));
    expect(after.get(playlist[1].id)?.selected).toBe(true);
    expect(after.get(playlist[0].id)).toBe(before.get(playlist[0].id));
  });

  it("moves the playing highlight from one row to another", () => {
    const { result, rerender } = renderRows();
    rerender({ ...baseOptions, currentPlayingItemId: playlist[0].id });
    expect(rowsById(result.current).get(playlist[0].id)?.isPlaying).toBe(true);

    rerender({ ...baseOptions, currentPlayingItemId: playlist[1].id });
    const rows = rowsById(result.current);
    expect(rows.get(playlist[0].id)?.isPlaying).toBe(false);
    expect(rows.get(playlist[1].id)?.isPlaying).toBe(true);
  });

  it("shows a new duration when an item's length becomes known", () => {
    const lengths = new Map<string, number>();
    const playlistItemDuration = (item: PlaylistItem) => lengths.get(item.id) ?? 60_000;
    const { result, rerender } = renderRows();
    rerender({ ...baseOptions, playlistItemDuration });
    expect(detail(rowsById(result.current).get(playlist[0].id), "Duration")).toMatchObject({ value: "60s" });

    lengths.set(playlist[0].id, 125_000);
    rerender({ ...baseOptions, playlistItemDuration, filteredPlaylist: playlist.slice(0, 3) });
    expect(detail(rowsById(result.current).get(playlist[0].id), "Duration")).toMatchObject({ value: "125s" });
  });

  it("shows an attached config once the item carries it", () => {
    const { result, rerender } = renderRows();
    const withConfig: PlaylistItem = {
      ...playlist[0],
      configRef: { kind: "local", fileName: "track.cfg", path: "/Music/track.cfg", sourceId: "local" },
    };

    rerender({ ...baseOptions, filteredPlaylist: [withConfig, playlist[1]] });
    const row = rowsById(result.current).get(playlist[0].id);
    expect(detail(row, "Attached")).toMatchObject({ value: "track.cfg" });
    expect(row?.secondaryActionLabel).toBe("CFG");
  });

  it("rebuilds every row when the playlist itself changes, so play starts from the item's new place", () => {
    const startPlaylist = vi.fn();
    const { result, rerender } = renderRows();
    const before = rowsById(result.current);
    const reordered = [playlist[1], playlist[0], ...playlist.slice(2)];

    rerender({ ...baseOptions, startPlaylist, playlist: reordered, filteredPlaylist: reordered.slice(0, 2) });
    const after = rowsById(result.current);
    expect(after.get(playlist[0].id)).not.toBe(before.get(playlist[0].id));
    after.get(playlist[0].id)?.onAction?.();
    expect(startPlaylist).toHaveBeenCalledWith(reordered, 1);
  });

  it("plays from the current playlist after items are added to it", () => {
    const startPlaylist = vi.fn();
    const { result, rerender } = renderHook((options: PlaylistListItemsOptions) => usePlaylistListItems(options), {
      initialProps: { ...baseOptions, startPlaylist },
    });
    const grown = [...playlist, buildItem(6)];

    rerender({ ...baseOptions, startPlaylist, playlist: grown });
    rowsById(result.current).get(playlist[0].id)?.onAction?.();
    expect(startPlaylist).toHaveBeenCalledWith(grown, 0);
  });

  it("disables every row's actions while the playlist is loading", () => {
    const { result, rerender } = renderRows();
    rerender({ ...baseOptions, isPlaylistLoading: true });
    expect(result.current.filter((row) => row.variant !== "header").every((row) => row.disableActions)).toBe(true);
  });
});
