/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSystemRoms, resetSystemRomFetchForTests } from "@/lib/roms/ensureSystemRoms";
import { effectiveSidEmulationEngine, saveLocalEngineAutoRoms, saveSidEmulationEngine } from "@/lib/config/appSettings";
import { hasCompleteRomSet } from "@/lib/roms/romStore";
import { fetchSystemRomsFromDevice } from "@/lib/roms/romFetchService";

vi.mock("@/lib/c64api", () => ({ getC64API: () => ({}) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/roms/romFetchService", () => ({ fetchSystemRomsFromDevice: vi.fn() }));
vi.mock("@/lib/roms/romStore", () => ({ hasCompleteRomSet: vi.fn(() => false) }));

describe("reading the C64 ROMs without being asked", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSystemRomFetchForTests();
    vi.mocked(hasCompleteRomSet).mockReturnValue(false);
    vi.mocked(fetchSystemRomsFromDevice).mockReset();
  });

  it("is on by default, because the alternative is silence", () => {
    // The images cannot be shipped, the accurate engine cannot render a note without them, and
    // nothing else fetched them — so a fresh install that chose "listen on this device" produced
    // silence with no error and no notice.
    vi.mocked(fetchSystemRomsFromDevice).mockResolvedValue({ outcomes: [] } as never);
    return ensureSystemRoms().then(() => {
      expect(fetchSystemRomsFromDevice).toHaveBeenCalled();
    });
  });

  it("does nothing when the user has turned it off", async () => {
    saveLocalEngineAutoRoms(false);
    await ensureSystemRoms();
    expect(fetchSystemRomsFromDevice).not.toHaveBeenCalled();
  });

  it("does not ask again once the images are in hand", async () => {
    vi.mocked(hasCompleteRomSet).mockReturnValue(true);
    await ensureSystemRoms();
    expect(fetchSystemRomsFromDevice).not.toHaveBeenCalled();
  });

  it("asks once per session, not once per tune, after a failure", async () => {
    // A machine that will not give up its ROMs will not give them up on the next track either, and
    // retrying would put a failed network round trip in front of every play for the rest of the
    // session.
    vi.mocked(fetchSystemRomsFromDevice).mockRejectedValue(new Error("no route to host"));
    await ensureSystemRoms();
    await ensureSystemRoms();
    await ensureSystemRoms();
    expect(fetchSystemRomsFromDevice).toHaveBeenCalledTimes(1);
  });

  it("never throws, because a tune must still play", async () => {
    vi.mocked(fetchSystemRomsFromDevice).mockRejectedValue(new Error("boom"));
    await expect(ensureSystemRoms()).resolves.toBe(false);
  });
});

describe("which emulation actually runs", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the chosen emulation when the ROMs are missing", () => {
    // This used to return SIDLite, on the reasoning that "reSIDfp initialises a tune and then never
    // advances it without the real images" and that "SIDLite carries its own playback". Both are
    // false. SIDLite is a SID *chip* model plugged into the same libsidplayfp C64 -- no CPU, no
    // memory map, no ROM substitute -- and the two WASM builds differ by one compiler flag.
    //
    // Measured on libsidplayfp-wasm 1.0.1 with null images: reSIDfp renders `tone-ladder.sid` with
    // a per-second RMS of -22.8, -23.0, -23.0, -23.0, -24.1, -22.2, -23.0, -23.1 dB across eight
    // seconds. That is a tune advancing through its notes, not a drone.
    //
    // So the ROM state says nothing about which chip model to use, and swapping it silently gave a
    // listener whose ROM capture had not succeeded a different timbre with no way to know why.
    saveSidEmulationEngine("residfp");
    expect(effectiveSidEmulationEngine(false)).toBe("residfp");
  });

  it("uses the chosen emulation once the ROMs are there", () => {
    saveSidEmulationEngine("residfp");
    expect(effectiveSidEmulationEngine(true)).toBe("residfp");
  });

  it("leaves a deliberate SIDLite choice alone", () => {
    saveSidEmulationEngine("sidlite");
    expect(effectiveSidEmulationEngine(true)).toBe("sidlite");
  });
});
