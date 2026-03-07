/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildEnabledSidMuteUpdates,
  buildEnabledSidRestoreUpdates,
  buildEnabledSidUnmuteUpdates,
  buildEnabledSidVolumeSnapshot,
  buildEnabledSidVolumeUpdates,
  buildSidEnablement,
  buildSidVolumeSteps,
  filterEnabledSidVolumeItems,
  isSidEnabledForName,
  type SidEnablement,
  type SidVolumeItem,
} from "@/lib/config/sidVolumeControl";
import { resolveAudioMixerMuteValue } from "@/lib/config/audioMixerSolo";

describe("sid volume control helpers", () => {
  const options = ["OFF", "+6 dB", " 0 dB", "-6 dB"];
  const items: SidVolumeItem[] = [
    { name: "Vol UltiSid 1", value: "+6 dB", options },
    { name: "Vol UltiSid 2", value: "OFF", options },
    { name: "Vol Socket 1", value: " 0 dB", options },
    { name: "Vol Socket 2", value: "-6 dB", options },
  ];

  it("maps socket and ultisid enablement from config categories", () => {
    const sockets = {
      "SID Sockets Configuration": {
        items: {
          "SID Socket 1": { selected: "Enabled" },
          "SID Socket 2": { selected: "Disabled" },
        },
      },
    };
    const addressing = {
      "SID Addressing": {
        items: {
          "UltiSID 1 Address": { selected: "Unmapped" },
          "UltiSID 2 Address": { selected: "$D400" },
        },
      },
    };

    expect(buildSidEnablement(sockets, addressing)).toEqual({
      socket1: true,
      socket2: false,
      ultiSid1: false,
      ultiSid2: true,
    });
  });

  it("filters volume updates to enabled SIDs only", () => {
    const enablement: SidEnablement = {
      socket1: true,
      socket2: false,
      ultiSid1: true,
      ultiSid2: false,
    };
    const enabled = filterEnabledSidVolumeItems(items, enablement);
    expect(enabled.map((item) => item.name)).toEqual(["Vol UltiSid 1", "Vol Socket 1"]);

    const updates = buildEnabledSidVolumeUpdates(items, enablement, "-6 dB");
    expect(updates).toEqual({
      "Vol UltiSid 1": "-6 dB",
      "Vol Socket 1": "-6 dB",
    });
  });

  it("mutes and restores only enabled SIDs", () => {
    const enablement: SidEnablement = {
      socket1: true,
      socket2: false,
      ultiSid1: true,
      ultiSid2: false,
    };
    const muteValue = resolveAudioMixerMuteValue(options);
    const muteUpdates = buildEnabledSidMuteUpdates(items, enablement);
    expect(muteUpdates).toEqual({
      "Vol UltiSid 1": muteValue,
      "Vol Socket 1": muteValue,
    });

    const snapshot = buildEnabledSidVolumeSnapshot(items, enablement);
    const afterDisable: SidEnablement = {
      socket1: true,
      socket2: false,
      ultiSid1: false,
      ultiSid2: false,
    };
    const unmuteUpdates = buildEnabledSidUnmuteUpdates(snapshot, afterDisable);
    expect(unmuteUpdates).toEqual({
      "Vol Socket 1": " 0 dB",
    });
  });

  it("restores from snapshot or falls back to target volume", () => {
    const enablement: SidEnablement = {
      socket1: true,
      socket2: true,
      ultiSid1: false,
      ultiSid2: false,
    };
    const snapshot = buildEnabledSidVolumeSnapshot(items, enablement);
    const restoreFromSnapshot = buildEnabledSidRestoreUpdates(items, enablement, snapshot, null);
    expect(restoreFromSnapshot).toEqual({
      "Vol Socket 1": " 0 dB",
      "Vol Socket 2": "-6 dB",
    });

    const restoreFromFallback = buildEnabledSidRestoreUpdates(items, enablement, null, "+6 dB");
    expect(restoreFromFallback).toEqual({
      "Vol Socket 1": "+6 dB",
      "Vol Socket 2": "+6 dB",
    });
  });

  it("orders volume steps from OFF to max", () => {
    const steps = buildSidVolumeSteps(options);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0]?.isOff).toBe(true);
    const numericSteps = steps.filter((step) => !step.isOff && step.numeric !== null);
    expect(numericSteps[0]?.numeric).toBe(-6);
    expect(numericSteps[numericSteps.length - 1]?.numeric).toBe(6);
  });

  it("handles empty and non-off volume option lists", () => {
    expect(buildSidVolumeSteps([])).toEqual([]);

    const noOffSteps = buildSidVolumeSteps([" +9 dB ", "n/a", "-3 dB"]);
    expect(noOffSteps.map((step) => step.option)).toEqual(["-3 dB", " +9 dB "]);
    expect(noOffSteps.every((step) => !step.isOff)).toBe(true);
  });

  it("maps enablement from flat payload values and retains unknown names", () => {
    const sockets = {
      items: {
        "SID Socket 1": 1,
        "SID Socket 2": { selected: "" },
      },
    };
    const addressing = {
      items: {
        "UltiSID 1 Address": { selected: "OFF" },
        "UltiSID 2 Address": { selected: "$D500" },
      },
    };

    expect(buildSidEnablement(sockets, addressing)).toEqual({
      socket1: true,
      socket2: undefined,
      ultiSid1: false,
      ultiSid2: true,
    });

    expect(
      isSidEnabledForName("Filter Mode", {
        socket1: false,
        socket2: false,
        ultiSid1: false,
        ultiSid2: false,
      }),
    ).toBe(true);
  });

  it("returns empty restore updates when no snapshot and no fallback target are available", () => {
    const updates = buildEnabledSidRestoreUpdates(
      items,
      { socket1: true, socket2: true, ultiSid1: true, ultiSid2: true },
      null,
      null,
    );
    expect(updates).toEqual({});
  });

  it("handles category payload without items wrapper (BRDA:60 block 17)", () => {
    // categoryData without .items → itemsData = categoryData (right side of ??)
    // Also tests itemConfig===undefined (BRDA:63 block 22) when item key missing
    const sockets = {
      "SID Sockets Configuration": {
        "SID Socket 1": { selected: "SID socket" },
        // 'SID Socket 2' intentionally absent → covers BRDA:63 (itemConfig===undefined)
      },
    };
    const addressing = {
      "SID Addressing": {
        "UltiSID 1 Address": { selected: "Unmapped" },
        "UltiSID 2 Address": { selected: "$D500" },
      },
    };

    const result = buildSidEnablement(sockets as any, addressing as any);

    // SID Socket 1 found (via no-items path), SID Socket 2 == undefined (missing key branch)
    expect(result.socket1).toBe(true);
    expect(result.socket2).toBeUndefined();
    expect(result.ultiSid1).toBe(false);
    expect(result.ultiSid2).toBe(true);
  });
});
