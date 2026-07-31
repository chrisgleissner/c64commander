/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidRadioChip } from "@/pages/playFiles/components/SidRadioChip";
import type { ActiveStation } from "@/pages/playFiles/hooks/useSidRadio";

const songStation: ActiveStation = {
  seedKind: "song",
  seedLabel: "Commando",
  styleBit: null,
  shuffleSeed: 42,
  rankingSnapshotId: "x",
};

describe("SidRadioChip", () => {
  it("names a Song station and Style station", () => {
    const { rerender } = render(<SidRadioChip station={songStation} onStop={vi.fn()} />);
    expect(screen.getByTestId("sid-radio-chip")).toHaveTextContent("Radio: Commando");
    rerender(
      <SidRadioChip
        station={{ ...songStation, seedKind: "style", seedLabel: "Fast-Paced", styleBit: 0 }}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sid-radio-chip")).toHaveTextContent("Fast-Paced Radio");
  });

  it("stops the station via the stop control", () => {
    const onStop = vi.fn();
    render(<SidRadioChip station={songStation} onStop={onStop} />);
    fireEvent.click(screen.getByTestId("sid-radio-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("expands the 'why this tune' provenance on tap", () => {
    render(<SidRadioChip station={songStation} whyThisTune="similar to Commando" onStop={vi.fn()} />);
    expect(screen.queryByTestId("sid-radio-why")).toBeNull();
    fireEvent.click(screen.getByTestId("sid-radio-chip-toggle"));
    expect(screen.getByTestId("sid-radio-why")).toHaveTextContent("similar to Commando");
  });

  /**
   * This row leads the Now Playing card, so it exists in both states and is the same height in
   * both. If it only appeared during a station, starting one would push the title, the transport
   * and the progress bar down the screen — and the transport is what people on this page hit
   * without looking.
   */
  it("names the playlist when no station is running, at the same height as a station", () => {
    const { rerender } = render(<SidRadioChip station={null} onStop={vi.fn()} />);

    const idleRow = screen.getByTestId("now-playing-source-idle");
    expect(screen.getByTestId("now-playing-source")).toHaveAttribute("data-station-active", "false");
    // Deliberately not the bare word "Playlist": the playlist panel below carries that as its
    // heading, and two identical labels one above the other both read as a mistake and made
    // `getByText("Playlist", { exact: true })` ambiguous for anything asserting on the panel.
    expect(idleRow).toHaveTextContent("Your playlist");
    expect(screen.queryByTestId("sid-radio-chip")).toBeNull();
    expect(screen.queryByTestId("sid-radio-stop")).toBeNull();
    const idleHeight = idleRow.className.match(/min-h-\[[^\]]+\]/)?.[0];
    expect(idleHeight).toBeDefined();

    rerender(<SidRadioChip station={songStation} onStop={vi.fn()} />);

    expect(screen.getByTestId("now-playing-source")).toHaveAttribute("data-station-active", "true");
    const activeRow = screen.getByTestId("sid-radio-chip").firstElementChild as HTMLElement;
    expect(activeRow.className).toContain(idleHeight as string);
  });

  it("sets the row apart with one rule rather than a box of its own", () => {
    // Calm: a tinted, rounded, bordered rectangle inside an already bordered card, above four
    // bordered transport buttons, was one competing edge too many. A single rule underneath says
    // "context above, content below" with far less ink.
    render(<SidRadioChip station={songStation} onStop={vi.fn()} />);

    const root = screen.getByTestId("now-playing-source");
    expect(root).toHaveClass("border-b");
    expect(root.className).not.toMatch(/\brounded-lg\b/);
    expect(root.className).not.toMatch(/bg-primary/);
  });

  it("gives Stop a word and a full-size target instead of a bare ×", () => {
    // It was a 28 px ghost ×, which is under the project's 40 px hit-target floor and reads as
    // "close this" rather than "end the station".
    render(<SidRadioChip station={songStation} onStop={vi.fn()} />);

    const stop = screen.getByTestId("sid-radio-stop");
    expect(stop).toHaveTextContent("Stop");
    expect(stop).toHaveClass("h-11");
    expect(stop.className).not.toMatch(/\bh-7\b|\bw-7\b/);
  });
});
