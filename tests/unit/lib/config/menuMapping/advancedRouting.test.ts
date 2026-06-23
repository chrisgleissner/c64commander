/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { C64U_1_1_0_HIERARCHY } from "@/lib/config/menuMapping/c64u-1.1.0.generated";
import {
  advancedCategoriesForPage,
  routeAdvancedItem,
  unroutedCategories,
} from "@/lib/config/menuMapping/advancedRouting";

const H = C64U_1_1_0_HIERARCHY;
const route = (category: string, item: string) => routeAdvancedItem(H, "C64U", category, item);

describe("advancedRouting — smart dissolution of the Advanced fallback", () => {
  it("routes sole-owner categories to their owning page (data-driven, no hand-authoring)", () => {
    expect(route("C64 and Cartridge Settings", "Fast Reset")).toBe("Memory & ROMs");
    expect(route("C64 and Cartridge Settings", "DMA Load Mimics ID:")).toBe("Memory & ROMs");
    expect(route("LED Strip Settings", "LedStrip SID Select")).toBe("LED lighting");
    expect(route("Keyboard Lighting", "LedStrip SID Select")).toBe("LED lighting");
    // A future unknown item in a sole-owned category still routes to that page (resilient).
    expect(route("Audio Mixer", "Some Future Knob")).toBe("Audio mixer");
  });

  it("splits the multi-owner U64 Specific Settings by topical keyword", () => {
    expect(route("U64 Specific Settings", "HDMI Tx Swing")).toBe("Video setup");
    expect(route("U64 Specific Settings", "Adjust Color Clock")).toBe("Video setup");
    expect(route("U64 Specific Settings", "UserPort Power Enable")).toBe("Joystick & controllers");
    expect(route("U64 Specific Settings", "Serial Bus Mode")).toBe("Built-in drive A");
    expect(route("U64 Specific Settings", "SpeedDOS Parallel Cable")).toBe("Built-in drive A");
    expect(route("U64 Specific Settings", "Burst Mode Patch")).toBe("Built-in drive A");
    // Keyword-less leftover → category default.
    expect(route("U64 Specific Settings", "C64U Model")).toBe("Video setup");
  });

  it("homes the no-owner categories via category defaults", () => {
    expect(route("SoftIEC Drive Settings", "IEC Drive")).toBe("Built-in drive A");
    expect(route("SoftIEC Drive Settings", "Default Path")).toBe("Built-in drive A");
    expect(route("Tape Settings", "Tape Playback Rate")).toBe("Built-in drive A");
    expect(route("Data Streams", "Stream VIC to")).toBe("Network services & timezone");
  });

  it("returns null for a genuinely homeless (unknown/future) category", () => {
    expect(route("Audio Output Settings", "Speaker Volume")).toBeNull();
    expect(route("Some Future Category", "Whatever")).toBeNull();
  });

  it("every keyword/default page string exists as a real menu page (no typos)", () => {
    const pageLabels = new Set<string>();
    const collect = (nodes: typeof H.nodes) => {
      for (const node of nodes) {
        if (node.kind === "group") collect(node.children ?? []);
        else if (node.kind === "page") pageLabels.add(node.label);
      }
    };
    collect(H.nodes);
    for (const category of [
      "C64 and Cartridge Settings",
      "U64 Specific Settings",
      "SoftIEC Drive Settings",
      "Tape Settings",
      "Data Streams",
    ]) {
      const target = route(category, "x-probe-x");
      if (target) expect(pageLabels.has(target)).toBe(true);
    }
  });

  it("advancedCategoriesForPage tells each page which categories to fetch for its Advanced block", () => {
    expect(advancedCategoriesForPage(H, "C64U", "Memory & ROMs")).toContain("C64 and Cartridge Settings");
    expect(advancedCategoriesForPage(H, "C64U", "Built-in drive A")).toEqual(
      expect.arrayContaining(["Drive A Settings", "U64 Specific Settings", "SoftIEC Drive Settings", "Tape Settings"]),
    );
    expect(advancedCategoriesForPage(H, "C64U", "Network services & timezone")).toEqual(
      expect.arrayContaining(["Network Settings", "Data Streams"]),
    );
  });

  it("unroutedCategories is empty for known C64U categories, non-empty for an unknown one", () => {
    const known = [
      "Audio Mixer",
      "U64 Specific Settings",
      "C64 and Cartridge Settings",
      "SoftIEC Drive Settings",
      "Tape Settings",
      "Data Streams",
      "LED Strip Settings",
    ];
    expect(unroutedCategories(H, "C64U", known)).toEqual([]);
    expect(unroutedCategories(H, "C64U", [...known, "Audio Output Settings"])).toEqual(["Audio Output Settings"]);
  });
});
