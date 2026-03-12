/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";
import { exportSettingsSnapshot, importSettingsJson } from "@/lib/config/settingsTransfer";

describe("settingsTransfer", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exports device safety without the removed REST concurrency override", () => {
    const snapshot = exportSettingsSnapshot();

    expect(snapshot.deviceSafety).not.toHaveProperty("restMaxConcurrency");
  });

  it("imports legacy settings payloads that still contain restMaxConcurrency", () => {
    const result = importSettingsJson(
      JSON.stringify({
        version: 1,
        appSettings: {
          debugLoggingEnabled: false,
          configWriteIntervalMs: 500,
          automaticDemoModeEnabled: false,
          startupDiscoveryWindowMs: 3000,
          backgroundRediscoveryIntervalMs: 5000,
          discoveryProbeTimeoutMs: 2500,
          diskAutostartMode: "kernal",
        },
        deviceSafety: {
          mode: "CONSERVATIVE",
          restMaxConcurrency: 4,
          ftpMaxConcurrency: 2,
          infoCacheMs: 1200,
          configsCacheMs: 2000,
          configsCooldownMs: 1200,
          drivesCooldownMs: 1000,
          ftpListCooldownMs: 800,
          backoffBaseMs: 500,
          backoffMaxMs: 6000,
          backoffFactor: 2,
          circuitBreakerThreshold: 2,
          circuitBreakerCooldownMs: 6000,
          discoveryProbeIntervalMs: 1000,
          allowUserOverrideCircuit: false,
        },
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(loadDeviceSafetyConfig()).toMatchObject({
      mode: "CONSERVATIVE",
      ftpMaxConcurrency: 2,
      allowUserOverrideCircuit: false,
    });
  });
});
