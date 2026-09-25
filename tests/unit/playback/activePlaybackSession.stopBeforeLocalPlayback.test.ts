/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({}),
  getC64APIConfigSnapshot: () => ({ deviceHost: "c64u", password: undefined, baseUrl: "http://c64u" }),
  C64API: class {},
}));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  getSharedLocalSidPlaybackController: () => ({ isActive: () => false, stop: vi.fn() }),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import {
  isRemotePlaybackActive,
  markRemotePlaybackStarted,
  markRemotePlaybackStopped,
  stopRemoteTuneBeforeLocalPlayback,
} from "@/lib/playback/activePlaybackSession";

const COULD_NOT_STOP = "Playback: could not stop the tune on the C64 before playing on this device";

describe("stopping the C64's tune before one plays on this device", () => {
  beforeEach(() => {
    markRemotePlaybackStopped();
    vi.mocked(addLog).mockClear();
  });

  it("does not ask the C64 to stop when no tune is playing there", async () => {
    const stopMachine = vi.fn(async () => undefined);

    await stopRemoteTuneBeforeLocalPlayback(stopMachine);

    expect(stopMachine).not.toHaveBeenCalled();
  });

  it("warns with the message and stack of a failed stop, and still clears the C64's playing flag", async () => {
    markRemotePlaybackStarted();
    const failure = new Error("Reset timed out");

    await stopRemoteTuneBeforeLocalPlayback(async () => {
      throw failure;
    });

    expect(addLog).toHaveBeenCalledWith("warn", COULD_NOT_STOP, {
      service: "playback",
      error: "Reset timed out",
      stack: failure.stack,
    });
    expect(isRemotePlaybackActive()).toBe(false);
  });

  it("reports a failed stop that is not an Error by its text, with no stack", async () => {
    markRemotePlaybackStarted();

    await stopRemoteTuneBeforeLocalPlayback(() => Promise.reject("device busy"));

    expect(addLog).toHaveBeenCalledWith("warn", COULD_NOT_STOP, {
      service: "playback",
      error: "device busy",
      stack: undefined,
    });
    expect(isRemotePlaybackActive()).toBe(false);
  });
});
