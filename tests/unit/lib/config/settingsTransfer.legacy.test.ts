/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";
import { loadVolumeSliderPreviewIntervalMs } from "@/lib/config/appSettings";
import { featureFlagManager } from "@/lib/config/featureFlags";
import { exportSettingsSnapshot, importSettingsJson } from "@/lib/config/settingsTransfer";

describe("settingsTransfer", () => {
  beforeEach(async () => {
    localStorage.clear();
    await featureFlagManager.load();
    await featureFlagManager.replaceOverrides({});
  });

  it("exports device safety without the removed REST concurrency override", async () => {
    const snapshot = await exportSettingsSnapshot();

    expect(snapshot.deviceSafety).not.toHaveProperty("restMaxConcurrency");
    expect(snapshot.featureFlags).toEqual({});
    expect(snapshot.appSettings.volumeSliderPreviewIntervalMs).toBe(200);
  });

  it("imports legacy settings payloads that still contain restMaxConcurrency", async () => {
    const result = await importSettingsJson(
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
          volumeSliderPreviewIntervalMs: 320,
          archiveHostOverride: "",
          archiveClientIdOverride: "",
          archiveUserAgentOverride: "",
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
    expect(loadVolumeSliderPreviewIntervalMs()).toBe(320);

    const snapshot = await exportSettingsSnapshot();
    expect(snapshot.featureFlags).toEqual({});
  });
});
