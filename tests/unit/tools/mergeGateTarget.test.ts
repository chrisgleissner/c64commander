/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which phone the hardware merge gate drives, and which stages it reports as not runnable there.
 *
 * HIL runs go to the keypad handset whenever it is attached, and the Pixel stays the phone for
 * normal-phone behaviour and the fallback. A handset attached beside the Pixel must never change
 * which phone a Pixel run drives, and a stage that cannot run on the handset must be reported as
 * skipped with its reason, never graded against a microphone that is not there.
 */

import { describe, expect, it } from "vitest";

import {
  HANDSET_EXCLUSIONS,
  HANDSET_PACKAGE,
  PIXEL_PACKAGE,
  resolveGateTarget,
  stageExclusion,
  // @ts-expect-error -- a HIL harness is plain JavaScript with no type declarations.
} from "../../../tools/hil/gate_target.mjs";
// @ts-expect-error -- a HIL harness is plain JavaScript with no type declarations.
import { STAGE_NAMES } from "../../../tools/hil/merge_gate.mjs";

const pixel = { targetId: "adb:9B0A", serial: "9B0A", transport: "adb", state: "device", isEmulator: false };
const emulator = {
  targetId: "adb:emulator-5554",
  serial: "emulator-5554",
  transport: "adb",
  state: "device",
  isEmulator: true,
};
const handset = {
  targetId: "ssh:user@handset",
  serial: "user@handset",
  transport: "ssh",
  state: "device",
  isEmulator: false,
};

describe("resolveGateTarget", () => {
  it("drives the handset when it is attached, even beside the Pixel", () => {
    const chosen = resolveGateTarget([pixel, handset, emulator]);
    expect(chosen).toMatchObject({ kind: "handset", serial: "user@handset", packageName: HANDSET_PACKAGE });
  });

  it("falls back to the Pixel when no handset is attached", () => {
    expect(resolveGateTarget([pixel, emulator])).toMatchObject({ kind: "pixel", packageName: PIXEL_PACKAGE });
  });

  it("falls back to the Pixel when the handset is listed but not ready", () => {
    expect(resolveGateTarget([pixel, { ...handset, state: "booting" }])).toMatchObject({ kind: "pixel" });
  });

  it("keeps a Pixel run on the Pixel with the handset attached", () => {
    expect(resolveGateTarget([pixel, handset], { mode: "pixel" })).toMatchObject({
      kind: "pixel",
      serial: "9B0A",
    });
  });

  it("refuses a handset run when no handset is ready, naming what is listed", () => {
    expect(() => resolveGateTarget([pixel, { ...handset, state: "booting" }], { mode: "handset" })).toThrow(
      /no keypad handset is ready; listed but not ready: user@handset \(booting\)/,
    );
  });

  it("refuses a Pixel run with only the handset attached rather than driving it", () => {
    expect(() => resolveGateTarget([handset], { mode: "pixel" })).toThrow(/no Android device attached/);
  });

  it("lets an explicit serial choose the phone, and takes the kind from its transport", () => {
    expect(resolveGateTarget([pixel, handset], { serial: "9B0A" })).toMatchObject({ kind: "pixel" });
    expect(resolveGateTarget([pixel, handset], { mode: "pixel", serial: "user@handset" })).toMatchObject({
      kind: "handset",
    });
  });

  it("refuses an unknown mode", () => {
    expect(() => resolveGateTarget([pixel], { mode: "phone" })).toThrow(/--target must be one of/);
  });
});

describe("stageExclusion", () => {
  it("runs every stage on the Pixel", () => {
    for (const name of STAGE_NAMES) expect(stageExclusion(name, "pixel")).toBeNull();
  });

  it("runs the stages on the handset that need neither the microphone nor its media volume", () => {
    for (const name of ["preflight", "input", "search-latency", "wire"]) {
      expect(stageExclusion(name, "handset")).toBeNull();
    }
  });

  it("reports the microphone stages and crossfade as not runnable on the handset, with the reason", () => {
    for (const name of ["av-clarity", "av-latency", "sid-remote", "sid-local"]) {
      expect(stageExclusion(name, "handset")).toMatch(/not runnable on this target \(no microphone/);
    }
    expect(stageExclusion("crossfade", "handset")).toMatch(/media volume is not under the gate's control/);
  });

  it("excludes only stages the gate actually registers, so a misspelt name cannot skip nothing", () => {
    expect(Object.keys(HANDSET_EXCLUSIONS).filter((name) => !STAGE_NAMES.includes(name))).toEqual([]);
  });
});
