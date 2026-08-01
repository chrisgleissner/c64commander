/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureStilReady = vi.fn(async () => true);
const getHvscSubsongTitles = vi.fn(async () => [] as string[]);
const getHvscSubsongDurationsSeconds = vi.fn(async () => [] as number[]);

vi.mock("@/lib/hvsc", () => ({
  ensureStilReady: (...args: unknown[]) => ensureStilReady(...(args as [])),
  getHvscSubsongTitles: (...args: unknown[]) => getHvscSubsongTitles(...(args as [])),
  getHvscSubsongDurationsSeconds: (...args: unknown[]) => getHvscSubsongDurationsSeconds(...(args as [])),
}));

import { TuneListSheet } from "@/pages/playFiles/components/TuneListSheet";

const renderSheet = (overrides: Partial<React.ComponentProps<typeof TuneListSheet>> = {}) =>
  render(
    <TuneListSheet
      open
      onOpenChange={vi.fn()}
      fileLabel="Commando"
      virtualPath="/MUSICIANS/H/Hubbard_Rob/Commando.sid"
      tuneCount={3}
      currentSongNr={1}
      onSelectTune={vi.fn()}
      {...overrides}
    />,
  );

describe("TuneListSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHvscSubsongTitles.mockResolvedValue([]);
    getHvscSubsongDurationsSeconds.mockResolvedValue([]);
  });

  it("lists every tune in the file, numbered", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getAllByTestId("tune-list-row")).toHaveLength(3));
    expect(screen.getAllByTestId("tune-list-row").map((row) => row.textContent)).toEqual([
      "Tune 1",
      "Tune 2",
      "Tune 3",
    ]);
  });

  it("names and times the tunes the archive knows about", async () => {
    getHvscSubsongTitles.mockResolvedValue(["BGM1", "", "Level Complete"]);
    getHvscSubsongDurationsSeconds.mockResolvedValue([350, 12, 164]);
    renderSheet();
    await waitFor(() => expect(screen.getAllByTestId("tune-list-row")[0]).toHaveTextContent("BGM1"));

    const rows = screen.getAllByTestId("tune-list-row");
    expect(rows[0]).toHaveTextContent("Tune 1 · BGM1");
    expect(rows[0]).toHaveTextContent("5:50");
    // STIL names a minority of tunes; an unnamed one is still a row worth having.
    expect(rows[1]).toHaveTextContent("Tune 2");
    expect(rows[1]).not.toHaveTextContent("·");
    expect(rows[2]).toHaveTextContent("Tune 3 · Level Complete");
  });

  it("leaves an unknown length blank rather than showing the default", async () => {
    // An unresolved duration falls back to three minutes at playback time. Printing that here would
    // be a wrong number where no number is the truth.
    getHvscSubsongTitles.mockResolvedValue(["A", "B", "C"]);
    getHvscSubsongDurationsSeconds.mockResolvedValue([350]);
    renderSheet();
    await waitFor(() => expect(screen.getAllByTestId("tune-list-row")[0]).toHaveTextContent("5:50"));
    expect(screen.getAllByTestId("tune-list-row")[1]).not.toHaveTextContent(":");
  });

  it("says which tune is playing", async () => {
    renderSheet({ currentSongNr: 2 });
    await waitFor(() => expect(screen.getAllByTestId("tune-list-row")).toHaveLength(3));
    const rows = screen.getAllByTestId("tune-list-row");
    expect(rows[1]).toHaveAttribute("data-current", "true");
    expect(rows[0]).not.toHaveAttribute("data-current");
  });

  it("plays the tune that was tapped", async () => {
    const onSelectTune = vi.fn();
    renderSheet({ onSelectTune });
    await waitFor(() => expect(screen.getAllByTestId("tune-list-row")).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId("tune-list-row")[2]!);
    expect(onSelectTune).toHaveBeenCalledWith(3);
  });

  it("still lists the tunes for a file that is not from the archive", async () => {
    // A file from a device or a local folder holds its tunes just the same and they play just the
    // same. Only the names and the lengths live in HVSC, so only those are missing.
    const onSelectTune = vi.fn();
    renderSheet({ virtualPath: null, onSelectTune });
    await waitFor(() => expect(screen.getAllByTestId("tune-list-row")).toHaveLength(3));
    expect(getHvscSubsongTitles).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTestId("tune-list-row")[1]!);
    expect(onSelectTune).toHaveBeenCalledWith(2);
  });

  it("keeps the numbered rows when the lookup fails", async () => {
    getHvscSubsongTitles.mockRejectedValue(new Error("index unavailable"));
    renderSheet();
    await waitFor(() => expect(screen.getAllByTestId("tune-list-row")).toHaveLength(3));
  });
});
