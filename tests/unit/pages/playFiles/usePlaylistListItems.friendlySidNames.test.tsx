/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlaylistListItems, type PlaylistListItemsOptions } from "@/pages/playFiles/hooks/usePlaylistListItems";
import { saveFriendlySidNames } from "@/lib/config/appSettings";
import type { PlaylistItem } from "@/pages/playFiles/types";

const sidItem: PlaylistItem = {
  id: "hvsc:/MUSICIANS/H/Hubbard_Rob/Bossa_in_Do_2SID.sid",
  request: { source: "hvsc", path: "/MUSICIANS/H/Hubbard_Rob/Bossa_in_Do_2SID.sid" },
  category: "sid",
  label: "Bossa_in_Do_2SID.sid",
  path: "/MUSICIANS/H/Hubbard_Rob/Bossa_in_Do_2SID.sid",
};

const singleChipSidItem: PlaylistItem = {
  id: "hvsc:/MUSICIANS/H/Hubbard_Rob/COMMANDO.sid",
  request: { source: "hvsc", path: "/MUSICIANS/H/Hubbard_Rob/COMMANDO.sid" },
  category: "sid",
  label: "COMMANDO.sid",
  path: "/MUSICIANS/H/Hubbard_Rob/COMMANDO.sid",
};

const prgItem: PlaylistItem = {
  id: "local:/Games/Some_Great_Game.prg",
  request: { source: "local", path: "/Games/Some_Great_Game.prg" },
  category: "prg",
  label: "Some_Great_Game.prg",
  path: "/Games/Some_Great_Game.prg",
};

const buildOptions = (playlist: PlaylistItem[]): PlaylistListItemsOptions => ({
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
  playlistItemDuration: () => 180_000,
  formatTime: () => "3:00",
  formatPlayCategory: (category) => category.toUpperCase(),
  formatBytes: () => "1 KB",
  formatDate: () => "2026-07-30",
  getParentPath: (value) => value.slice(0, value.lastIndexOf("/")),
  currentPlayingItemId: null,
});

const rowsOf = (items: ReturnType<typeof usePlaylistListItems>) => items.filter((item) => item.variant !== "header");

describe("usePlaylistListItems friendly SID names", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows a SID under its friendly name and badges its chip count by default", () => {
    const { result } = renderHook(() => usePlaylistListItems(buildOptions([sidItem])));

    const [row] = rowsOf(result.current);
    expect(row.title).toBe("Bossa in Do");
    // The raw path is still what the row carries underneath, so nothing that keys off it moves.
    expect(row.subtitle).toBe("/MUSICIANS/H/Hubbard_Rob/Bossa_in_Do_2SID.sid");
    expect(row.id).toBe(sidItem.id);

    render(<>{row.meta}</>);
    expect(screen.getByTestId("sid-chip-badge-2")).toHaveTextContent("2SID");
  });

  it("title-cases a shouted name and draws no badge for a single-chip tune", () => {
    const { result } = renderHook(() => usePlaylistListItems(buildOptions([singleChipSidItem])));

    const [row] = rowsOf(result.current);
    expect(row.title).toBe("Commando");
    // Every tune here is a SID, so a one-chip marker on nearly every row is noise. The badge is for
    // the rare tune that needs a second or third chip and nothing else.
    const { container } = render(<>{row.meta}</>);
    expect(container.querySelector("[data-testid^='sid-chip-badge-']")).toBeNull();
  });

  it("shows the file name and no badge once the preference is turned off", () => {
    const { result } = renderHook(() => usePlaylistListItems(buildOptions([sidItem])));

    act(() => saveFriendlySidNames(false));

    const [row] = rowsOf(result.current);
    expect(row.title).toBe("Bossa_in_Do_2SID.sid");
    render(<>{row.meta}</>);
    expect(screen.queryByTestId("sid-chip-badge-2")).toBeNull();
  });

  it("leaves a PRG row exactly as it was, whatever the preference says", () => {
    const { result, rerender } = renderHook(() => usePlaylistListItems(buildOptions([prgItem])));
    expect(rowsOf(result.current)[0].title).toBe("Some_Great_Game.prg");

    act(() => saveFriendlySidNames(false));
    rerender();
    expect(rowsOf(result.current)[0].title).toBe("Some_Great_Game.prg");
  });
});
