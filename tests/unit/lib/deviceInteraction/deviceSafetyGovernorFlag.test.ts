/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateDeviceConnectionState } from "@/lib/deviceInteraction/deviceStateStore";
import {
  isDeviceSafetyGovernorEnabled,
  resetInteractionState,
  withRestInteraction,
} from "@/lib/deviceInteraction/deviceInteractionManager";
import { resetDeviceActivityGate } from "@/lib/deviceInteraction/deviceActivityGate";
import { saveDeviceSafetyMode } from "@/lib/config/deviceSafetySettings";

const action = {} as never;

type ProbeWindow = Window & { __c64uTestProbeEnabled?: boolean };
type ForceGlobal = { __c64uForceInteractionScheduling?: boolean };

const readInfoTwice = async () => {
  let handlerCalls = 0;
  const request = () =>
    withRestInteraction(
      {
        action,
        method: "GET",
        path: "/v1/info",
        normalizedUrl: "/v1/info",
        intent: "system",
        baseUrl: "http://c64u",
      },
      async () => {
        handlerCalls += 1;
        return "info";
      },
    );

  await request();
  await request();
  return handlerCalls;
};

// The slider-drag shape the review names: three user config writes issued back to
// back. Returns the highest number of handlers that were in flight at once.
const dragSlider = async () => {
  let active = 0;
  let maxActive = 0;
  let releaseAll!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });

  const write = (value: number) =>
    withRestInteraction(
      {
        action,
        method: "PUT",
        path: "/v1/configs/Audio%20Output%20Settings/Volume",
        normalizedUrl: "/v1/configs/Audio Output Settings/Volume",
        intent: "user",
        baseUrl: "http://c64u",
      },
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
        return value;
      },
    );

  const writes = [write(1), write(2), write(3)];
  await Promise.resolve();
  await Promise.resolve();
  releaseAll();
  await Promise.all(writes);
  return maxActive;
};

describe("device-safety governor flag (HARD27-036)", () => {
  beforeEach(() => {
    localStorage.clear();
    saveDeviceSafetyMode("BALANCED");
    updateDeviceConnectionState("REAL_CONNECTED");
    resetDeviceActivityGate();
    resetInteractionState("governor-flag-test");
  });

  afterEach(() => {
    delete process.env.VITE_DEVICE_SAFETY_GOVERNOR;
    delete (window as ProbeWindow).__c64uTestProbeEnabled;
    delete (globalThis as ForceGlobal).__c64uForceInteractionScheduling;
    resetDeviceActivityGate();
    resetInteractionState("governor-flag-cleanup");
    localStorage.clear();
  });

  it("is off by default in an automated environment", () => {
    expect(isDeviceSafetyGovernorEnabled()).toBe(false);
  });

  it("stays on in a probe build when VITE_DEVICE_SAFETY_GOVERNOR is 1", () => {
    (window as ProbeWindow).__c64uTestProbeEnabled = true;
    process.env.VITE_DEVICE_SAFETY_GOVERNOR = "1";

    expect(isDeviceSafetyGovernorEnabled()).toBe(true);
  });

  it("coalesces two identical reads in a probe build when the governor is declared on", async () => {
    (window as ProbeWindow).__c64uTestProbeEnabled = true;
    process.env.VITE_DEVICE_SAFETY_GOVERNOR = "1";

    await expect(readInfoTwice()).resolves.toBe(1);
  });

  it("records every read in a probe build when the governor is not declared", async () => {
    (window as ProbeWindow).__c64uTestProbeEnabled = true;

    await expect(readInfoTwice()).resolves.toBe(2);
  });

  it("serializes a slider drag's config writes in a probe build when the governor is declared on", async () => {
    (window as ProbeWindow).__c64uTestProbeEnabled = true;
    process.env.VITE_DEVICE_SAFETY_GOVERNOR = "1";
    saveDeviceSafetyMode("RELAXED");

    await expect(dragSlider()).resolves.toBe(1);
  });

  it("lets a slider drag's config writes overlap in a probe build when the governor is not declared", async () => {
    (window as ProbeWindow).__c64uTestProbeEnabled = true;
    saveDeviceSafetyMode("RELAXED");

    await expect(dragSlider()).resolves.toBe(3);
  });

  it("lets VITE_DEVICE_SAFETY_GOVERNOR=0 switch the governor off despite the force seam", () => {
    (globalThis as ForceGlobal).__c64uForceInteractionScheduling = true;
    process.env.VITE_DEVICE_SAFETY_GOVERNOR = "0";

    expect(isDeviceSafetyGovernorEnabled()).toBe(false);
  });

  it("keeps the force seam working when no build flag is set", () => {
    (window as ProbeWindow).__c64uTestProbeEnabled = true;
    (globalThis as ForceGlobal).__c64uForceInteractionScheduling = true;

    expect(isDeviceSafetyGovernorEnabled()).toBe(true);
  });
});
