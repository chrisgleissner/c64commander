/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { TERMINOLOGY_OVERLAY } from "@/lib/config/menuMapping/overlay";
import { resolveMenuMapping } from "@/lib/config/menuMapping/resolveMenuMapping";
import {
  liveConfigFromFixture,
  liveRestKeySet,
  projectConfigToMenu,
  renderedRestKeySet,
  type LiveConfig,
  type ProjectedLeaf,
  type ProjectedNode,
  type ProjectionResult,
} from "@/lib/config/menuMapping/projectConfigToMenu";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const loadFixture = (relPath: string): LiveConfig =>
  liveConfigFromFixture(yaml.load(readFileSync(resolve(REPO_ROOT, relPath), "utf8")));

const FIXTURES = {
  c64u_110: "docs/c64/devices/c64u/1.1.0/c64u-config.yaml",
  c64u_314: "docs/c64/devices/c64u/3.14/c64u-config.yaml",
  u64e_312a: "docs/c64/devices/u64e/3.12a/u64e-config.yaml",
  u64e_314e: "docs/c64/devices/u64e/3.14e/u64e-config.yaml",
} as const;

const flattenLeaves = (nodes: ProjectedNode[]): ProjectedLeaf[] =>
  nodes.flatMap((node) =>
    node.type === "leaf" ? [node] : node.type === "section" ? flattenLeaves(node.children) : [],
  );

interface PageLeaf {
  pageTitle: string;
  groupLabel: string | null;
  leaf: ProjectedLeaf;
}
const pageLeaves = (result: ProjectionResult): PageLeaf[] =>
  result.pages.flatMap((page) =>
    flattenLeaves(page.children).map((leaf) => ({ pageTitle: page.title, groupLabel: page.groupLabel, leaf })),
  );

const fallbackLeaf = (result: ProjectionResult, category: string, item: string): ProjectedLeaf | undefined =>
  result.fallback.find((group) => group.category === category)?.leaves.find((leaf) => leaf.rest.item === item);

// Find a smart-routed advanced leaf and the page it landed on.
const advancedPageOf = (result: ProjectionResult, category: string, item: string): string | undefined =>
  result.pages.find((page) =>
    page.advanced.some((group) => group.category === category && group.leaves.some((leaf) => leaf.rest.item === item)),
  )?.title;

const projectC64U = (live: LiveConfig, firmware: string): ProjectionResult =>
  projectConfigToMenu(live, {
    hierarchy: resolveMenuMapping({ family: "C64U", firmwareVersion: firmware }),
    overlay: TERMINOLOGY_OVERLAY,
  });

describe("projectConfigToMenu — LOSSLESS guarantee (set-equality over real fixtures)", () => {
  it("renders every live REST item on C64U 1.1.0 (hierarchy mode), nothing dropped/duplicated", () => {
    const live = loadFixture(FIXTURES.c64u_110);
    const result = projectC64U(live, "1.1.0");
    expect(result.mode).toBe("hierarchy");
    expect(renderedRestKeySet(result)).toEqual(liveRestKeySet(live));
  });

  it("renders every live REST item on C64U 3.14 via the 1.1.0 hierarchy (intra-family fallback)", () => {
    const live = loadFixture(FIXTURES.c64u_314);
    const result = projectC64U(live, "3.14");
    expect(result.mode).toBe("hierarchy");
    expect(renderedRestKeySet(result)).toEqual(liveRestKeySet(live));
    // 3.14 dropped items vs the 1.1.0 menu surface as stale (e.g. Modem Automatic Rx Pushback).
    expect(result.drift.staleMappingRefs.some((p) => p.item === "Automatic Rx Pushback")).toBe(true);
  });

  it("renders every live REST item on U64e 3.12a (null hierarchy → REST-grouped layout)", () => {
    const live = loadFixture(FIXTURES.u64e_312a);
    const result = projectConfigToMenu(live, {
      hierarchy: resolveMenuMapping({ family: "U64E", firmwareVersion: "3.12a" }),
      overlay: TERMINOLOGY_OVERLAY,
    });
    expect(result.mode).toBe("rest-grouped");
    expect(renderedRestKeySet(result)).toEqual(liveRestKeySet(live));
  });

  it("renders every live REST item on U64e 3.14e (null hierarchy → REST-grouped layout)", () => {
    const live = loadFixture(FIXTURES.u64e_314e);
    const result = projectConfigToMenu(live, {
      hierarchy: resolveMenuMapping({ family: "U64E", firmwareVersion: "3.14e" }),
      overlay: TERMINOLOGY_OVERLAY,
    });
    expect(result.mode).toBe("rest-grouped");
    expect(renderedRestKeySet(result)).toEqual(liveRestKeySet(live));
  });
});

describe("projectConfigToMenu — Layer B menu hierarchy (C64U 1.1.0)", () => {
  const live = loadFixture(FIXTURES.c64u_110);
  const result = projectC64U(live, "1.1.0");
  const leaves = pageLeaves(result);
  const find = (category: string, item: string) =>
    leaves.filter((entry) => entry.leaf.rest.category === category && entry.leaf.rest.item === item);

  it("relabels items with the menu label while preserving REST identity for write-back", () => {
    const cpu = find("U64 Specific Settings", "CPU Speed");
    expect(cpu).toHaveLength(1);
    expect(cpu[0].pageTitle).toBe("Turbo boost");
    expect(cpu[0].leaf.label).toBe("CPU speed");
    expect(cpu[0].leaf.formatterId).toBe("cpuSpeedMhz");
    // Write-back identity stays the exact firmware strings.
    expect(cpu[0].leaf.rest).toEqual({ category: "U64 Specific Settings", item: "CPU Speed" });
  });

  it("splits U64 Specific Settings across Video / Turbo / Joystick / SID player / LED pages", () => {
    expect(find("U64 Specific Settings", "System Mode")[0].pageTitle).toBe("Video setup");
    expect(find("U64 Specific Settings", "Turbo Control")[0].pageTitle).toBe("Turbo boost");
    const joystick = find("U64 Specific Settings", "Joystick Swapper")[0];
    expect(joystick.pageTitle).toBe("Joystick & controllers");
    expect(joystick.leaf.label).toBe("Joystick input");
    expect(find("U64 Specific Settings", "SID Player Autoconfig")[0].pageTitle).toBe("SID player behavior");
    const ledTop = find("U64 Specific Settings", "LED Select Top")[0];
    expect(ledTop.pageTitle).toBe("LED lighting");
    expect(ledTop.leaf.label).toBe("Output 1");
  });

  it("groups Audio pages under the 'Audio setup' parent group", () => {
    const audioMixer = find("Audio Mixer", "Vol UltiSid 1")[0];
    expect(audioMixer.pageTitle).toBe("Audio mixer");
    expect(audioMixer.groupLabel).toBe("Audio setup");
    expect(audioMixer.leaf.label).toBe("Vol UltiSID 1");
  });

  it("aliases the drive ROMs under both pages but to ONE REST source (deduped, no double identity)", () => {
    const rom = find("Drive A Settings", "ROM for 1541 mode");
    const pages = rom.map((entry) => entry.pageTitle).sort();
    expect(pages).toEqual(["Built-in drive A", "Memory & ROMs"]);
    // The Memory & ROMs occurrence is flagged alias; the Built-in drive A is primary.
    const memRom = rom.find((entry) => entry.pageTitle === "Memory & ROMs")!;
    const driveRom = rom.find((entry) => entry.pageTitle === "Built-in drive A")!;
    expect(memRom.leaf.alias).toBe(true);
    expect(driveRom.leaf.alias).toBeUndefined();
    expect(memRom.leaf.rest).toEqual(driveRom.leaf.rest);
    // Rendered identity counted once.
    const keys = result.renderedRest.filter((p) => p.category === "Drive A Settings" && p.item === "ROM for 1541 mode");
    expect(keys).toHaveLength(1);
  });

  it("keeps Disk swap delay / Loop delay RAW (no invented unit conversion); firmware format passed through", () => {
    // Units VERIFIED from the REST schema `format` field (printf-style):
    //   Disk swap delay  min:1 max:10 format:"%d00 ms"  → display value*100 ms (1 → "100 ms")
    //   Loop Delay       min:1 max:20 format:"%d0 ms"   → display value*10 ms  (2 → "20 ms")
    // The shared ConfigItemRow does not yet honour `details.format` (it is dead app-wide,
    // ~108 items), so a generic conversion is out of this feature's scope. The menu layer
    // therefore must NOT invent a multiplier: it attaches NO formatter, surfaces the RAW
    // value, and passes the firmware `format` string through untouched for a future generic
    // renderer. This test fails if anyone hardcodes a ×100/×10 multiplier into the overlay.
    const diskSwap = find("Drive A Settings", "Disk swap delay");
    expect(diskSwap).toHaveLength(1);
    expect(diskSwap[0].pageTitle).toBe("Built-in drive A");
    expect(diskSwap[0].leaf.label).toBe("Disk swap delay");
    expect(diskSwap[0].leaf.formatterId).toBeUndefined();
    expect(String(diskSwap[0].leaf.value)).toBe("1"); // raw, not "100 ms"
    expect(diskSwap[0].leaf.details?.format).toBe("%d00 ms"); // verified unit, passed through

    const loopDelay = find("Modem Settings", "Loop Delay");
    expect(loopDelay).toHaveLength(1);
    expect(loopDelay[0].pageTitle).toBe("Modems");
    expect(loopDelay[0].leaf.label).toBe("Loop delay");
    expect(loopDelay[0].leaf.formatterId).toBeUndefined();
    expect(String(loopDelay[0].leaf.value)).toBe("2"); // raw, not "20 ms"
    expect(loopDelay[0].leaf.details?.format).toBe("%d0 ms"); // verified unit, passed through
  });

  it("renders menu-only actions/status as non-persistent nodes with no REST identity", () => {
    const sidAddressing = result.pages.find((page) => page.title === "SID addressing")!;
    const menuOnly = sidAddressing.children.filter((node) => node.type === "menuOnly");
    expect(menuOnly.some((node) => node.type === "menuOnly" && node.label === "Visual SID address editor")).toBe(true);
    // The Visual SID address editor never appears as a rendered REST identity.
    expect(result.renderedRest.some((p) => p.item === "Visual SID address editor")).toBe(false);
  });

  it("routes evidence-backed leftovers onto aligned pages; evidence-less ones to the residual fallback", () => {
    // Sole-owner routing: C64 & Cartridge advanced → Memory & ROMs; LedStrip → LED lighting.
    expect(advancedPageOf(result, "C64 and Cartridge Settings", "Fast Reset")).toBe("Memory & ROMs");
    expect(advancedPageOf(result, "C64 and Cartridge Settings", "REU Preload")).toBe("Memory & ROMs");
    expect(advancedPageOf(result, "LED Strip Settings", "LedStrip SID Select")).toBe("LED lighting");

    // Keyword routing splits the multi-owner U64 Specific leftovers by topic.
    expect(advancedPageOf(result, "U64 Specific Settings", "HDMI Tx Swing")).toBe("Video setup");
    expect(advancedPageOf(result, "U64 Specific Settings", "Adjust Color Clock")).toBe("Video setup");
    expect(advancedPageOf(result, "U64 Specific Settings", "UserPort Power Enable")).toBe("Joystick & controllers");
    expect(advancedPageOf(result, "U64 Specific Settings", "Serial Bus Mode")).toBe("Built-in drive A");
    expect(advancedPageOf(result, "U64 Specific Settings", "SpeedDOS Parallel Cable")).toBe("Built-in drive A");

    // Evidence-less leftovers go to the residual fallback (NOT a guessed page).
    // `C64U Model` is a hardware edition absent from the captured menu — it must not be
    // mis-homed on Video setup.
    expect(advancedPageOf(result, "U64 Specific Settings", "C64U Model")).toBeUndefined();
    expect(fallbackLeaf(result, "U64 Specific Settings", "C64U Model")).toBeDefined();
    // Categories with no menu page at all surface in the residual fallback.
    expect(fallbackLeaf(result, "SoftIEC Drive Settings", "IEC Drive")).toBeDefined();
    expect(fallbackLeaf(result, "Tape Settings", "Tape Playback Rate")).toBeDefined();
    expect(fallbackLeaf(result, "Data Streams", "Stream VIC to")).toBeDefined();
    // ...and NOT on the speculative pages the old category-default tier used.
    expect(advancedPageOf(result, "Tape Settings", "Tape Playback Rate")).toBeUndefined();
    expect(advancedPageOf(result, "SoftIEC Drive Settings", "IEC Drive")).toBeUndefined();
    expect(advancedPageOf(result, "Data Streams", "Stream VIC to")).toBeUndefined();

    // A routed advanced leaf keeps canonical {category,item} for write-back + its label.
    const routed = result.pages
      .find((page) => page.title === "Video setup")!
      .advanced.flatMap((group) => group.leaves)
      .find((leaf) => leaf.rest.item === "HDMI Tx Swing")!;
    expect(routed.rest).toEqual({ category: "U64 Specific Settings", item: "HDMI Tx Swing" });
    expect(routed.label).toBe("HDMI Tx Swing");

    // A residual leaf likewise keeps canonical identity (write-back is unaffected by placement).
    const residual = fallbackLeaf(result, "Tape Settings", "Tape Playback Rate")!;
    expect(residual.rest).toEqual({ category: "Tape Settings", item: "Tape Playback Rate" });
  });
});

describe("projectConfigToMenu — Layer A applies in the REST-grouped (null) layout too", () => {
  it("relabels shared items and keeps device-specific categories (Clock Settings) editable", () => {
    const live = loadFixture(FIXTURES.u64e_312a);
    const result = projectConfigToMenu(live, { hierarchy: null, overlay: TERMINOLOGY_OVERLAY });
    const leaves = pageLeaves(result);
    const netmask = leaves.find(
      (entry) => entry.leaf.rest.category === "Ethernet Settings" && entry.leaf.rest.item === "Static Netmask",
    )!;
    expect(netmask.leaf.label).toBe("Static netmask"); // Layer A relabel, no hierarchy needed
    // Clock Settings (U64e-only, no C64U menu home) renders fully + editable.
    const clock = leaves.filter((entry) => entry.leaf.rest.category === "Clock Settings");
    expect(clock.length).toBeGreaterThanOrEqual(7);
    expect(clock.find((entry) => entry.leaf.rest.item === "Year")!.leaf.rest).toEqual({
      category: "Clock Settings",
      item: "Year",
    });
  });
});

describe("projectConfigToMenu — unknown/future category stays reachable + editable", () => {
  it("routes a never-seen category (U2 'Audio Output Settings' stand-in) to the fallback, write identity intact", () => {
    const live = loadFixture(FIXTURES.c64u_110);
    // Inject a synthetic category that exists in NO sample and NO menu.
    live.categories["Audio Output Settings"] = {
      "Speaker Volume": { value: "Medium", options: ["Off", "Low", "Medium", "High"] },
      "Headphone Mode": { value: "Stereo", options: ["Mono", "Stereo"] },
    };
    live.categoryOrder.push("Audio Output Settings");

    const result = projectC64U(live, "1.1.0");
    // Lossless still holds with the unknown category present.
    expect(renderedRestKeySet(result)).toEqual(liveRestKeySet(live));
    const synthetic = result.fallback.find((group) => group.category === "Audio Output Settings");
    expect(synthetic).toBeDefined();
    const speaker = synthetic!.leaves.find((leaf) => leaf.rest.item === "Speaker Volume")!;
    // Renders + a write would issue the correct {category,item}.
    expect(speaker.rest).toEqual({ category: "Audio Output Settings", item: "Speaker Volume" });
    expect(speaker.value).toBe("Medium");
    // No menu label → humanized.
    expect(speaker.label).toBe("Speaker Volume");
  });
});
