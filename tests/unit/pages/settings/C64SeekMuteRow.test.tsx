/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { loadC64SeekMute } from "@/lib/config/appSettings";
import { C64SeekMuteRow } from "@/pages/settings/C64SeekMuteRow";

describe("C64SeekMuteRow", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the saved choice, Rewind only by default, and says phone playback is silent anyway", () => {
    render(<C64SeekMuteRow />);
    expect(screen.getByTestId("settings-c64-seek-mute")).toHaveTextContent("Rewind only");
    expect(screen.getByText(/Playback on your phone is silent while it seeks/)).toBeInTheDocument();
  });

  it("saves the choice the user makes", async () => {
    render(<C64SeekMuteRow />);
    fireEvent.click(screen.getByTestId("settings-c64-seek-mute"));
    fireEvent.click(await screen.findByRole("option", { name: "Always" }));
    expect(loadC64SeekMute()).toBe("always");
    expect(screen.getByTestId("settings-c64-seek-mute")).toHaveTextContent("Always");
  });
});
