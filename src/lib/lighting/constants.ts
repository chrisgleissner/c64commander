/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
  LightingAutomationState,
  LightingCategoryName,
  LightingCircadianPeriod,
  LightingProfile,
  LightingSourceBucket,
  LightingSurface,
} from "@/lib/lighting/types";

export const LIGHTING_SURFACE_TO_CATEGORY: Record<LightingSurface, LightingCategoryName> = {
  case: "LED Strip Settings",
  keyboard: "Keyboard Lighting",
};

export const LIGHTING_CATEGORY_ITEMS = [
  "LedStrip Mode",
  "LedStrip Auto SID Mode",
  "LedStrip Pattern",
  "Fixed Color",
  "Fixed Color Red",
  "Fixed Color Green",
  "Fixed Color Blue",
  "Strip Intensity",
  "LedStrip SID Select",
  "Color tint",
  "LedStrip Type",
  "LedStrip Length",
] as const;

export const LIGHTING_COMPOSE_PRESET_LABELS = {
  mirror: "Mirror",
  contrast: "Contrast",
  "keyboard-focus": "Keyboard Focus",
  "case-halo": "Case Halo",
} as const;

export const LIGHTING_SOURCE_BUCKET_LABELS: Record<LightingSourceBucket, string> = {
  local: "Local look",
  c64u: "C64U look",
  hvsc: "HVSC look",
  commoserve: "CommoServe look",
  disks: "Disk look",
  idle: "Idle look",
};

export const LIGHTING_CIRCADIAN_PERIOD_LABELS: Record<LightingCircadianPeriod, string> = {
  morning: "Morning",
  day: "Day",
  evening: "Evening",
  night: "Night",
};

export const LIGHTING_QUIET_LAUNCH_WINDOW_MS = 45_000;
export const LIGHTING_CONNECTION_HOLD_MS = 10_000;

export const LIGHTING_PERIOD_MODIFIERS: Record<
  LightingCircadianPeriod,
  {
    intensityMultiplier: number;
    tint: string;
  }
> = {
  morning: { intensityMultiplier: 1, tint: "Bright" },
  day: { intensityMultiplier: 1, tint: "Pure" },
  evening: { intensityMultiplier: 0.75, tint: "Pastel" },
  night: { intensityMultiplier: 0.35, tint: "Whisper" },
};

export const DEFAULT_LIGHTING_AUTOMATION_STATE: LightingAutomationState = {
  connectionSentinel: {
    enabled: false,
    mappings: {
      connected: "bundled-connected",
      connecting: "bundled-connecting",
      retrying: "bundled-retrying",
      disconnected: "bundled-disconnected",
      demo: "bundled-demo",
      error: "bundled-error",
    },
  },
  quietLaunch: {
    enabled: false,
    profileId: "bundled-quiet-launch",
    windowMs: LIGHTING_QUIET_LAUNCH_WINDOW_MS,
  },
  sourceIdentityMap: {
    enabled: false,
    mappings: {
      local: "bundled-source-local",
      c64u: "bundled-source-c64u",
      hvsc: "bundled-source-hvsc",
      disks: "bundled-source-disks",
      idle: null,
    },
  },
  circadian: {
    enabled: false,
    locationPreference: {
      useDeviceLocation: false,
      manualCoordinates: null,
      city: "London",
    },
  },
};

const nowIso = () => new Date(0).toISOString();

export const BUNDLED_LIGHTING_PROFILES: LightingProfile[] = [
  {
    id: "bundled-connected",
    name: "Connected Calm",
    bundled: true,
    pinned: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 20, tint: "Pure" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 18, tint: "Pure" },
    },
  },
  {
    id: "bundled-connecting",
    name: "Connecting Pulse",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Yellow" }, intensity: 16, tint: "Warm" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Yellow" }, intensity: 14, tint: "Warm" },
    },
  },
  {
    id: "bundled-retrying",
    name: "Retry Amber",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Orange" }, intensity: 20, tint: "Warm" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Orange" }, intensity: 16, tint: "Warm" },
    },
  },
  {
    id: "bundled-disconnected",
    name: "Disconnected Alert",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Red" }, intensity: 22, tint: "Warm" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Red" }, intensity: 22, tint: "Warm" },
    },
  },
  {
    id: "bundled-demo",
    name: "Demo Bronze",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Orange" }, intensity: 14, tint: "Pastel" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Yellow" }, intensity: 12, tint: "Pastel" },
    },
  },
  {
    id: "bundled-error",
    name: "Error Beacon",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Magenta" }, intensity: 24, tint: "Bright" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Red" }, intensity: 24, tint: "Bright" },
    },
  },
  {
    id: "bundled-quiet-launch",
    name: "Quiet Launch",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Blue" }, intensity: 6, tint: "Whisper" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Blue" }, intensity: 4, tint: "Whisper" },
    },
  },
  {
    id: "bundled-source-local",
    name: "Local Identity",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Blue" }, intensity: 18, tint: "Pure" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Light Blue" }, intensity: 14, tint: "Pure" },
    },
  },
  {
    id: "bundled-source-c64u",
    name: "C64U Identity",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 18, tint: "Pure" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Light Green" }, intensity: 14, tint: "Pure" },
    },
  },
  {
    id: "bundled-source-hvsc",
    name: "HVSC Identity",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Purple" }, intensity: 18, tint: "Pastel" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Fuchsia" }, intensity: 14, tint: "Pastel" },
    },
  },
  {
    id: "bundled-source-disks",
    name: "Disk Identity",
    bundled: true,
    savedAt: nowIso(),
    surfaces: {
      case: { mode: "Fixed Color", color: { kind: "named", value: "Magenta" }, intensity: 18, tint: "Warm" },
      keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Red" }, intensity: 14, tint: "Warm" },
    },
  },
];
