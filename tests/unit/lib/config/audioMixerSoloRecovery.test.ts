/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({
  getCategory: vi.fn(),
  setConfigValue: vi.fn(),
  hosts: [] as Array<string | undefined>,
  network: { supported: false, online: true },
  edgeListeners: [] as Array<(edge: string) => void>,
}));

vi.mock("@/lib/c64api", () => ({
  C64API: class {
    constructor(_baseUrl?: string, _password?: string, host?: string) {
      device.hosts.push(host);
    }
    getCategory = device.getCategory;
    setConfigValue = device.setConfigValue;
  },
}));
vi.mock("@/lib/streams/foreignSenderStop", () => ({ resolveForeignSenderPassword: async () => null }));
vi.mock("@/lib/connection/offlineStartup", () => ({
  readNativeNetworkStatus: async () => ({ ...device.network }),
}));
vi.mock("@/lib/connection/networkStatusWatch", () => ({
  subscribeNetworkEdges: (listener: (edge: string) => void) => {
    device.edgeListeners.push(listener);
    return () => {
      device.edgeListeners = device.edgeListeners.filter((entry) => entry !== listener);
    };
  },
}));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import {
  buildSoloRecoveryUpdates,
  clearSoloLevels,
  recordSoloLevels,
  recoverInterruptedSolo,
} from "@/lib/config/audioMixerSoloRecovery";

const OPTIONS = ["OFF", "-6 dB", " 0 dB"];
const levels = [
  { name: "Vol UltiSid 1", value: " 0 dB", options: OPTIONS },
  { name: "Vol UltiSid 2", value: " 0 dB", options: OPTIONS },
  { name: "Vol Socket 1", value: " 0 dB", options: OPTIONS },
  { name: "Vol Socket 2", value: "OFF", options: OPTIONS },
];

describe("recovering the SID levels an interrupted Solo left muted", () => {
  beforeEach(() => {
    localStorage.clear();
    device.getCategory.mockReset();
    device.setConfigValue.mockReset().mockResolvedValue(undefined);
    device.hosts = [];
    device.network = { supported: false, online: true };
    device.edgeListeners = [];
    vi.mocked(addLog).mockClear();
  });

  const mutedOthers = {
    "Audio Mixer": {
      items: {
        "Vol UltiSid 1": { selected: " 0 dB" },
        "Vol UltiSid 2": { selected: "OFF" },
        "Vol Socket 1": { current: " 0 dB" },
        "Vol Socket 2": "OFF",
      },
    },
    errors: [],
  };

  it("waits for the network when the phone is offline at launch, then restores", async () => {
    recordSoloLevels("c64u", "Vol UltiSid 1", levels);
    device.network = { supported: true, online: false };
    device.getCategory.mockResolvedValue(mutedOthers);

    await recoverInterruptedSolo();
    expect(device.getCategory).not.toHaveBeenCalled();
    expect(device.edgeListeners).toHaveLength(1);

    device.network = { supported: true, online: true };
    device.edgeListeners[0]("offline");
    device.edgeListeners[0]("online");
    await vi.waitFor(() => expect(device.setConfigValue).toHaveBeenCalledWith("Audio Mixer", "Vol UltiSid 2", " 0 dB"));
    expect(device.edgeListeners).toHaveLength(0);
  });

  it("restores nothing when the device reports no Audio Mixer", async () => {
    recordSoloLevels("c64u", "Vol UltiSid 1", levels);
    device.getCategory.mockResolvedValue({ errors: [] });

    await recoverInterruptedSolo();

    expect(device.setConfigValue).not.toHaveBeenCalled();
    expect(localStorage.getItem("c64u_audio_mixer_solo:v1")).toBeNull();
  });

  it("ignores a record it cannot read, and says so", async () => {
    localStorage.setItem("c64u_audio_mixer_solo:v1", "{not json");
    await recoverInterruptedSolo();
    localStorage.setItem("c64u_audio_mixer_solo:v1", JSON.stringify({ host: "c64u" }));
    await recoverInterruptedSolo();

    expect(device.getCategory).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Audio Mixer: could not read the record of Solo levels",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("logs, rather than throws, when the record cannot be written or removed", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    try {
      recordSoloLevels("c64u", "Vol UltiSid 1", levels);
      clearSoloLevels();
    } finally {
      setItem.mockRestore();
      removeItem.mockRestore();
    }
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Audio Mixer: could not record the levels Solo replaced",
      expect.objectContaining({ error: "quota exceeded" }),
    );
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Audio Mixer: could not clear the record of Solo levels",
      expect.objectContaining({ error: "storage unavailable" }),
    );
  });

  it("restores only the SIDs still at Solo's mute value, leaving one the user has changed since", () => {
    const updates = buildSoloRecoveryUpdates(
      { soloItem: "Vol UltiSid 1", items: levels },
      { "Vol UltiSid 1": " 0 dB", "Vol UltiSid 2": "OFF", "Vol Socket 1": "-6 dB", "Vol Socket 2": "OFF" },
    );
    expect(updates).toEqual({ "Vol UltiSid 2": " 0 dB" });
  });

  it("puts the levels back on the device at the next launch and forgets the record", async () => {
    recordSoloLevels("c64u", "Vol UltiSid 1", levels);
    device.getCategory.mockResolvedValue({
      "Audio Mixer": { "Vol UltiSid 1": " 0 dB", "Vol UltiSid 2": "OFF", "Vol Socket 1": "OFF", "Vol Socket 2": "OFF" },
      errors: [],
    });

    await recoverInterruptedSolo();

    expect(device.hosts).toEqual(["c64u"]);
    expect(device.setConfigValue.mock.calls).toEqual([
      ["Audio Mixer", "Vol UltiSid 2", " 0 dB"],
      ["Audio Mixer", "Vol Socket 1", " 0 dB"],
    ]);
    await recoverInterruptedSolo();
    expect(device.getCategory).toHaveBeenCalledTimes(1);
  });

  it("keeps the record for the next launch when the Ultimate cannot be reached", async () => {
    recordSoloLevels("c64u", "Vol UltiSid 1", levels);
    device.getCategory.mockRejectedValueOnce(new Error("Host unreachable"));

    await recoverInterruptedSolo();

    device.getCategory.mockResolvedValue({
      "Audio Mixer": {
        "Vol UltiSid 1": " 0 dB",
        "Vol UltiSid 2": "OFF",
        "Vol Socket 1": " 0 dB",
        "Vol Socket 2": "OFF",
      },
      errors: [],
    });
    await recoverInterruptedSolo();
    expect(device.setConfigValue.mock.calls).toEqual([["Audio Mixer", "Vol UltiSid 2", " 0 dB"]]);
  });

  it("does nothing at launch when Solo ended normally", async () => {
    recordSoloLevels("c64u", "Vol UltiSid 1", levels);
    clearSoloLevels();

    await recoverInterruptedSolo();

    expect(device.getCategory).not.toHaveBeenCalled();
  });
});
