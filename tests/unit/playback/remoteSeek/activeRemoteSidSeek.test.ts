/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getConfigItem: vi.fn(async () => ({})),
  setConfigValue: vi.fn(async () => ({})),
  sendMachineInputBatch: vi.fn(async () => ({})),
  getMachineInputState: vi.fn(async () => ({ keyboard: { inputs: [] } })),
  readMemory: vi.fn(async () => new Uint8Array(1)),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@/lib/c64api", () => ({ getC64API: () => api }));
vi.mock("@/lib/connection/connectedDeviceIdentity", () => ({
  getConnectedDeviceIdentity: () => ({ uniqueId: "5D0464", hostname: "c64u" }),
}));

import {
  cancelRemoteSidSeek,
  createRemoteSeekApi,
  isRemoteSidSeekBusy,
  setActiveRemoteSidSeek,
  setRemoteSidSeekGesture,
} from "@/lib/playback/remoteSeek/activeRemoteSidSeek";
import type { RemoteSidSeekController } from "@/lib/playback/remoteSeek/remoteSidSeekController";

describe("active remote SID seek", () => {
  beforeEach(() => {
    setActiveRemoteSidSeek(null);
    vi.clearAllMocks();
  });

  it("binds the API to the identity of the connected device", async () => {
    const seekApi = createRemoteSeekApi();
    expect(seekApi.currentDeviceKey()).toBe(JSON.stringify(["5d0464", "c64u"]));
    await seekApi.getConfigItem("U64 Specific Settings", "CPU Speed");
    await seekApi.setConfigValue("U64 Specific Settings", "CPU Speed", " 4", { __c64uTransientConfigWrite: true });
    await seekApi.sendMachineInputBatch({ events: [] });
    await seekApi.getMachineInputState();
    await seekApi.readMemory("D018", 1, { __c64uBypassCooldown: true });
    expect(api.setConfigValue).toHaveBeenCalledWith("U64 Specific Settings", "CPU Speed", " 4", {
      __c64uTransientConfigWrite: true,
    });
    expect(api.readMemory).toHaveBeenCalledWith("D018", 1, { __c64uBypassCooldown: true });
    expect(api.getMachineInputState).toHaveBeenCalledWith({ __c64uIntent: "user" });
  });

  it("cancels only a seek that is busy, so an idle one costs stop and pause nothing", async () => {
    const cancel = vi.fn(async () => undefined);
    const controller = { isBusy: false, cancel } as unknown as RemoteSidSeekController;
    setActiveRemoteSidSeek(controller);
    expect(isRemoteSidSeekBusy()).toBe(false);
    await cancelRemoteSidSeek("stop");
    expect(cancel).not.toHaveBeenCalled();

    (controller as { isBusy: boolean }).isBusy = true;
    expect(isRemoteSidSeekBusy()).toBe(true);
    await cancelRemoteSidSeek("stop");
    expect(cancel).toHaveBeenCalledWith("stop");
  });

  it("reports nothing busy without an active seek", async () => {
    expect(isRemoteSidSeekBusy()).toBe(false);
    await expect(cancelRemoteSidSeek("stop")).resolves.toBeUndefined();
  });

  it("counts a gesture that has not reached the device yet as busy, so auto-advance waits for it", async () => {
    const cancel = vi.fn(async () => undefined);
    setActiveRemoteSidSeek({ isBusy: false, cancel } as unknown as RemoteSidSeekController);
    setRemoteSidSeekGesture(true);
    expect(isRemoteSidSeekBusy()).toBe(true);
    await cancelRemoteSidSeek("stop");
    expect(cancel).toHaveBeenCalledWith("stop");
    setRemoteSidSeekGesture(false);
    expect(isRemoteSidSeekBusy()).toBe(false);
  });
});
