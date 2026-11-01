/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  discoverConnection: vi.fn(async () => undefined),
  pinDemoModeByUserChoice: vi.fn(async () => undefined),
  transitionToOfflineNoDemo: vi.fn(async () => undefined),
}));

vi.mock("@/lib/connection/connectionManager", () => connection);

const startWith = async (mode: string | null) => {
  vi.resetModules();
  localStorage.clear();
  if (mode) localStorage.setItem("c64u_startup_mode", mode);
  const { startForStartupMode } = await import("@/lib/appMode/appModeTransitions");
  await startForStartupMode();
};

describe("startForStartupMode", () => {
  beforeEach(() => {
    connection.discoverConnection.mockClear();
    connection.pinDemoModeByUserChoice.mockClear();
  });

  it("SPM-FRST-02 sid-player start-up goes through the guarded startup discovery and asks nothing", async () => {
    await startWith("sid-player");
    expect(connection.discoverConnection).toHaveBeenCalledExactlyOnceWith("startup");
    expect(connection.pinDemoModeByUserChoice).not.toHaveBeenCalled();
  });

  it("SPM-FRST-03 demo start-up pins Demo Mode without probing", async () => {
    await startWith("demo");
    expect(connection.pinDemoModeByUserChoice).toHaveBeenCalledTimes(1);
    expect(connection.discoverConnection).not.toHaveBeenCalled();
  });

  it("SPM-FRST-03 default start-up runs startup discovery", async () => {
    await startWith(null);
    expect(connection.discoverConnection).toHaveBeenCalledExactlyOnceWith("startup");
    expect(connection.pinDemoModeByUserChoice).not.toHaveBeenCalled();
  });
});
