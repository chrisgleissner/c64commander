/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type LightingSurface = "case" | "keyboard";

export type LightingCategoryName = "LED Strip Settings" | "Keyboard Lighting";

export type LightingColorSpec = { kind: "named"; value: string } | { kind: "rgb"; r: number; g: number; b: number };

export type LightingSurfaceState = {
  mode?: string;
  pattern?: string;
  color?: LightingColorSpec;
  tint?: string;
  intensity?: number;
  sidSelect?: string;
};

export type LightingDeviceCapability = {
  surface: LightingSurface;
  category: LightingCategoryName;
  supported: boolean;
  supportedModes: string[];
  supportedPatterns: string[];
  supportedNamedColors: string[];
  supportsTint: boolean;
  supportedTints: string[];
  supportsSidSelect: boolean;
  supportedSidSelects: string[];
  intensityRange: { min: number; max: number };
  colorEncoding: "named" | "rgb" | null;
};

export type LightingProfile = {
  id: string;
  name: string;
  bundled?: boolean;
  pinned?: boolean;
  savedAt: string;
  surfaces: Partial<Record<LightingSurface, LightingSurfaceState>>;
};

export type LightingLinkMode = "linked" | "mirrored" | "independent";

export type LightingComposePreset = "mirror" | "contrast" | "keyboard-focus" | "case-halo";

export type LightingConnectionSentinelState =
  | "connected"
  | "connecting"
  | "retrying"
  | "disconnected"
  | "demo"
  | "error";

export type LightingSourceBucket = "local" | "c64u" | "hvsc" | "disks" | "idle";

export type LightingCircadianPeriod = "morning" | "day" | "evening" | "night";

export type LightingCircadianLocationPreference = {
  useDeviceLocation: boolean;
  manualCoordinates: { lat: number; lon: number } | null;
  city: string | null;
};

export type LightingCircadianResolvedLocation =
  | { source: "device"; lat: number; lon: number; label: string }
  | { source: "manual"; lat: number; lon: number; label: string }
  | { source: "city"; lat: number; lon: number; label: string }
  | { source: "unresolved"; label: string };

export type LightingAutomationState = {
  connectionSentinel: {
    enabled: boolean;
    mappings: Partial<Record<LightingConnectionSentinelState, string | null>>;
  };
  quietLaunch: {
    enabled: boolean;
    profileId: string | null;
    windowMs: number;
  };
  sourceIdentityMap: {
    enabled: boolean;
    mappings: Partial<Record<LightingSourceBucket, string | null>>;
  };
  circadian: {
    enabled: boolean;
    locationPreference: LightingCircadianLocationPreference;
  };
};

export type LightingStudioState = {
  activeProfileId: string | null;
  profiles: LightingProfile[];
  automation: LightingAutomationState;
  lastResolvedLocation: LightingCircadianResolvedLocation | null;
};

export type LightingResolverInput = {
  capabilities: Record<LightingSurface, LightingDeviceCapability>;
  rawDeviceState: Partial<Record<LightingSurface, LightingSurfaceState>>;
  studioState: LightingStudioState;
  previewState: Partial<Record<LightingSurface, LightingSurfaceState>> | null;
  manualLockState: Partial<Record<LightingSurface, LightingSurfaceState>> | null;
  manualLockEnabled: boolean;
  connectionState: LightingConnectionSentinelState | null;
  quietLaunchActive: boolean;
  sourceBucket: LightingSourceBucket | null;
  circadian: {
    period: LightingCircadianPeriod;
    nextBoundaryLabel: string;
    fallbackActive: boolean;
    resolvedLocation: LightingCircadianResolvedLocation;
  } | null;
};

export type LightingContextLensEntry = {
  surface: LightingSurface;
  owner:
  | "preview"
  | "connection-critical"
  | "manual-lock"
  | "quiet-launch"
  | "source-identity"
  | "circadian"
  | "connection-ambient"
  | "profile"
  | "device-fallback";
  label: string;
  detail: string;
};

export type LightingResolverOutput = {
  resolvedState: Partial<Record<LightingSurface, LightingSurfaceState>>;
  activeProfile: LightingProfile | null;
  activeAutomationChip: string | null;
  contextLens: LightingContextLensEntry[];
  sourceCue: {
    bucket: LightingSourceBucket;
    label: string;
  } | null;
  circadianChip: string | null;
};

export type LightingStudioPlaybackContext = {
  sourceBucket: LightingSourceBucket | null;
  activeItemLabel: string | null;
};
