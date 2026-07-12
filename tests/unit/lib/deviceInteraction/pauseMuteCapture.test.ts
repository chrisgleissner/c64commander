/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const persistPauseMuteSnapshotMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/playback/playbackSessionPersistence", () => ({
  persistPauseMuteSnapshot: persistPauseMuteSnapshotMock,
}));
vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
  buildErrorLogDetails: (error: Error, details: Record<string, unknown>) => ({ ...details, error: error.message }),
}));

import { capturePauseMuteToPersistedSnapshot } from "@/lib/deviceInteraction/pauseMuteCapture";

// A minimal Audio Mixer category with one enabled SID volume at a non-muted value.
const audioMixerCategory = {
  "Audio Mixer": {
    items: {
      "Vol UltiSID 1": { value: "0 dB", format: { type: "enum", options: ["-24 dB", "0 dB", "OFF"] } },
    },
  },
};
const sidSocketsCategory = {
  "SID Sockets Configuration": { items: { "SID Socket 1": { value: "6581" }, "SID Socket 2": { value: "Disabled" } } },
};
const sidAddressingCategory = {
  "SID Addressing": { items: { "UltiSID 1 Address": { value: "$D400" }, "UltiSID 2 Address": { value: "Unmapped" } } },
};

const makeApi = (overrides: Record<string, unknown> = {}) => ({
  getCategory: vi.fn(async (category: string) => {
    if (category === "Audio Mixer") return audioMixerCategory;
    if (category === "SID Sockets Configuration") return sidSocketsCategory;
    if (category === "SID Addressing") return sidAddressingCategory;
    return {};
  }),
  updateConfigBatch: vi.fn(async () => ({ errors: [] as string[] })),
  ...overrides,
});

describe("capturePauseMuteToPersistedSnapshot (HARD19-010)", () => {
  beforeEach(() => {
    persistPauseMuteSnapshotMock.mockClear();
  });

  it("returns false with no deviceId", async () => {
    const api = makeApi();
    expect(await capturePauseMuteToPersistedSnapshot(api, null)).toBe(false);
    expect(api.getCategory).not.toHaveBeenCalled();
  });

  it("writes the SID mute batch and persists the pre-mute snapshot when a mute is applied", async () => {
    const api = makeApi();

    const result = await capturePauseMuteToPersistedSnapshot(api, "device-a");

    expect(result).toBe(true);
    // Single Audio Mixer batch write (never decomposed).
    expect(api.updateConfigBatch).toHaveBeenCalledTimes(1);
    const [payload] = api.updateConfigBatch.mock.calls[0];
    expect(Object.keys(payload)).toEqual(["Audio Mixer"]);
    // The pre-mute snapshot is persisted device-scoped for resume to restore.
    expect(persistPauseMuteSnapshotMock).toHaveBeenCalledTimes(1);
    const [deviceId, snapshot] = persistPauseMuteSnapshotMock.mock.calls[0];
    expect(deviceId).toBe("device-a");
    expect(snapshot).toMatchObject({ "Vol UltiSID 1": "0 dB" });
  });

  it("returns false and writes nothing when the mixer is already muted (no enabled non-muted items)", async () => {
    const api = makeApi({
      getCategory: vi.fn(async (category: string) => {
        if (category === "Audio Mixer") {
          return {
            "Audio Mixer": {
              items: {
                "Vol UltiSID 1": { value: "OFF", format: { type: "enum", options: ["-24 dB", "0 dB", "OFF"] } },
              },
            },
          };
        }
        if (category === "SID Sockets Configuration") return sidSocketsCategory;
        if (category === "SID Addressing") return sidAddressingCategory;
        return {};
      }),
    });

    const result = await capturePauseMuteToPersistedSnapshot(api, "device-a");

    expect(result).toBe(false);
    expect(api.updateConfigBatch).not.toHaveBeenCalled();
    expect(persistPauseMuteSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns false (best-effort) when a config read fails, without throwing", async () => {
    const api = makeApi({
      getCategory: vi.fn(async () => {
        throw new Error("device unreachable");
      }),
    });

    await expect(capturePauseMuteToPersistedSnapshot(api, "device-a")).resolves.toBe(false);
    expect(persistPauseMuteSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns false when the firmware rejects the mute write", async () => {
    const api = makeApi({ updateConfigBatch: vi.fn(async () => ({ errors: ["rejected"] })) });

    const result = await capturePauseMuteToPersistedSnapshot(api, "device-a");

    expect(result).toBe(false);
    expect(persistPauseMuteSnapshotMock).not.toHaveBeenCalled();
  });
});
