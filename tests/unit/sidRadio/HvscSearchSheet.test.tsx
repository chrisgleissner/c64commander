/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HvscSearchSheet } from "@/pages/playFiles/components/HvscSearchSheet";
import { searchHvscSongs } from "@/lib/hvsc";

vi.mock("@/lib/hvsc", () => ({ searchHvscSongs: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

/**
 * Reaching for one particular tune while a station is running.
 *
 * A station is endless and chooses for you, which is the point of it right up until you want to hear
 * one specific thing. Before this the only route was: stop the station, open the picker, drill down
 * through the composer folders to a tune you could already name, add it, and lose the station.
 */

const hit = (virtualPath: string, canonicalTitle: string, canonicalAuthor: string | null = null) => ({
  virtualPath,
  fileName: virtualPath.split("/").pop(),
  canonicalTitle,
  canonicalAuthor,
});

const answerWith = (songs: unknown[], totalSongs = songs.length) =>
  vi.mocked(searchHvscSongs).mockResolvedValue({ songs, totalSongs, offset: 0, limit: 100, query: "q" } as never);

const renderSheet = (props: Partial<React.ComponentProps<typeof HvscSearchSheet>> = {}) =>
  render(
    <HvscSearchSheet open onOpenChange={vi.fn()} onPlay={vi.fn()} onStartStation={vi.fn()} stationActive {...props} />,
  );

const type = (value: string) => fireEvent.change(screen.getByTestId("hvsc-search-input"), { target: { value } });

describe("HvscSearchSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches the whole archive, not a folder", async () => {
    answerWith([hit("/MUSICIANS/H/Hubbard_Rob/Commando.sid", "Commando", "Rob Hubbard")]);
    renderSheet();

    type("commando");

    await waitFor(() => expect(searchHvscSongs).toHaveBeenCalled());
    // No path scope: the search covers the archive.
    expect(vi.mocked(searchHvscSongs).mock.calls[0]?.[0]).toMatchObject({ query: "commando" });
    expect(vi.mocked(searchHvscSongs).mock.calls[0]?.[0]).not.toHaveProperty("path");
  });

  it("shows the composer and the folder, because two composers can both have a Theme", async () => {
    answerWith([hit("/MUSICIANS/H/Hubbard_Rob/Commando.sid", "Commando", "Rob Hubbard")]);
    renderSheet();

    type("commando");

    await waitFor(() => expect(screen.getByTestId("hvsc-search-row")).toBeTruthy());
    const row = screen.getByTestId("hvsc-search-row");
    expect(row.textContent).toContain("Commando");
    expect(row.textContent).toContain("Rob Hubbard");
    expect(row.textContent).toContain("/MUSICIANS/H/Hubbard_Rob");
  });

  it("plays the tune that was tapped, and closes", async () => {
    answerWith([hit("/MUSICIANS/H/Hubbard_Rob/Commando.sid", "Commando")]);
    const onPlay = vi.fn();
    const onOpenChange = vi.fn();
    renderSheet({ onPlay, onOpenChange });

    type("commando");
    await waitFor(() => expect(screen.getByTestId("hvsc-search-play")).toBeTruthy());
    fireEvent.click(screen.getByTestId("hvsc-search-play"));

    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({ virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", title: "Commando" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("can seed a new station from what was found", async () => {
    answerWith([hit("/MUSICIANS/H/Hubbard_Rob/Commando.sid", "Commando")]);
    const onStartStation = vi.fn();
    renderSheet({ onStartStation });

    type("commando");
    await waitFor(() => expect(screen.getByTestId("hvsc-search-start-station")).toBeTruthy());
    fireEvent.click(screen.getByTestId("hvsc-search-start-station"));

    expect(onStartStation).toHaveBeenCalledWith(expect.objectContaining({ title: "Commando" }));
  });

  it("hides the station action for a tune the corpus does not know", async () => {
    // Such a tune plays perfectly well; it just cannot be the seed of a similarity walk. Offering
    // the action and then failing would be worse than not offering it.
    answerWith([hit("/PRIVATE/Unknown.sid", "Unknown")]);
    renderSheet({ canSeedStation: () => false });

    type("unknown");
    await waitFor(() => expect(screen.getByTestId("hvsc-search-row")).toBeTruthy());

    expect(screen.queryByTestId("hvsc-search-start-station")).toBeNull();
  });

  it("says the index is not ready rather than claiming the tune does not exist", async () => {
    vi.mocked(searchHvscSongs).mockResolvedValue(null);
    renderSheet();

    type("commando");

    await waitFor(() => expect(screen.getByTestId("hvsc-search-unavailable")).toBeTruthy());
    expect(screen.queryByTestId("hvsc-search-empty")).toBeNull();
  });

  it("reports that results were capped, so a listener knows to narrow the search", async () => {
    answerWith([hit("/A/one.sid", "One")], 4321);
    renderSheet();

    type("a");

    await waitFor(() => expect(screen.getByTestId("hvsc-search-count").textContent).toContain("4321"));
  });

  it("does not search an empty box", async () => {
    renderSheet();

    type("commando");
    type("");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(searchHvscSongs).not.toHaveBeenCalled();
  });

  it("coalesces a burst of typing into one search", async () => {
    answerWith([hit("/A/one.sid", "One")]);
    renderSheet();

    type("c");
    type("co");
    type("com");
    type("comm");

    await waitFor(() => expect(searchHvscSongs).toHaveBeenCalledTimes(1));
    expect(vi.mocked(searchHvscSongs).mock.calls[0]?.[0]).toMatchObject({ query: "comm" });
  });

  it("says the station keeps its place, so playing a tune does not read as ending it", () => {
    renderSheet({ stationActive: true });

    expect(screen.getByTestId("hvsc-search-sheet").textContent).toContain("carries on");
  });
});
