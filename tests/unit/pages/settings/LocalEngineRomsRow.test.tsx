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

  it("labels the capture with the connected host and asks for the character ROM too", async () => {
    render(<LocalEngineRomsRow deviceHost="c64u.local" />);
    await readFromDevice();
    expect(fetchSystemRomsFromDevice).toHaveBeenCalledWith({ fake: "api" }, "c64u.local", {
      includeCharacterRom: true,
    });
  });

  it("labels the capture 'connected C64' when no host is known", async () => {
    render(<LocalEngineRomsRow deviceHost="" />);
    await readFromDevice();
    expect(fetchSystemRomsFromDevice).toHaveBeenCalledWith({ fake: "api" }, "connected C64", {
      includeCharacterRom: true,
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
