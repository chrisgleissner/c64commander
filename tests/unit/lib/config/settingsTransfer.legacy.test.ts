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

  it("HARD19-029: exports the live REST concurrency override (it was wrongly dropped before)", async () => {
    // restMaxConcurrency is a real, user-editable Device Safety row consumed at
    // runtime (c64api serializes native REST by it), so it MUST be exported.
    // The prior "removed override" behaviour silently lost a user's device-load
    // protection on every settings transfer; HARD19-029 restores it.
    const snapshot = await exportSettingsSnapshot();

    expect(snapshot.deviceSafety).toHaveProperty("restMaxConcurrency");
    expect(typeof snapshot.deviceSafety.restMaxConcurrency).toBe("number");
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
          telnetConnectCooldownMs: 800,
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
      // HARD19-029: an imported restMaxConcurrency is now applied, not discarded.
      restMaxConcurrency: 4,
      ftpMaxConcurrency: 2,
      allowUserOverrideCircuit: false,
    });
    expect(loadVolumeSliderPreviewIntervalMs()).toBe(320);

    const snapshot = await exportSettingsSnapshot();
    expect(snapshot.featureFlags).toEqual({});
  });
});
