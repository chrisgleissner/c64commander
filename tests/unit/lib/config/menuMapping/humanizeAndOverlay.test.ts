/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { humanizeRestName } from "@/lib/config/menuMapping/humanize";
import { resolveOverlayEntry, TERMINOLOGY_OVERLAY } from "@/lib/config/menuMapping/overlay";

describe("humanizeRestName (fallback area only)", () => {
  it("preserves known acronyms and exact firmware tokens", () => {
    expect(humanizeRestName("Bus Sharing - I/O1")).toBe("Bus Sharing - I/O1");
    expect(humanizeRestName("DMA Load Mimics ID:")).toBe("DMA Load Mimics ID:");
    expect(humanizeRestName("REU Preload Offset")).toBe("REU Preload Offset");
    expect(humanizeRestName("Stream VIC to")).toBe("Stream VIC to");
  });

  it("canonicalizes acronym casing without case-folding the whole string", () => {
    expect(humanizeRestName("hdmi tx swing")).toBe("HDMI tx swing");
    expect(humanizeRestName("c64u model")).toBe("C64U model");
  });

  it("returns empty input unchanged", () => {
    expect(humanizeRestName("")).toBe("");
  });
});

describe("Layer A terminology overlay (device-agnostic)", () => {
  it("maps shared REST items to friendly menu labels regardless of device", () => {
    expect(resolveOverlayEntry("Ethernet Settings", "Static Netmask")?.label).toBe("Static netmask");
    // Same REST item under a different category (WiFi) still relabels — Layer A is by
    // {category,item} and shared labels travel across families.
    expect(resolveOverlayEntry("WiFi settings", "Static Netmask")?.label).toBe("Static netmask");
    expect(resolveOverlayEntry("Network Settings", "TimeZone")?.label).toBe("Timezone");
    expect(resolveOverlayEntry("Audio Mixer", "Vol UltiSid 1")).toEqual({ label: "Vol UltiSID 1", formatterId: "db" });
    expect(resolveOverlayEntry("U64 Specific Settings", "CPU Speed")).toEqual({
      label: "CPU speed",
      formatterId: "cpuSpeedMhz",
    });
  });

  it("has no entry for genuinely unmapped/advanced items (they humanize instead)", () => {
    expect(resolveOverlayEntry("U64 Specific Settings", "C64U Model")).toBeUndefined();
    expect(resolveOverlayEntry("Data Streams", "Stream VIC to")).toBeUndefined();
  });

  it("is a non-empty nested index", () => {
    expect(Object.keys(TERMINOLOGY_OVERLAY).length).toBeGreaterThan(10);
  });
});
