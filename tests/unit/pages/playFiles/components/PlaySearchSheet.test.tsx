/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { searchHvscSongs } from "@/lib/hvsc";
import { PlaySearchSheet, type PlaySearchSheetProps } from "@/pages/playFiles/components/PlaySearchSheet";
import type { PlaylistItem } from "@/pages/playFiles/types";

vi.mock("@/lib/hvsc", () => ({ searchHvscSongs: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

const song = (virtualPath: string, canonicalTitle: string) => ({
  virtualPath,
  fileName: virtualPath.split("/").pop(),
  canonicalTitle,
  canonicalAuthor: "Rob Hubbard",
});

const queued = (id: string): PlaylistItem => ({
  id,
  request: { source: "hvsc", path: `/MUSICIANS/X/${id}.sid`, songNr: 1 },
  category: "sid",
  label: `${id}.sid`,
  path: `/MUSICIANS/X/${id}.sid`,
});

const answerWith = (songs: unknown[]) =>
  vi
    .mocked(searchHvscSongs)
    .mockResolvedValue({ songs, totalSongs: songs.length, offset: 0, limit: 100, query: "hubbard" } as never);

const renderSheet = (props: Partial<PlaySearchSheetProps> = {}) => {
  const startPlaylist = vi.fn().mockResolvedValue(true);
  const onOpenChange = vi.fn();
  render(
    <PlaySearchSheet
      open
      onOpenChange={onOpenChange}
      initialQuery={null}
      playlist={[queued("a"), queued("b"), queued("c")]}
      currentIndex={0}
      startPlaylist={startPlaylist}
      startSongRadio={vi.fn().mockResolvedValue(undefined)}
      stationActive={false}
      {...props}
    />,
  );
  return { startPlaylist, onOpenChange };
};

const search = async () => {
  fireEvent.change(screen.getByTestId("hvsc-search-input"), { target: { value: "hubbard" } });
  await waitFor(() => expect(screen.getByTestId("hvsc-search-play-all")).toBeTruthy());
};

describe("PlaySearchSheet play all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("inserts every hit after the current tune in ranked order and starts the first of them", async () => {
    answerWith([
      song("/MUSICIANS/H/Hubbard_Rob/Commando.sid", "Commando"),
      song("/MUSICIANS/H/Hubbard_Rob/Monty.sid", "Monty"),
      song("/MUSICIANS/H/Hubbard_Rob/Crazy_Comets.sid", "Crazy Comets"),
    ]);
    const { startPlaylist, onOpenChange } = renderSheet();

    await search();
    fireEvent.click(screen.getByTestId("hvsc-search-play-all"));

    expect(startPlaylist).toHaveBeenCalledTimes(1);
    const [items, index, options] = startPlaylist.mock.calls[0] as [PlaylistItem[], number, unknown];
    expect(items.map((item) => item.path)).toEqual([
      "/MUSICIANS/X/a.sid",
      "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
      "/MUSICIANS/H/Hubbard_Rob/Monty.sid",
      "/MUSICIANS/H/Hubbard_Rob/Crazy_Comets.sid",
      "/MUSICIANS/X/b.sid",
      "/MUSICIANS/X/c.sid",
    ]);
    expect(index).toBe(1);
    expect(options).toEqual({ replaceQueue: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("gives two identical hits distinct ids, so they stay two playlist rows", async () => {
    answerWith([
      song("/MUSICIANS/H/Hubbard_Rob/Commando.sid", "Commando"),
      song("/MUSICIANS/H/Hubbard_Rob/Commando.sid", "Commando"),
    ]);
    const { startPlaylist } = renderSheet();

    await search();
    fireEvent.click(screen.getByTestId("hvsc-search-play-all"));

    const items = (startPlaylist.mock.calls[0] as [PlaylistItem[]])[0];
    expect(items.filter((item) => item.path === "/MUSICIANS/H/Hubbard_Rob/Commando.sid")).toHaveLength(2);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("starts at the head of an empty playlist when nothing is queued", async () => {
    answerWith([song("/A/one.sid", "One"), song("/A/two.sid", "Two")]);
    const { startPlaylist } = renderSheet({ playlist: [], currentIndex: -1 });

    await search();
    fireEvent.click(screen.getByTestId("hvsc-search-play-all"));

    const [items, index] = startPlaylist.mock.calls[0] as [PlaylistItem[], number];
    expect(items.map((item) => item.path)).toEqual(["/A/one.sid", "/A/two.sid"]);
    expect(index).toBe(0);
  });

  it("plays the hits next while a station runs, leaving the station's queue behind them", async () => {
    answerWith([song("/A/one.sid", "One"), song("/A/two.sid", "Two")]);
    const { startPlaylist } = renderSheet({ stationActive: true, currentIndex: 1 });

    await search();
    fireEvent.click(screen.getByTestId("hvsc-search-play-all"));

    const [items, index, options] = startPlaylist.mock.calls[0] as [PlaylistItem[], number, unknown];
    expect(items.map((item) => item.path)).toEqual([
      "/MUSICIANS/X/a.sid",
      "/MUSICIANS/X/b.sid",
      "/A/one.sid",
      "/A/two.sid",
      "/MUSICIANS/X/c.sid",
    ]);
    expect(index).toBe(2);
    expect(options).toEqual({ replaceQueue: true });
  });
});
