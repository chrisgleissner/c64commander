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

export type FeatureFlagId = 
  | "hvsc_enabled"
  | "commoserve_enabled"
  | "demo_mode_enabled"
  | "background_execution_enabled"
  | "lighting_studio_enabled"
  | "ram_snapshots_enabled"
  | "home_telnet_reu_snapshot_enabled"
  | "home_telnet_config_actions_enabled"
  | "home_telnet_drive_actions_enabled"
  | "home_telnet_printer_actions_enabled"
  | "home_telnet_power_cycle_enabled"
  | "home_telnet_clear_ram_reboot_enabled"
  | "keypad_input_enabled";

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
    description: "Show the HVSC source in Add Items.",
  },
  {
    id: "commoserve_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "CommoServe",
    description: "Show the CommoServe source in Add Items.",
  },
  {
    id: "demo_mode_enabled",
    enabled: false,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "Demo Mode",
    description: "Allow the built-in simulated device mode in Settings and connection flows.",
  },
  {
    id: "background_execution_enabled",
    enabled: true,
    visible_to_user: false,
    developer_only: true,
    group: "experimental",
    title: "Background Execution",
    description: "Allow native background playback timing and auto-advance scheduling.",
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
    id: "ram_snapshots_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "RAM snapshots",
    description: "Show Save RAM and Load RAM actions on Home.",
  },
  {
    id: "home_telnet_reu_snapshot_enabled",
    enabled: false,
    visible_to_user: false,
    developer_only: true,
    group: "experimental",
    title: "REU Snapshots",
    description: "Enable Save REU and Restore REU Snapshot functionality on Home. Depends on the Telnet interface.",
  },
  {
    id: "home_telnet_config_actions_enabled",
    enabled: false,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Home advanced config actions",
    description: "Show advanced Home config actions (file save/load and Clear Flash). Depends on the Telnet interface.",
  },
  {
    id: "home_telnet_drive_actions_enabled",
    enabled: false,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Home drive shortcut actions",
    description: "Show drive shortcut actions on Home (drive reset, Soft IEC turn on/reset/set dir, drive B turn on). Depends on the Telnet interface.",
  },
  {
    id: "home_telnet_printer_actions_enabled",
    enabled: false,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Home printer shortcut actions",
    description: "Show printer shortcut actions on Home (turn on, flush/eject, reset). Depends on the Telnet interface.",
  },
  {
    id: "home_telnet_power_cycle_enabled",
    enabled: false,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Home power cycle action",
    description: "Show the Power Cycle quick action on Home. Depends on the Telnet interface.",
  },
  {
    id: "home_telnet_clear_ram_reboot_enabled",
    enabled: false,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Home clear-RAM reboot action",
    description: "Show the Reboot (Clr Mem) quick action on Home. Depends on the Telnet interface.",
  },
  {
    id: "keypad_input_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Keyboard and keypad navigation",
    description: "Drive the app with a hardware keyboard, remote, or keypad. Arrow/D-pad navigation, activation, and literal hardware-keyboard typing are enabled by default; numeric keypad T9 text entry remains reserved for keypad-first variants.",
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
