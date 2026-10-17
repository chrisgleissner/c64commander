/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StationQueueEditedDialog } from "@/pages/playFiles/components/StationQueueEditedDialog";

const renderDialog = (stationTuneCount: number, playlistTuneCount: number | null) =>
  render(
    <StationQueueEditedDialog
      open
      stationTuneCount={stationTuneCount}
      playlistTuneCount={playlistTuneCount}
      onKeepStationTunes={vi.fn()}
      onReturnToPlaylist={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );

describe("StationQueueEditedDialog", () => {
  it("names what is kept and what comes back, with their sizes", () => {
    renderDialog(12, 40);
    const dialog = screen.getByTestId("station-queue-edited-dialog");
    expect(dialog.textContent).toContain("Keep the 12 tunes now queued");
    expect(dialog.textContent).toContain("put back your 40 tunes");
    expect(dialog.textContent).not.toContain("…");
  });

  it("draws the keep button with the normal text color and a title short enough for a compact dialog", () => {
    renderDialog(12, 40);
    expect(screen.getByTestId("station-queue-keep").className).toContain("text-foreground");
    expect(screen.getByText("Keep the radio tunes or your playlist?")).toBeInTheDocument();
  });

  it("uses the singular for one tune and describes an unread playlist without a count", () => {
    renderDialog(1, null);
    const dialog = screen.getByTestId("station-queue-edited-dialog");
    expect(dialog.textContent).toContain("Keep the 1 tune now queued");
    expect(dialog.textContent).toContain("the playlist you had before the station");
  });
});
