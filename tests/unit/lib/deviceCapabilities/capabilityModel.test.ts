/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  deriveDeviceCapabilities,
  detectStreamingFromConfig,
  supportsMenuInput,
  supportsPowerCycle,
  supportsStreaming,
} from "@/lib/deviceCapabilities";

describe("deviceCapabilities — deriveDeviceCapabilities", () => {
  it("derives C64U capabilities from core_version (streaming, menu input, power cycle)", () => {
    const caps = deriveDeviceCapabilities({ product: "C64 Ultimate", firmwareVersion: "1.1.0", coreVersion: "1.49" });
    expect(caps.family).toBe("C64U");
    expect(supportsStreaming(caps)).toBe(true);
    expect(supportsMenuInput(caps)).toBe(true);
    expect(supportsPowerCycle(caps)).toBe(true);
    expect(caps.streamingSource).toBe("core-version");
    expect(caps.firmwareVersion).toBe("1.1.0");
    expect(caps.coreVersion).toBe("1.49");
  });

  it.each([
    ["Ultimate 64", "U64", "1.4B"],
    ["Ultimate 64 Elite", "U64E", "1.4B"],
    ["Ultimate 64-II", "U64E2", "1.5"],
  ])(
    "grants every integrated computer (%s) streaming + power cycle when core_version is present",
    (product, family, coreVersion) => {
      const caps = deriveDeviceCapabilities({ product, coreVersion });
      expect(caps.family).toBe(family);
      expect(supportsStreaming(caps)).toBe(true);
      expect(supportsPowerCycle(caps)).toBe(true);
      expect(caps.streamingSource).toBe("core-version");
    },
  );

  it("gates power cycle + streaming on core_version, NOT family: a U64 product without core_version gets neither", () => {
    // Proves the gate is runtime-signal-driven. A real U64 always reports core_version;
    // a partial/missing /v1/info conservatively yields no advanced capabilities.
    const caps = deriveDeviceCapabilities({ product: "Ultimate 64 Elite", firmwareVersion: "3.14e" });
    expect(caps.family).toBe("U64E");
    expect(caps.coreVersion).toBeNull();
    expect(supportsPowerCycle(caps)).toBe(false);
    expect(supportsStreaming(caps)).toBe(false);
    expect(supportsMenuInput(caps)).toBe(true);
  });

  it("derives U2 (Ultimate II+) capabilities WITHOUT streaming or power cycle (no core_version)", () => {
    const caps = deriveDeviceCapabilities({ product: "Ultimate II+", firmwareVersion: "3.11" });
    expect(caps.family).toBe("U2");
    // U2 supports the shared REST machine-menu surface...
    expect(supportsMenuInput(caps)).toBe(true);
    // ...but a cartridge has no core_version → no streaming and no power cycle.
    expect(supportsStreaming(caps)).toBe(false);
    expect(supportsPowerCycle(caps)).toBe(false);
    expect(caps.streamingSource).toBe("unknown");
  });

  it.each([["Ultimate II"], ["Ultimate II+"], ["Ultimate II+L"], ["Ultimate 2"]])(
    "classifies %s as the U2 family with no streaming/power cycle (no core_version)",
    (product) => {
      const caps = deriveDeviceCapabilities({ product });
      expect(caps.family).toBe("U2");
      expect(supportsStreaming(caps)).toBe(false);
      expect(supportsPowerCycle(caps)).toBe(false);
    },
  );

  it("lets a U2 advertise streaming via REST config (capability-driven, not family-driven)", () => {
    const caps = deriveDeviceCapabilities({ product: "Ultimate II+", streamEndpointsAdvertised: true });
    expect(caps.family).toBe("U2");
    expect(supportsStreaming(caps)).toBe(true);
    expect(caps.streamingSource).toBe("rest-config");
  });

  it("lets REST config disable streaming even on an integrated computer (config beats core_version)", () => {
    const caps = deriveDeviceCapabilities({
      product: "Ultimate 64",
      coreVersion: "1.4B",
      streamEndpointsAdvertised: false,
    });
    expect(caps.family).toBe("U64");
    expect(supportsStreaming(caps)).toBe(false);
    expect(caps.streamingSource).toBe("rest-config");
    // Power cycle still derives from core_version independently of the streaming config.
    expect(supportsPowerCycle(caps)).toBe(true);
  });

  it("grants an unknown device only safe defaults (no advanced capabilities)", () => {
    const caps = deriveDeviceCapabilities({ product: "Some Printer" });
    expect(caps.family).toBe("unknown");
    expect(supportsStreaming(caps)).toBe(false);
    expect(supportsMenuInput(caps)).toBe(false);
    expect(supportsPowerCycle(caps)).toBe(false);
    expect(caps.streamingSource).toBe("unknown");
  });

  it("treats a device with no product as unreachable/unknown", () => {
    const caps = deriveDeviceCapabilities({});
    expect(caps.family).toBe("unknown");
    expect(caps.restReachable).toBe(false);
    expect(supportsStreaming(caps)).toBe(false);
  });

  it("respects an explicit restReachable=false even with core_version present", () => {
    const caps = deriveDeviceCapabilities({ product: "Ultimate 64", coreVersion: "1.4B", restReachable: false });
    expect(caps.family).toBe("U64");
    expect(caps.restReachable).toBe(false);
    expect(supportsStreaming(caps)).toBe(false);
    expect(supportsMenuInput(caps)).toBe(false);
    expect(supportsPowerCycle(caps)).toBe(false);
  });
});

describe("deviceCapabilities — detectStreamingFromConfig", () => {
  it("returns true when the Data Streams category advertises VIC/audio targets", () => {
    expect(
      detectStreamingFromConfig({
        "Data Streams": { items: { "Stream VIC to": { selected: "off" }, "Stream Audio to": { selected: "off" } } },
      }),
    ).toBe(true);
  });

  it("returns false when only a debug stream is present (U2+ debug-only Data Streams)", () => {
    expect(detectStreamingFromConfig({ "Data Streams": { items: { "Stream Debug to": { selected: "off" } } } })).toBe(
      false,
    );
  });

  it("returns null when the Data Streams category is absent (not discovered → fall back to family)", () => {
    expect(detectStreamingFromConfig({})).toBeNull();
    expect(detectStreamingFromConfig(null)).toBeNull();
    expect(detectStreamingFromConfig(undefined)).toBeNull();
  });

  it("accepts a flattened items map (category items keyed directly)", () => {
    expect(detectStreamingFromConfig({ "Stream VIC to": { selected: "239.0.1.64:11000" } })).toBe(true);
  });
});
