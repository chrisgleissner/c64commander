/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addErrorLog, addLog, recordDeviceGuard } = vi.hoisted(() => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
  recordDeviceGuard: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addLog,
  addErrorLog,
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordDeviceGuard,
}));

describe("deviceSafetySettings integration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("reconfigures the interaction manager after saved-device verification broadcasts a C64U product", async () => {
    vi.resetModules();

    const store = await import("@/lib/savedDevices/store");
    const safety = await import("@/lib/config/deviceSafetySettings");
    await import("@/lib/deviceInteraction/deviceInteractionManager");

    const selectedDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(selectedDeviceId, {
      name: "Lab Device",
      host: "lab-device",
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
    });
    safety.saveDeviceSafetyMode("AUTO");
    addLog.mockClear();

    store.completeSavedDeviceVerification(selectedDeviceId, {
      product: "C64U",
      hostname: "c64u",
      unique_id: "UID-C64U",
    });

    const configUpdateLog = addLog.mock.calls.find(
      ([level, message]) => level === "info" && message === "Device safety config updated",
    );

    expect(configUpdateLog).toBeTruthy();
    expect(configUpdateLog?.[2]).toEqual(
      expect.objectContaining({
        mode: "AUTO",
        config: expect.objectContaining({
          ftpMaxConcurrency: 1,
          infoCacheMs: 1200,
          resolution: expect.objectContaining({
            effectiveMode: "CONSERVATIVE",
            resolvedPreset: "CONSERVATIVE",
            isProvisional: false,
          }),
        }),
      }),
    );
  });
});
