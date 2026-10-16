/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which phone the hardware merge gate drives for each stage, and what it does on each phone.
 *
 * HIL runs go to the keypad handset whenever it is attached. A stage the handset cannot run goes
 * to the Pixel, and with no Pixel it fails the default run rather than reporting a pass for a stage
 * nobody measured. A droidctl tunnel to the handset must never be mistaken for the Pixel, and the
 * DevTools forward must point at the app of the phone a stage is about to grade.
 */

import { describe, expect, it, vi } from "vitest";

import {
  DROIDCTL_FREE_STAGES,
  HANDSET_EXCLUSIONS,
  HANDSET_PACKAGE,
  PIXEL_PACKAGE,
  assertPageApp,
  controlsVolume,
  inputLayoutFor,
  phasesFor,
  preparePhone,
  resolveGatePlan,
  runPhases,
  stagePlacement,
  // @ts-expect-error -- a HIL harness is plain JavaScript with no type declarations.
} from "../../../tools/hil/gate_target.mjs";
// @ts-expect-error -- a HIL harness is plain JavaScript with no type declarations.
import { STAGE_NAMES } from "../../../tools/hil/merge_gate.mjs";

const pixel = { targetId: "adb:9B0A", serial: "9B0A", transport: "adb", state: "device", isEmulator: false };
const emulator = { ...pixel, targetId: "adb:emulator-5554", serial: "emulator-5554", isEmulator: true };
const tunnel = { ...pixel, targetId: "adb:127.0.0.1:44649", serial: "127.0.0.1:44649" };
const handset = {
  targetId: "ssh:user@handset",
  serial: "user@handset",
  transport: "ssh",
  state: "device",
  isEmulator: false,
  route: "container-adb",
};

const NON_PREFLIGHT = STAGE_NAMES.filter((name: string) => name !== "preflight");
const MIC_STAGES = ["av-clarity", "av-latency", "sid-remote", "sid-local", "crossfade"];
const HANDSET_STAGES = ["input", "search-latency", "wire"];

describe("resolveGatePlan", () => {
  it("uses the handset and the Pixel together when both are attached", () => {
    const plan = resolveGatePlan([pixel, handset, emulator]);
    expect(plan.handset).toMatchObject({ kind: "handset", packageName: HANDSET_PACKAGE });
    expect(plan.pixel).toMatchObject({ kind: "pixel", serial: "9B0A", packageName: PIXEL_PACKAGE });
    expect(plan.handsetOnly).toBe(false);
  });

  it("falls back to the Pixel alone when no handset is attached", () => {
    expect(resolveGatePlan([pixel, emulator])).toMatchObject({ handset: null, pixel: { serial: "9B0A" } });
  });

  it("does not drive a handset on the attach route, which cannot forward the WebView", () => {
    const attachRoute = { ...handset, route: "container-attach" };
    expect(resolveGatePlan([pixel, attachRoute])).toMatchObject({ handset: null, pixel: { serial: "9B0A" } });
    expect(() => resolveGatePlan([attachRoute], { mode: "handset" })).toThrow(
      /no keypad handset is drivable; listed but not drivable: user@handset \(device, route container-attach\)/,
    );
  });

  it("never takes droidctl's tunnel to the handset for the Pixel", () => {
    expect(resolveGatePlan([handset, tunnel])).toMatchObject({ handset: { kind: "handset" }, pixel: null });
    expect(() => resolveGatePlan([tunnel], { mode: "pixel" })).toThrow(/no Android device attached/);
  });

  it("keeps a Pixel run on the Pixel with the handset attached", () => {
    expect(resolveGatePlan([pixel, handset], { mode: "pixel" })).toMatchObject({
      handset: null,
      pixel: { serial: "9B0A" },
    });
  });

  it("makes an explicit handset run handset-only", () => {
    expect(resolveGatePlan([pixel, handset], { mode: "handset", modeExplicit: true })).toMatchObject({
      pixel: null,
      handsetOnly: true,
    });
  });

  it("lets a serial pick one phone, and refuses a --target that contradicts it", () => {
    expect(resolveGatePlan([pixel, handset], { serial: "9B0A" })).toMatchObject({ handset: null });
    expect(resolveGatePlan([pixel, handset], { serial: "user@handset" })).toMatchObject({ pixel: null });
    expect(() => resolveGatePlan([pixel, handset], { mode: "handset", modeExplicit: true, serial: "9B0A" })).toThrow(
      /--target handset contradicts the serial 9B0A, which is the pixel/,
    );
  });

  it("refuses an unknown mode", () => {
    expect(() => resolveGatePlan([pixel], { mode: "phone" })).toThrow(/--target must be one of/);
  });
});

describe("stagePlacement", () => {
  it("runs every stage on the Pixel when it is the only phone", () => {
    const plan = resolveGatePlan([pixel]);
    for (const name of STAGE_NAMES) expect(stagePlacement(name, plan)).toEqual({ phone: "pixel" });
  });

  it("runs the handset's stages there and the microphone stages on the Pixel", () => {
    const plan = resolveGatePlan([pixel, handset]);
    for (const name of HANDSET_STAGES) expect(stagePlacement(name, plan)).toEqual({ phone: "handset" });
    for (const name of MIC_STAGES) expect(stagePlacement(name, plan)).toEqual({ phone: "pixel" });
  });

  it("fails the default run for a stage no attached phone can run", () => {
    const plan = resolveGatePlan([handset]);
    for (const name of MIC_STAGES) {
      expect(stagePlacement(name, plan)).toMatchObject({
        verdict: { status: "fail", detail: expect.stringMatching(/no Pixel is attached to run it/) },
      });
    }
  });

  it("skips those stages, with the reason, on a run that asked for the handset alone", () => {
    const plan = resolveGatePlan([pixel, handset], { mode: "handset", modeExplicit: true });
    expect(stagePlacement("av-clarity", plan)).toEqual({
      verdict: { status: "skipped", detail: HANDSET_EXCLUSIONS["av-clarity"] },
    });
    expect(stagePlacement("crossfade", plan).verdict.detail).toMatch(/media volume is not under the gate's control/);
  });

  it("excludes only stages the gate registers, so a misspelt name cannot skip nothing", () => {
    expect(Object.keys(HANDSET_EXCLUSIONS).filter((name) => !STAGE_NAMES.includes(name))).toEqual([]);
    expect(DROIDCTL_FREE_STAGES.filter((name: string) => !STAGE_NAMES.includes(name))).toEqual([]);
  });
});

describe("phasesFor", () => {
  it("visits the handset first, then the Pixel for what the handset cannot run", () => {
    expect(phasesFor(resolveGatePlan([pixel, handset]), NON_PREFLIGHT)).toEqual([
      { phone: "handset", stages: HANDSET_STAGES },
      { phone: "pixel", stages: MIC_STAGES },
    ]);
  });

  it("has no Pixel phase and no stages for the excluded ones on a handset-only run", () => {
    expect(phasesFor(resolveGatePlan([handset]), NON_PREFLIGHT)).toEqual([
      { phone: "handset", stages: HANDSET_STAGES },
    ]);
  });
});

describe("what the gate does on each phone", () => {
  it("reads, steps and restores the media volume only on the Pixel", () => {
    expect(controlsVolume("pixel")).toBe(true);
    expect(controlsVolume("handset")).toBe(false);
    expect(controlsVolume(undefined)).toBe(false);
  });

  it("exercises each edition's own default joystick layout", () => {
    expect(inputLayoutFor("handset")).toBe("diamond8");
    expect(inputLayoutFor("pixel")).toBe("classicT9");
  });

  it("forwards the DevTools port to the phone's own app on both kinds", async () => {
    for (const phone of [resolveGatePlan([handset]).handset, resolveGatePlan([pixel]).pixel]) {
      const device = { forwardWebview: vi.fn() };
      await preparePhone(device, phone, "9333");
      expect(device.forwardWebview).toHaveBeenCalledWith(phone.packageName, 9333);
    }
  });

  it("refuses a page that belongs to the other edition", () => {
    const phone = resolveGatePlan([handset]).handset;
    expect(() => assertPageApp(HANDSET_PACKAGE, phone)).not.toThrow();
    expect(() => assertPageApp(PIXEL_PACKAGE, phone)).toThrow(
      /reaches uk\.gleissner\.c64commander, not uk\.gleissner\.c64uremote on the handset/,
    );
    expect(() => assertPageApp(null, phone)).toThrow(/reaches an unknown app/);
  });
});

describe("runPhases", () => {
  const recorder = ({ preflightPasses = true } = {}) => {
    const calls: string[] = [];
    const hooks = {
      record: (name: string, verdict: { status: string }) => calls.push(`record ${name} ${verdict.status}`),
      bind: (phone: { kind: string } | null) => calls.push(`bind ${phone?.kind ?? "none"}`),
      prepare: (phone: { kind: string }) => calls.push(`prepare ${phone.kind}`),
      preflight: (phone: { kind: string }) => {
        calls.push(`preflight ${phone.kind}`);
        return preflightPasses;
      },
      runStage: (name: string, phone: { kind: string }) => calls.push(`${name} ${phone.kind}`),
      restore: (phone: { kind: string }) => calls.push(`restore ${phone.kind}`),
    };
    return { calls, hooks };
  };

  it("forwards, preflights, runs and restores each phone in turn, the handset first", async () => {
    const { calls, hooks } = recorder();
    const plan = resolveGatePlan([pixel, handset]);
    await runPhases({ plan, selected: ["input", "av-clarity"], wantPreflight: true, hooks });
    expect(calls).toEqual([
      "bind handset",
      "prepare handset",
      "preflight handset",
      "input handset",
      "restore handset",
      "bind pixel",
      "prepare pixel",
      "preflight pixel",
      "av-clarity pixel",
      "restore pixel",
      "bind none",
    ]);
  });

  it("records the stages no phone can run before driving any phone", async () => {
    const { calls, hooks } = recorder();
    await runPhases({ plan: resolveGatePlan([handset]), selected: ["wire", "sid-local"], wantPreflight: false, hooks });
    expect(calls).toEqual([
      "record sid-local fail",
      "bind handset",
      "prepare handset",
      "wire handset",
      "restore handset",
      "bind none",
    ]);
  });

  it("stops at a failed preflight and unbinds the phone", async () => {
    const { calls, hooks } = recorder({ preflightPasses: false });
    const outcome = await runPhases({
      plan: resolveGatePlan([pixel, handset]),
      selected: ["input", "av-clarity"],
      wantPreflight: true,
      hooks,
    });
    expect(outcome).toEqual({ aborted: "handset" });
    expect(calls).toEqual(["bind handset", "prepare handset", "preflight handset", "bind none"]);
  });

  it("still preflights every phone in the plan when preflight is the only stage asked for", async () => {
    const { calls, hooks } = recorder();
    await runPhases({ plan: resolveGatePlan([pixel, handset]), selected: [], wantPreflight: true, hooks });
    expect(calls.filter((call) => call.startsWith("preflight"))).toEqual(["preflight handset", "preflight pixel"]);
  });
});
