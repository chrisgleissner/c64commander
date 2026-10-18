/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { LIGHTING_CIRCADIAN_PERIOD_LABELS, LIGHTING_SOURCE_BUCKET_LABELS } from "@/lib/lighting/constants";
import type {
  LightingCircadianPeriod,
  LightingCircadianResolvedLocation,
  LightingConnectionSentinelState,
  LightingProfile,
  LightingStudioPlaybackContext,
  LightingStudioState,
} from "@/lib/lighting/types";

export type LightingContextSignal = {
  id: "profile" | "connection" | "source" | "circadian" | "quiet-launch" | "manual-lock" | "preview";
  label: string;
  value: string;
};

export type LightingContextSignalInput = {
  studioState: LightingStudioState;
  activeProfile: LightingProfile | null;
  connectionState: LightingConnectionSentinelState | null;
  circadian: {
    period: LightingCircadianPeriod;
    nextBoundaryLabel: string;
    resolvedLocation: LightingCircadianResolvedLocation;
  } | null;
  playbackContext: LightingStudioPlaybackContext;
  manualLockEnabled: boolean;
  previewActive: boolean;
};

const capitalize = (value: string) => `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;

const describeConnection = (input: LightingContextSignalInput) => {
  const sentinel = input.studioState.automation.connectionSentinel;
  if (!input.connectionState) return "Unknown";
  const state = capitalize(input.connectionState);
  if (!sentinel.enabled) return `${state}, rule off`;
  const mapped = sentinel.mappings[input.connectionState];
  const profile = mapped ? input.studioState.profiles.find((entry) => entry.id === mapped) : null;
  return profile ? `${state}, shows ${profile.name}` : `${state}, no profile mapped`;
};

const describeCircadian = (input: LightingContextSignalInput) => {
  if (!input.studioState.automation.circadian.enabled) return "Rule off";
  if (!input.circadian) return "On, unavailable";
  const period = LIGHTING_CIRCADIAN_PERIOD_LABELS[input.circadian.period];
  return `${period} in ${input.circadian.resolvedLocation.label}, next ${input.circadian.nextBoundaryLabel}`;
};

export const buildLightingContextSignals = (input: LightingContextSignalInput): LightingContextSignal[] => {
  const automation = input.studioState.automation;
  const sourceBucket = input.playbackContext.sourceBucket;
  const sourceRule = automation.sourceIdentityMap.enabled ? "" : ", rule off";
  return [
    { id: "profile", label: "Base profile", value: input.activeProfile?.name ?? "Device look" },
    { id: "connection", label: "Connection", value: describeConnection(input) },
    {
      id: "source",
      label: "Source",
      value: `${sourceBucket ? LIGHTING_SOURCE_BUCKET_LABELS[sourceBucket].replace(" look", "") : "None"}${sourceRule}`,
    },
    { id: "circadian", label: "Circadian", value: describeCircadian(input) },
    { id: "quiet-launch", label: "Quiet Launch", value: automation.quietLaunch.enabled ? "On" : "Rule off" },
    { id: "manual-lock", label: "Manual lock", value: input.manualLockEnabled ? "Held" : "Off" },
    { id: "preview", label: "Studio preview", value: input.previewActive ? "Active" : "None" },
  ];
};
