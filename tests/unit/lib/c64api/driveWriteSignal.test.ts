/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("driveWriteSignal", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("clears Play's saved launch mount for a drive written before the Play page has loaded", async () => {
    localStorage.setItem(
      "c64u_play_launch_mounts",
      JSON.stringify({ c64u: { a: { drive: "a", launchPath: "/USB0/game.d64", priorImagePath: null } } }),
    );
    const { signalDriveWritten } = await import("@/lib/c64api/driveWriteSignal");

    signalDriveWritten("c64u", "a");

    expect(localStorage.getItem("c64u_play_launch_mounts")).toBeNull();
  });
});
