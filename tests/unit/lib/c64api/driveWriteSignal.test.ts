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
  });

  it("hands drive writes made before anything listens to the listener once it registers", async () => {
    const { onDriveWritten, signalDriveWritten } = await import("@/lib/c64api/driveWriteSignal");
    const listener = vi.fn();

    signalDriveWritten("c64u", "a");
    onDriveWritten(listener);
    signalDriveWritten("c64u", "b");

    expect(listener.mock.calls).toEqual([
      ["c64u", "a"],
      ["c64u", "b"],
    ]);
  });
});
