/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";

import { beginHvscInstallGuard, endHvscInstallGuard } from "@/lib/hvsc/hvscInstallGuard";
import { LibraryInstall } from "@/lib/native/libraryInstall";
import { addLog } from "@/lib/logging";

vi.mock("@capacitor/core", () => ({
  registerPlugin: vi.fn(() => ({})),
  Capacitor: { isPluginAvailable: vi.fn(() => true) },
}));

vi.mock("@/lib/native/libraryInstall", () => ({
  LIBRARY_INSTALL_PLUGIN_NAME: "LibraryInstall",
  LibraryInstall: {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const warnings = () => vi.mocked(addLog).mock.calls.filter(([level]) => level === "warn" || level === "error");

describe("hvscInstallGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
  });

  it("starts and stops the foreground service when the plugin is present", async () => {
    await beginHvscInstallGuard();
    expect(LibraryInstall.start).toHaveBeenCalledTimes(1);

    await endHvscInstallGuard();
    expect(LibraryInstall.stop).toHaveBeenCalledTimes(1);
  });

  it("asks the platform for the plugin by name rather than assuming every native build has it", async () => {
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);

    await beginHvscInstallGuard();
    await endHvscInstallGuard();

    expect(Capacitor.isPluginAvailable).toHaveBeenCalledWith("LibraryInstall");
    expect(LibraryInstall.start).not.toHaveBeenCalled();
    expect(LibraryInstall.stop).not.toHaveBeenCalled();
  });

  it("does not fail the install when the platform refuses the foreground service", async () => {
    vi.mocked(LibraryInstall.start).mockRejectedValueOnce(
      new Error("startForegroundService() not allowed due to mAllowStartForeground false"),
    );

    await expect(beginHvscInstallGuard()).resolves.toBeUndefined();

    const [level, message, details] = warnings()[0];
    expect(level).toBe("warn");
    expect(message).toMatch(/without a foreground service/i);
    expect(details).toMatchObject({ error: expect.stringContaining("mAllowStartForeground") });
  });

  it("reports a release failure instead of swallowing it", async () => {
    vi.mocked(LibraryInstall.stop).mockRejectedValueOnce(new Error("service already destroyed"));

    await expect(endHvscInstallGuard()).resolves.toBeUndefined();

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0][1]).toMatch(/could not be released/i);
  });
});
