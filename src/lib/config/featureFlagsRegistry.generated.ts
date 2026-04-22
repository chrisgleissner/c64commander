/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// AUTO-GENERATED FILE. Do not edit by hand.
// Source:   src/lib/config/feature-flags.yaml
// Compiler: scripts/compile-feature-flags.mjs
// Run `node scripts/compile-feature-flags.mjs` to regenerate.

export const FEATURE_REGISTRY_VERSION = 1 as const;

export type FeatureFlagId = "hvsc_enabled" | "commoserve_enabled" | "lighting_studio_enabled" | "reu_snapshot_enabled";

export type FeatureFlagGroupKey = keyof typeof FEATURE_FLAG_GROUPS;

export interface FeatureFlagGroupMetadata {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export interface FeatureFlagDefinition {
  readonly id: FeatureFlagId;
  readonly enabled: boolean;
  readonly visible_to_user: boolean;
  readonly developer_only: boolean;
  readonly group: string;
  readonly title: string;
  readonly description: string;
}

export const FEATURE_FLAG_GROUPS = {
  stable: {
    key: "stable",
    label: "Stable Features",
    description: "Fully supported and production-ready capabilities.",
  },
  experimental: {
    key: "experimental",
    label: "Experimental Features",
    description: "Unstable or rollout-controlled capabilities.",
  },
} as const satisfies Record<string, FeatureFlagGroupMetadata>;

export const FEATURE_FLAG_DEFINITIONS: readonly FeatureFlagDefinition[] = [
  {
    id: "hvsc_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "HVSC downloads",
    description: "Show HVSC download and ingest controls on the Play page.",
  },
  {
    id: "commoserve_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "CommoServe",
    description: "Show the CommoServe source in Add Items and Online Archive flows.",
  },
  {
    id: "lighting_studio_enabled",
    enabled: false,
    visible_to_user: false,
    developer_only: true,
    group: "experimental",
    title: "Lighting Studio",
    description: "Enable Lighting Studio entry points and dialog access.",
  },
  {
    id: "reu_snapshot_enabled",
    enabled: false,
    visible_to_user: false,
    developer_only: true,
    group: "experimental",
    title: "REU Snapshots",
    description: "Enable Save REU and Restore REU Snapshot functionality.",
  },
] as const;

export const FEATURE_FLAG_IDS: readonly FeatureFlagId[] = FEATURE_FLAG_DEFINITIONS.map((definition) => definition.id);

export const FEATURE_FLAG_DEFINITION_BY_ID: Readonly<Record<FeatureFlagId, FeatureFlagDefinition>> = Object.freeze(
  FEATURE_FLAG_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.id] = definition;
      return acc;
    },
    {} as Record<FeatureFlagId, FeatureFlagDefinition>,
  ),
);
