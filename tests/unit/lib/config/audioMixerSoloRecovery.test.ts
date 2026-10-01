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
  readNativeNetworkStatus: async () => ({ supported: false, online: true }),
}));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

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
