/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The Play page's Mute and volume controls have to reach whichever route is sounding, and only that
 * one. On this device they attenuate the rendered PCM; on the C64 route they write the Ultimate's
 * Audio Mixer. Blending the two is what made the control useless for on-device playback: the
 * Ultimate's synchronisation loop pulled the slider back to the Ultimate's level after every drag.
 */

import { describe, expect, it, vi } from "vitest";
import { buildSidVolumeSteps } from "@/lib/config/sidVolumeControl";
import { LOCAL_VOLUME_STEPS } from "@/lib/playback/localPlaybackVolume";
import {
  resolvePlaybackVolumeBinding,
  type DeviceVolumeRouting,
  type LocalVolumeRouting,
} from "@/pages/playFiles/playbackVolumeBinding";

const deviceSteps = buildSidVolumeSteps(["OFF", "+6 dB", " 0 dB", "-6 dB", "-42 dB"]);

const buildLocal = (overrides: Partial<LocalVolumeRouting> = {}): LocalVolumeRouting => ({
  index: 4,
  muted: false,
  onIndexChange: vi.fn(),
  onToggleMute: vi.fn(),
  ...overrides,
});

const buildDevice = (overrides: Partial<DeviceVolumeRouting> = {}): DeviceVolumeRouting => ({
  index: 2,
  muted: false,
  steps: deviceSteps,
  canControl: true,
  onDraftChange: vi.fn(),
  onPreview: vi.fn(),
  onCommit: vi.fn(),
  onToggleMute: vi.fn(),
  ...overrides,
});

describe("which route the Play page's volume control reaches", () => {
  it("keeps every on-device gesture away from the Ultimate's mixer", () => {
    const local = buildLocal();
    const device = buildDevice();

    const binding = resolvePlaybackVolumeBinding({ route: "local", local, device });
    binding.onVolumeDraftChange(7);
    void binding.onVolumePreview(7);
    void binding.onVolumeCommit(7);
    binding.onToggleMute();

    expect(local.onIndexChange).toHaveBeenCalledTimes(3);
    expect(local.onIndexChange).toHaveBeenCalledWith(7);
    expect(local.onToggleMute).toHaveBeenCalledTimes(1);
    // Nothing reaches the C64 route. The draft handler is the one that mattered: it used to run on
    // every drag regardless of route, and it is what fed the synchronisation loop that sprang the
    // slider back.
    expect(device.onDraftChange).not.toHaveBeenCalled();
    expect(device.onPreview).not.toHaveBeenCalled();
    expect(device.onCommit).not.toHaveBeenCalled();
    expect(device.onToggleMute).not.toHaveBeenCalled();
  });

  it("offers the app's own decibel ladder on this device, so no Ultimate has to be connected", () => {
    // With the ladder taken from the device, an unconnected app left the slider with one position and
    // a readout of "—", and every move resolved to a step that does not exist — which scores as zero
    // gain. A control that can only mute is worse than one that does nothing.
    const binding = resolvePlaybackVolumeBinding({
      route: "local",
      local: buildLocal({ index: 4 }),
      device: buildDevice({ steps: [], canControl: false }),
    });

    expect(binding.canControlVolume).toBe(true);
    expect(binding.volumeStepsCount).toBe(LOCAL_VOLUME_STEPS.length);
    expect(binding.volumeStepsCount).toBeGreaterThan(1);
    expect(binding.volumeLabel).toBe(LOCAL_VOLUME_STEPS[4].label);
    expect(binding.volumeValueFormatter?.(4)).toBe(LOCAL_VOLUME_STEPS[4].label);
  });

  it("reads the level in decibels, the same scale the C64 route uses", () => {
    // Somebody who has learnt that "-6 dB" is a comfortable evening level should not have to learn a
    // second scale because the sound is now coming out of the phone.
    const labels = LOCAL_VOLUME_STEPS.map((step) => step.label);

    expect(labels[0]).toBe("OFF");
    expect(labels[1]).toBe("-42 dB");
    expect(labels).toContain("-6 dB");
    expect(labels[labels.length - 1]).toBe("+6 dB");
  });

  it("shows on-device mute without moving the slider off the step the listener chose", () => {
    const binding = resolvePlaybackVolumeBinding({
      route: "local",
      local: buildLocal({ index: 9, muted: true }),
      device: buildDevice(),
    });

    expect(binding.volumeMuted).toBe(true);
    expect(binding.volumeIndex).toBe(9);
    expect(binding.volumeLabel).toBe(LOCAL_VOLUME_STEPS[9].label);
  });

  it("leaves the C64 route exactly as it was", () => {
    const local = buildLocal();
    const device = buildDevice({ index: 3, muted: true, canControl: false });

    const binding = resolvePlaybackVolumeBinding({ route: "c64", local, device });
    binding.onVolumeDraftChange(1);
    void binding.onVolumePreview(2);
    void binding.onVolumeCommit(3);
    binding.onToggleMute();

    expect(device.onDraftChange).toHaveBeenCalledWith(1);
    expect(device.onPreview).toHaveBeenCalledWith(2);
    expect(device.onCommit).toHaveBeenCalledWith(3);
    expect(device.onToggleMute).toHaveBeenCalledTimes(1);
    expect(binding.volumeMuted).toBe(true);
    expect(binding.canControlVolume).toBe(false);
    expect(binding.volumeStepsCount).toBe(deviceSteps.length);
    expect(binding.volumeIndex).toBe(3);
    expect(binding.volumeLabel).toBe(deviceSteps[3].label);
    // And none of it touches this device's engine.
    expect(local.onIndexChange).not.toHaveBeenCalled();
    expect(local.onToggleMute).not.toHaveBeenCalled();
  });
});
