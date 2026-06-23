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

describe("advancedRouting — evidence-based placement of unclaimed items", () => {
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
  });

  it("routes evidence-less leftovers to the residual Advanced section (null), not a guessed page", () => {
    // `C64U Model` is a hardware edition, absent from the captured menu — no topical
    // keyword, U64 Specific is multi-owner (no sole-owner), and there is no speculative
    // category default. It must NOT be mis-homed on Video setup.
    expect(route("U64 Specific Settings", "C64U Model")).toBeNull();
    // Categories with no menu page at all → residual (no whole-category default placement).
    expect(route("SoftIEC Drive Settings", "IEC Drive")).toBeNull();
    expect(route("SoftIEC Drive Settings", "Default Path")).toBeNull();
    expect(route("Tape Settings", "Tape Playback Rate")).toBeNull();
    expect(route("Data Streams", "Stream VIC to")).toBeNull();
  });

  it("returns null for a genuinely homeless (unknown/future) category", () => {
    expect(route("Audio Output Settings", "Speaker Volume")).toBeNull();
    expect(route("Some Future Category", "Whatever")).toBeNull();
  });

  it("every page a real item routes to exists as a real menu page (no typos)", () => {
    const pageLabels = new Set<string>();
    const collect = (nodes: typeof H.nodes) => {
      for (const node of nodes) {
        if (node.kind === "group") collect(node.children ?? []);
        else if (node.kind === "page") pageLabels.add(node.label);
      }
    };
    collect(H.nodes);
    const probes: Array<[string, string]> = [
      ["C64 and Cartridge Settings", "Fast Reset"], // sole-owner
      ["LED Strip Settings", "LedStrip SID Select"], // sole-owner
      ["U64 Specific Settings", "HDMI Tx Swing"], // keyword
      ["U64 Specific Settings", "UserPort Power Enable"], // keyword
      ["U64 Specific Settings", "Serial Bus Mode"], // keyword
    ];
    for (const [category, item] of probes) {
      const target = route(category, item);
      expect(target).not.toBeNull();
      expect(pageLabels.has(target as string)).toBe(true);
    }
  });

  it("advancedCategoriesForPage tells each page which categories to fetch for its Advanced block", () => {
    expect(advancedCategoriesForPage(H, "C64U", "Memory & ROMs")).toContain("C64 and Cartridge Settings");
    // Drive A (sole-owner) + U64 Specific (keyword: serial bus / parallel cable / burst).
    expect(advancedCategoriesForPage(H, "C64U", "Built-in drive A")).toEqual(
      expect.arrayContaining(["Drive A Settings", "U64 Specific Settings"]),
    );
    // No whole-category defaults: SoftIEC/Tape no longer attach to Built-in drive A, and
    // Data Streams no longer attaches to Network services.
    expect(advancedCategoriesForPage(H, "C64U", "Built-in drive A")).not.toContain("SoftIEC Drive Settings");
    expect(advancedCategoriesForPage(H, "C64U", "Built-in drive A")).not.toContain("Tape Settings");
    expect(advancedCategoriesForPage(H, "C64U", "Network services & timezone")).toEqual(["Network Settings"]);
  });

  it("unroutedCategories: sole-owned/keyword-only categories with no menu page surface as residual", () => {
    // Sole-owned categories are placeable → not residual.
    expect(unroutedCategories(H, "C64U", ["Audio Mixer", "C64 and Cartridge Settings", "LED Strip Settings"])).toEqual(
      [],
    );
    // No menu page + no sole-owner → residual (their items render in the Advanced section).
    // `U64 Specific Settings` is multi-owner (keyword-split, not sole-owned), so its
    // genuinely homeless leftover (`C64U Model`) lands in the residual block too.
    expect(
      unroutedCategories(H, "C64U", [
        "U64 Specific Settings",
        "SoftIEC Drive Settings",
        "Tape Settings",
        "Data Streams",
      ]),
    ).toEqual(["U64 Specific Settings", "SoftIEC Drive Settings", "Tape Settings", "Data Streams"]);
    // Unknown/future category is also residual.
    expect(unroutedCategories(H, "C64U", ["Audio Mixer", "Audio Output Settings"])).toEqual(["Audio Output Settings"]);
  });
});
