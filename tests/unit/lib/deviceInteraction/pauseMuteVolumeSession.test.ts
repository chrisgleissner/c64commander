/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { capturePauseMuteToPersistedSnapshot } from "@/lib/deviceInteraction/pauseMuteCapture";
import {
  resetMachineExecution,
  restorePauseMuteFromPersistedSnapshot,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { keepRestoresOfOwnWrites } from "@/lib/config/sidVolumeControl";
import {
  noteVolumeSessionWrites,
  readVolumeSessionWrites,
  startVolumeSessionWrites,
} from "@/lib/playback/volumeSessionWrites";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
  buildErrorLogDetails: (error: Error, details: Record<string, unknown>) => ({ ...details, error: error.message }),
}));

const DEVICE = "device-1";
const ITEM = "Vol UltiSID 1";
const OPTIONS = ["-42 dB", "-10 dB", "-6 dB", "0 dB", "OFF"];

const createSharedUltimate = (initialLevel: string) => {
  const mixer: Record<string, string> = { [ITEM]: initialLevel };
  const itemReport = () => ({ value: mixer[ITEM], format: { type: "enum", options: OPTIONS } });
  return {
    mixer,
    api: {
      getCategories: vi.fn(async () => ({
        categories: ["Audio Mixer", "SID Sockets Configuration", "SID Addressing"],
      })),
      getCategory: vi.fn(async (category: string) => {
        if (category === "Audio Mixer") return { "Audio Mixer": { items: { [ITEM]: itemReport() } } };
        if (category === "SID Sockets Configuration") {
          return { "SID Sockets Configuration": { items: { "SID Socket 1": { value: "6581" } } } };
        }
        return { "SID Addressing": { items: { "UltiSID 1 Address": { value: "$D400" } } } };
      }),
      updateConfigBatch: vi.fn(async (payload: Record<string, Record<string, string>>) => {
        Object.assign(mixer, payload["Audio Mixer"]);
        return { errors: [] as string[] };
      }),
    },
  };
};

const stopRestoreFor = (mixer: Record<string, string>) =>
  keepRestoresOfOwnWrites(
    { [ITEM]: "0 dB" },
    [{ name: ITEM, value: mixer[ITEM], options: OPTIONS }],
    readVolumeSessionWrites(DEVICE),
  );

describe("Stop's restore after Home pauses and resumes during a Play volume session", () => {
  beforeEach(() => {
    resetMachineExecution();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("still restores the user's level when the level put back after the pause was this phone's own", async () => {
    const { api, mixer } = createSharedUltimate("0 dB");
    startVolumeSessionWrites(DEVICE);
    mixer[ITEM] = "-6 dB";
    noteVolumeSessionWrites({ [ITEM]: "-6 dB" });

    expect(await capturePauseMuteToPersistedSnapshot(api, DEVICE)).toBe(true);
    expect(await restorePauseMuteFromPersistedSnapshot(api, DEVICE)).toBe(true);

    expect(mixer[ITEM]).toBe("-6 dB");
    expect(stopRestoreFor(mixer)).toEqual({ [ITEM]: "0 dB" });
  });

  it("leaves a level another phone set before the pause alone when Stop restores", async () => {
    const { api, mixer } = createSharedUltimate("0 dB");
    startVolumeSessionWrites(DEVICE);
    mixer[ITEM] = "-6 dB";
    noteVolumeSessionWrites({ [ITEM]: "-6 dB" });
    mixer[ITEM] = "-10 dB";

    expect(await capturePauseMuteToPersistedSnapshot(api, DEVICE)).toBe(true);
    expect(await restorePauseMuteFromPersistedSnapshot(api, DEVICE)).toBe(true);

    expect(mixer[ITEM]).toBe("-10 dB");
    expect(stopRestoreFor(mixer)).toEqual({});
  });

  it("leaves a level alone that this phone never wrote during the session", async () => {
    const { api, mixer } = createSharedUltimate("-10 dB");
    startVolumeSessionWrites(DEVICE);

    await capturePauseMuteToPersistedSnapshot(api, DEVICE);
    await restorePauseMuteFromPersistedSnapshot(api, DEVICE);

    expect(stopRestoreFor(mixer)).toEqual({});
  });
});
