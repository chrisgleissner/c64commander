/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  setAudioProcessing: vi.fn(),
  setSpectrumEnabled: vi.fn(),
  readSpectrum: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isPluginAvailable: () => true }, registerPlugin: () => plugin }));
vi.mock("@/lib/native/platform", () => ({ isNativePlatform: () => true }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { readSpectrum, resetAudioFxForTests } from "@/lib/native/audioFx";
import { resetPluginAvailabilityForTests } from "@/lib/native/pluginAvailability";

const frame = {
  enabled: true,
  active: true,
  sequence: 7,
  sampleRate: 48000,
  bands: new Array(48).fill(-100),
  peakDb: -6,
  rmsDb: -20,
  clipped: false,
};

describe("readSpectrum wave request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAudioFxForTests();
    resetPluginAvailabilityForTests();
    plugin.readSpectrum.mockResolvedValue(frame);
  });

  it("sends the wave and bands flags to the plugin even without a target time", async () => {
    await readSpectrum({ wave: true, bands: false });
    expect(plugin.readSpectrum).toHaveBeenCalledWith({ wave: true, bands: false });
  });

  it("still sends no request at all for a plain read", async () => {
    await readSpectrum({});
    expect(plugin.readSpectrum).toHaveBeenLastCalledWith(undefined);
  });

  it("returns the wave and its trigger flag from a frame, and from the frames ahead of it", async () => {
    const withWave = {
      ...frame,
      wave: "AAAA",
      waveTriggered: true,
      ahead: [{ ...frame, sequence: 8, wave: "AAAA", waveTriggered: false }],
    };
    plugin.readSpectrum.mockResolvedValue(withWave);
    expect(await readSpectrum({ wave: true, bands: false })).toEqual(withWave);
  });

  it("rejects a frame whose wave is not a string", async () => {
    plugin.readSpectrum.mockResolvedValue({ ...frame, wave: [1, 2, 3] });
    expect(await readSpectrum({ wave: true })).toBeNull();
  });

  it("rejects a frame whose trigger flag is not a boolean", async () => {
    plugin.readSpectrum.mockResolvedValue({ ...frame, wave: "AAAA", waveTriggered: "yes" });
    expect(await readSpectrum({ wave: true })).toBeNull();
  });
});
