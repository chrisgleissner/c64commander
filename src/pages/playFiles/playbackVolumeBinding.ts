/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Point the Play page's Mute button and volume slider at whichever route is actually sounding.
 *
 * The two routes have nothing in common behind the control. On the C64 route the slider writes the
 * Ultimate's Audio Mixer and its position is synchronised back from what the Ultimate reports; on
 * this device it attenuates the rendered PCM before it reaches the speaker, and no Ultimate is
 * involved — nor is Android's own media volume, which the app must never move on the listener's
 * behalf.
 *
 * Mixing the two is what made the control useless for on-device playback. Every drag went through
 * the C64 route's draft handler as well, so the Ultimate's synchronisation loop kept pulling the
 * slider back to the Ultimate's level a moment after it was released. What a listener saw was a
 * slider that sprang back and a sound that never changed.
 */

import type { SidVolumeOption } from "@/lib/config/sidVolumeControl";
import { LOCAL_VOLUME_STEPS, localVolumeLabelForIndex } from "@/lib/playback/localPlaybackVolume";
import type { PlaybackRoute } from "@/lib/playback/playbackEngineRouting";
import type { VolumeControlsProps } from "@/pages/playFiles/components/VolumeControls";

/** Everything about the control that depends on which route is playing. */
export type PlaybackVolumeBinding = Pick<
  VolumeControlsProps,
  | "volumeMuted"
  | "canControlVolume"
  | "onToggleMute"
  | "volumeStepsCount"
  | "volumeIndex"
  | "onVolumeDraftChange"
  | "onVolumePreview"
  | "onVolumeCommit"
  | "volumeLabel"
  | "volumeValueFormatter"
>;

/** On-device playback: one step index, applied to the engine's output gain. */
export interface LocalVolumeRouting {
  index: number;
  muted: boolean;
  /** Move both the slider and the engine's output level to this step. */
  onIndexChange: (index: number) => void;
  onToggleMute: () => void;
}

/** The C64 route, as `useVolumeOverride` exposes it. */
export interface DeviceVolumeRouting {
  index: number;
  muted: boolean;
  steps: SidVolumeOption[];
  canControl: boolean;
  onDraftChange: (index: number) => void;
  onPreview: (index: number) => void | Promise<void>;
  onCommit: (index: number) => void | Promise<void>;
  onToggleMute: () => void;
}

export const resolvePlaybackVolumeBinding = ({
  route,
  local,
  device,
}: {
  route: PlaybackRoute;
  local: LocalVolumeRouting;
  device: DeviceVolumeRouting;
}): PlaybackVolumeBinding => {
  if (route === "local") {
    return {
      volumeMuted: local.muted,
      // The scale is the app's own, so it is available whether or not an Ultimate is connected —
      // which is the ordinary case for a station played on this device.
      canControlVolume: true,
      onToggleMute: local.onToggleMute,
      volumeStepsCount: LOCAL_VOLUME_STEPS.length,
      volumeIndex: local.index,
      // Draft, preview and commit are the same act here: there is no device to spare a round trip to,
      // and the gain change is a ramp inside the sink, so following the finger costs nothing.
      onVolumeDraftChange: local.onIndexChange,
      onVolumePreview: local.onIndexChange,
      onVolumeCommit: local.onIndexChange,
      volumeLabel: localVolumeLabelForIndex(local.index),
      volumeValueFormatter: (value: number) => localVolumeLabelForIndex(Math.round(value)),
    };
  }

  return {
    volumeMuted: device.muted,
    canControlVolume: device.canControl,
    onToggleMute: device.onToggleMute,
    volumeStepsCount: device.steps.length,
    volumeIndex: device.index,
    onVolumeDraftChange: device.onDraftChange,
    onVolumePreview: device.onPreview,
    onVolumeCommit: device.onCommit,
    volumeLabel: device.steps[device.index]?.label ?? "—",
    volumeValueFormatter: (value: number) => device.steps[Math.round(value)]?.label ?? "—",
  };
};
