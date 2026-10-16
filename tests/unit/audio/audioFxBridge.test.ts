/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
const isPluginAvailable = vi.hoisted(() => vi.fn(() => true));
const plugin = vi.hoisted(() => ({
  setAudioProcessing: vi.fn(),
  setSpectrumEnabled: vi.fn(),
  readSpectrum: vi.fn(),
}));
const addLog = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({ Capacitor: { isPluginAvailable }, registerPlugin: () => plugin }));
vi.mock("@/lib/native/platform", () => ({ isNativePlatform }));
vi.mock("@/lib/logging", () => ({ addLog }));

import {
  isAudioFxAvailable,
  probeAudioFx,
  readSpectrum,
  resetAudioFxForTests,
  setAudioProcessing,
  setSpectrumEnabled,
} from "@/lib/native/audioFx";
import { resetPluginAvailabilityForTests } from "@/lib/native/pluginAvailability";

const params = { levelling: true, bassDb: 1, midDb: 2, trebleDb: 3, stereoWidth: 35, reverb: 25 };
const frame = {
  enabled: true,
  active: true,
  sequence: 7,
  sampleRate: 48000,
  bands: new Array(48).fill(-50),
  peakDb: -6,
  rmsDb: -20,
  clipped: false,
};

describe("audio fx bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAudioFxForTests();
    resetPluginAvailabilityForTests();
    isNativePlatform.mockReturnValue(true);
    isPluginAvailable.mockReturnValue(true);
    plugin.setAudioProcessing.mockResolvedValue({});
    plugin.setSpectrumEnabled.mockResolvedValue({});
    plugin.readSpectrum.mockResolvedValue(frame);
  });

  it("passes the calls to the plugin and reports success", async () => {
    expect(isAudioFxAvailable()).toBe(true);
    expect(await setAudioProcessing(params)).toBe(true);
    expect(plugin.setAudioProcessing).toHaveBeenCalledWith(params);
    expect(await setSpectrumEnabled(true)).toBe(true);
    expect(plugin.setSpectrumEnabled).toHaveBeenCalledWith({ enabled: true });
    expect(await readSpectrum()).toEqual(frame);
  });

  it("passes a look-ahead request to the plugin and keeps the frames ahead", async () => {
    const withAhead = { ...frame, aligned: true, ahead: [{ ...frame, sequence: 8 }] };
    plugin.readSpectrum.mockResolvedValue(withAhead);
    const request = { targetNanos: 5e13, count: 4, stepNanos: 16.7e6 };
    expect(await readSpectrum(request)).toEqual(withAhead);
    expect(plugin.readSpectrum).toHaveBeenCalledWith(request);
    await readSpectrum();
    expect(plugin.readSpectrum).toHaveBeenLastCalledWith(undefined);
  });

  it("rejects a reply whose frames ahead are malformed instead of passing it on", async () => {
    plugin.readSpectrum.mockResolvedValue({ ...frame, ahead: [{ sequence: 8 }] });
    expect(await readSpectrum({ targetNanos: 5e13, count: 2, stepNanos: 16.7e6 })).toBeNull();
    expect(addLog).toHaveBeenCalled();
  });

  it("does nothing on the web or without the plugin", async () => {
    isNativePlatform.mockReturnValue(false);
    expect(isAudioFxAvailable()).toBe(false);
    expect(await setAudioProcessing(params)).toBe(false);
    expect(await setSpectrumEnabled(true)).toBe(false);
    expect(await readSpectrum()).toBeNull();
    expect(await probeAudioFx()).toBe(false);
    isNativePlatform.mockReturnValue(true);
    isPluginAvailable.mockReturnValue(false);
    expect(isAudioFxAvailable()).toBe(false);
    expect(plugin.readSpectrum).not.toHaveBeenCalled();
  });

  it("uses a test backend only when test probes are enabled", async () => {
    isNativePlatform.mockReturnValue(false);
    const backend = { ...plugin, readSpectrum: vi.fn(async () => frame) };
    (window as unknown as Record<string, unknown>).__c64uAudioFxOverride = backend;
    expect(isAudioFxAvailable()).toBe(false);
    (window as unknown as Record<string, unknown>).__c64uTestProbeEnabled = true;
    expect(isAudioFxAvailable()).toBe(true);
    expect(await readSpectrum()).toEqual(frame);
    expect(backend.readSpectrum).toHaveBeenCalledTimes(1);
    delete (window as unknown as Record<string, unknown>).__c64uAudioFxOverride;
    delete (window as unknown as Record<string, unknown>).__c64uTestProbeEnabled;
  });

  it("latches an unimplemented method, logs it once and stops calling the plugin", async () => {
    plugin.readSpectrum.mockRejectedValue(Object.assign(new Error("not implemented"), { code: "UNIMPLEMENTED" }));
    expect(await probeAudioFx()).toBe(false);
    expect(isAudioFxAvailable()).toBe(false);
    expect(await readSpectrum()).toBeNull();
    expect(await setAudioProcessing(params)).toBe(false);
    expect(plugin.readSpectrum).toHaveBeenCalledTimes(1);
    expect(plugin.setAudioProcessing).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog.mock.calls[0][0]).toBe("info");
  });

  it("probes once and keeps the plugin when the probe call succeeds", async () => {
    expect(await probeAudioFx()).toBe(true);
    expect(await probeAudioFx()).toBe(true);
    expect(plugin.readSpectrum).toHaveBeenCalledTimes(1);
  });

  it("probes without changing the analyser, so a probe landing after the view enabled it cannot switch it off", async () => {
    expect(await setSpectrumEnabled(true)).toBe(true);
    expect(await probeAudioFx()).toBe(true);
    expect(plugin.setSpectrumEnabled).toHaveBeenCalledTimes(1);
    expect(plugin.setSpectrumEnabled).toHaveBeenLastCalledWith({ enabled: true });
  });

  it("logs the first failure of a streak with its stack, then only the recovery", async () => {
    plugin.readSpectrum.mockRejectedValue(new Error("bridge down"));
    for (let i = 0; i < 5; i++) expect(await readSpectrum()).toBeNull();
    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog.mock.calls[0][0]).toBe("warn");
    expect(String((addLog.mock.calls[0][2] as { error: string }).error)).toContain("bridge down");
    plugin.readSpectrum.mockResolvedValue(frame);
    expect(await readSpectrum()).toEqual(frame);
    expect(addLog).toHaveBeenCalledTimes(2);
    expect(addLog.mock.calls[1][1]).toContain("recovered after 5");
    await readSpectrum();
    expect(addLog).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed frame instead of drawing it", async () => {
    plugin.readSpectrum.mockResolvedValue({ bands: "no" });
    expect(await readSpectrum()).toBeNull();
    expect(addLog).toHaveBeenCalledTimes(1);
  });

  it("resolves no backend when test probes are on but no override is installed", async () => {
    isNativePlatform.mockReturnValue(false);
    (window as unknown as Record<string, unknown>).__c64uTestProbeEnabled = true;
    expect(isAudioFxAvailable()).toBe(false);
    expect(await readSpectrum()).toBeNull();
    delete (window as unknown as Record<string, unknown>).__c64uTestProbeEnabled;
  });

  it("reports false and logs once when setAudioProcessing fails for a reason other than unimplemented", async () => {
    plugin.setAudioProcessing.mockRejectedValue(new Error("bridge down"));
    expect(await setAudioProcessing(params)).toBe(false);
    expect(await setAudioProcessing(params)).toBe(false);
    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog.mock.calls[0][1]).toBe("Audio fx: setAudioProcessing failed");
    expect(isAudioFxAvailable()).toBe(true);
    plugin.setAudioProcessing.mockResolvedValue({});
    expect(await setAudioProcessing(params)).toBe(true);
    expect(addLog.mock.calls[1][1]).toContain("setAudioProcessing recovered after 2");
  });

  it("reports false and logs once when setSpectrumEnabled fails for a reason other than unimplemented", async () => {
    plugin.setSpectrumEnabled.mockRejectedValue("string failure");
    expect(await setSpectrumEnabled(true)).toBe(false);
    expect(addLog).toHaveBeenCalledTimes(1);
    expect((addLog.mock.calls[0][2] as { error: string }).error).toBe("string failure");
    plugin.setSpectrumEnabled.mockResolvedValue({});
    expect(await setSpectrumEnabled(false)).toBe(true);
    expect(addLog.mock.calls[1][1]).toContain("setSpectrumEnabled recovered after 1");
  });

  it("latches unavailable when setSpectrumEnabled is unimplemented and stops every later call", async () => {
    plugin.setSpectrumEnabled.mockRejectedValue(Object.assign(new Error("nope"), { code: "UNIMPLEMENTED" }));
    expect(await setSpectrumEnabled(true)).toBe(false);
    expect(isAudioFxAvailable()).toBe(false);
    expect(await setSpectrumEnabled(true)).toBe(false);
    expect(await readSpectrum()).toBeNull();
    expect(plugin.setSpectrumEnabled).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, 5, { bands: [], sequence: 1 }, { bands: [], sequence: "1", active: true }])(
    "rejects the malformed frame %j",
    async (bad) => {
      plugin.readSpectrum.mockResolvedValue(bad);
      expect(await readSpectrum()).toBeNull();
      expect(addLog).toHaveBeenCalledTimes(1);
    },
  );

  it("logs the message when a failing Error carries no stack", async () => {
    const error = new Error("no stack here");
    error.stack = undefined;
    plugin.readSpectrum.mockRejectedValue(error);
    expect(await readSpectrum()).toBeNull();
    expect((addLog.mock.calls[0][2] as { error: string }).error).toBe("no stack here");
  });

  it("resolves no test backend where there is no window", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(isAudioFxAvailable()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
