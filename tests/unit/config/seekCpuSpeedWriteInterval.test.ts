/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { seekCpuSpeedWriteIntervalMs, type DeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";

const config = (
  mode: DeviceSafetyConfig["mode"],
  configsCooldownMs: number,
  effectiveMode?: "BALANCED" | "CONSERVATIVE",
) =>
  ({
    mode,
    configsCooldownMs,
    resolution: effectiveMode ? ({ effectiveMode } as DeviceSafetyConfig["resolution"]) : undefined,
  }) as Pick<DeviceSafetyConfig, "mode" | "resolution" | "configsCooldownMs">;

describe("seek CPU Speed write interval", () => {
  it("is 250 ms where Balanced and Relaxed allow it, and never longer than their own cooldown", () => {
    expect(seekCpuSpeedWriteIntervalMs(config("BALANCED", 500))).toBe(250);
    expect(seekCpuSpeedWriteIntervalMs(config("RELAXED", 200))).toBe(200);
    expect(seekCpuSpeedWriteIntervalMs(config("AUTO", 500, "BALANCED"))).toBe(250);
  });

  it("keeps the cooldown of Conservative and Troubleshooting, whatever Auto resolved to", () => {
    expect(seekCpuSpeedWriteIntervalMs(config("CONSERVATIVE", 1200))).toBe(1200);
    expect(seekCpuSpeedWriteIntervalMs(config("TROUBLESHOOTING", 2000))).toBe(2000);
    expect(seekCpuSpeedWriteIntervalMs(config("AUTO", 1200, "CONSERVATIVE"))).toBe(1200);
  });
});
