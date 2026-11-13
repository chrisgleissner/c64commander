/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BasicCommandsBar } from "@/components/remoteInput/BasicCommandsBar";

describe("BasicCommandsBar", () => {
  it("keeps the commands folded until asked, then names where they work", () => {
    render(<BasicCommandsBar onCommand={vi.fn()} />);
    expect(screen.queryByTestId("remote-input-basic-command-list")).toBeNull();

    fireEvent.click(screen.getByTestId("remote-input-basic-commands-toggle"));

    expect(screen.getByTestId("remote-input-basic-commands-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("remote-input-basic-commands-hint")).toHaveTextContent("These work at the BASIC prompt.");
  });

  it("sends the command whose button is pressed", () => {
    const onCommand = vi.fn();
    render(<BasicCommandsBar onCommand={onCommand} />);
    fireEvent.click(screen.getByTestId("remote-input-basic-commands-toggle"));

    fireEvent.click(screen.getByTestId("remote-input-basic-command-load-first-program"));

    expect(onCommand).toHaveBeenCalledWith({ id: "load-first-program", text: 'LOAD"*",8,1' });
  });
});
