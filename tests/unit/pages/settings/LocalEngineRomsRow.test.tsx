/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/c64api", () => ({ getC64API: () => ({ fake: "api" }) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/roms/romFetchService", () => ({ fetchSystemRomsFromDevice: vi.fn() }));

import { addLog } from "@/lib/logging";
import { fetchSystemRomsFromDevice } from "@/lib/roms/romFetchService";
import { loadCharacterRomRead, saveCharacterRomRead } from "@/lib/config/characterRomSettings";
import { LocalEngineRomsRow } from "@/pages/settings/LocalEngineRomsRow";

const readFromDevice = async () => {
  fireEvent.click(screen.getByTestId("settings-roms-fetch"));
  await waitFor(() => expect(screen.getByTestId("settings-roms-result")).toBeInTheDocument());
};

describe("LocalEngineRomsRow reading from the machine", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchSystemRomsFromDevice).mockReset();
    vi.mocked(fetchSystemRomsFromDevice).mockResolvedValue({ ok: true, outcomes: [] });
  });

  it("labels the capture with the connected host and does not ask for the character ROM by default", async () => {
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);
    await readFromDevice();
    expect(fetchSystemRomsFromDevice).toHaveBeenCalledWith({ fake: "api" }, "c64u.local", {
      includeCharacterRom: false,
    });
  });

  it("labels the capture 'connected C64' when no host is known", async () => {
    render(<LocalEngineRomsRow deviceHost="" />);
    await readFromDevice();
    expect(fetchSystemRomsFromDevice).toHaveBeenCalledWith({ fake: "api" }, "connected C64", {
      includeCharacterRom: false,
    });
  });

  it("offers the character ROM read as a switch that is off until the user turns it on", () => {
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);

    expect(screen.getByTestId("settings-roms-read-chargen")).toHaveAttribute("aria-checked", "false");
  });

  it("warns beside the switch that the read pauses the C64 and may disturb a program that uses NMIs", () => {
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);

    const row = screen.getByTestId("settings-roms-read-chargen-row");
    expect(row).toHaveTextContent(/character ROM/);
    expect(row).toHaveTextContent(/pauses the C64 briefly/);
    expect(row).toHaveTextContent(/may disturb a program that uses NMIs/);
  });

  it("asks for the character ROM once the user has turned the switch on, and remembers the choice", async () => {
    const { unmount } = render(<LocalEngineRomsRow deviceHost="c64u.local" />);
    fireEvent.click(screen.getByTestId("settings-roms-read-chargen"));
    expect(loadCharacterRomRead()).toBe(true);

    await readFromDevice();
    expect(fetchSystemRomsFromDevice).toHaveBeenCalledWith({ fake: "api" }, "c64u.local", {
      includeCharacterRom: true,
    });

    unmount();
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);
    expect(screen.getByTestId("settings-roms-read-chargen")).toHaveAttribute("aria-checked", "true");
  });

  it("stops asking for the character ROM when the user turns the switch off again", async () => {
    saveCharacterRomRead(true);
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);
    fireEvent.click(screen.getByTestId("settings-roms-read-chargen"));

    await readFromDevice();

    expect(fetchSystemRomsFromDevice).toHaveBeenCalledWith({ fake: "api" }, "c64u.local", {
      includeCharacterRom: false,
    });
  });

  it("shows the message and logs a warning when reading throws an Error", async () => {
    vi.mocked(fetchSystemRomsFromDevice).mockRejectedValue(new Error("device unreachable"));
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);

    await readFromDevice();

    expect(screen.getByTestId("settings-roms-result")).toHaveTextContent("kernal: device unreachable");
    expect(addLog).toHaveBeenCalledWith("warn", "Reading the C64 ROMs failed", {
      error: "Error: device unreachable",
    });
    expect(screen.getByTestId("settings-roms-fetch")).not.toBeDisabled();
  });

  it("shows the text of a failure that is not an Error", async () => {
    vi.mocked(fetchSystemRomsFromDevice).mockRejectedValue("socket closed");
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);

    await readFromDevice();

    expect(screen.getByTestId("settings-roms-result")).toHaveTextContent("kernal: socket closed");
  });
});
