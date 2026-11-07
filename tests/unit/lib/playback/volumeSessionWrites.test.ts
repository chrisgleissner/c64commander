/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  endVolumeSessionWrites,
  noteRestoredVolumeSessionWrites,
  noteVolumeSessionWrites,
  readVolumeSessionWrites,
  startVolumeSessionWrites,
} from "@/lib/playback/volumeSessionWrites";
import { addErrorLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn() }));

describe("the record of mixer levels a playback volume session wrote", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("collects every write of a session for the device it started on", () => {
    startVolumeSessionWrites("device-1");
    noteVolumeSessionWrites({ "Vol Master": "OFF" });
    noteVolumeSessionWrites({ "Vol Master": "-6 dB", "Vol Socket 1": "OFF" });

    expect(readVolumeSessionWrites("device-1")).toEqual({ "Vol Master": "-6 dB", "Vol Socket 1": "OFF" });
  });

  it("records a restored level only when the record held it before the mute", () => {
    startVolumeSessionWrites("device-1");
    noteVolumeSessionWrites({ "Vol Master": "-6 dB", "Vol Socket 1": "-6 dB" });
    noteVolumeSessionWrites({ "Vol Master": "OFF", "Vol Socket 1": "OFF", "Vol Socket 2": "OFF" });

    noteRestoredVolumeSessionWrites(
      { "Vol Master": "-6 dB", "Vol Socket 1": "-10 dB", "Vol Socket 2": "0 dB" },
      "device-1",
    );

    expect(readVolumeSessionWrites("device-1")).toEqual({ "Vol Master": "-6 dB" });
  });

  it("keeps the level from before the first of two identical mute writes", () => {
    startVolumeSessionWrites("device-1");
    noteVolumeSessionWrites({ "Vol Master": "-6 dB" });
    noteVolumeSessionWrites({ "Vol Master": "OFF" });
    noteVolumeSessionWrites({ "Vol Master": "OFF" });

    noteRestoredVolumeSessionWrites({ "Vol Master": "-6 dB" }, "device-1");

    expect(readVolumeSessionWrites("device-1")).toEqual({ "Vol Master": "-6 dB" });
  });

  it("does not restore into the record of another device, or of no session", () => {
    noteRestoredVolumeSessionWrites({ "Vol Master": "-6 dB" }, "device-1");
    expect(readVolumeSessionWrites("device-1")).toBeNull();

    startVolumeSessionWrites("device-2");
    noteRestoredVolumeSessionWrites({ "Vol Master": "-6 dB" }, "device-1");
    expect(readVolumeSessionWrites("device-2")).toEqual({});
  });

  it("reads a record an earlier build saved without the levels from before", () => {
    localStorage.setItem(
      "c64u_volume_session_writes:v1",
      JSON.stringify({ deviceId: "device-1", writes: { "Vol Master": "OFF" } }),
    );

    noteVolumeSessionWrites({ "Vol Master": "-6 dB" });

    expect(readVolumeSessionWrites("device-1")).toEqual({ "Vol Master": "-6 dB" });
  });

  it("starts empty for each new session", () => {
    startVolumeSessionWrites("device-1");
    noteVolumeSessionWrites({ "Vol Master": "OFF" });
    startVolumeSessionWrites("device-1");

    expect(readVolumeSessionWrites("device-1")).toEqual({});
  });

  it("is not read for another device", () => {
    startVolumeSessionWrites("device-1");
    noteVolumeSessionWrites({ "Vol Master": "OFF" });

    expect(readVolumeSessionWrites("device-2")).toBeNull();
    expect(readVolumeSessionWrites(null)).toBeNull();
  });

  it("does not exist without a session, or after it ended", () => {
    noteVolumeSessionWrites({ "Vol Master": "OFF" });
    expect(readVolumeSessionWrites("device-1")).toBeNull();

    startVolumeSessionWrites("device-1");
    endVolumeSessionWrites();
    expect(readVolumeSessionWrites("device-1")).toBeNull();
  });

  it("is not kept for a session whose device is unknown", () => {
    startVolumeSessionWrites(null);
    noteVolumeSessionWrites({ "Vol Master": "OFF" });

    expect(localStorage.getItem("c64u_volume_session_writes:v1")).toBeNull();
  });

  it("reads a damaged record as missing and logs it", () => {
    localStorage.setItem("c64u_volume_session_writes:v1", "{not json");

    expect(readVolumeSessionWrites("device-1")).toBeNull();
    expect(addErrorLog).toHaveBeenCalledWith("Could not read the mixer levels this playback wrote", expect.any(Object));
  });

  it("reads a record of the wrong shape as missing", () => {
    localStorage.setItem("c64u_volume_session_writes:v1", JSON.stringify({ deviceId: "device-1", writes: [] }));

    expect(readVolumeSessionWrites("device-1")).toBeNull();
  });

  it("logs a record it cannot save", () => {
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    startVolumeSessionWrites("device-1");
    setItem.mockRestore();

    expect(addErrorLog).toHaveBeenCalledWith("Could not save the mixer levels this playback wrote", expect.any(Object));
  });
});
