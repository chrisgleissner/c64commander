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
  | "remote_input_enabled"
  | "ram_snapshots_enabled"
  | "home_telnet_reu_snapshot_enabled"
  | "home_telnet_config_actions_enabled"
  | "home_telnet_drive_actions_enabled"
  | "home_telnet_printer_actions_enabled"
  | "home_telnet_power_cycle_enabled"
  | "home_telnet_clear_ram_reboot_enabled"
  | "keypad_input_enabled"
  | "launch_safety_enabled"
  | "disk_explorer_enabled"
  | "in_image_search_enabled"
  | "live_view_enabled"
  | "av_sync_tests_enabled"
  | "audio_mirror_enabled"
  | "video_mirror_enabled"
  | "new_disk_enabled";

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
    id: "remote_input_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "Remote Input",
    description: "A second-screen joystick and keyboard for the C64. Joystick control needs firmware support; keyboard works regardless.",
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
    title: "REU snapshots",
    description: "Enable Save REU and Restore REU snapshot functionality on Home. Depends on the Telnet interface.",
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
    description: "Adds drive shortcuts on Home (reset, Soft IEC, drive B). Depends on the Telnet interface.",
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
    description: "Drive the app with a hardware keyboard, remote, or keypad. Numeric T9 text entry is reserved for keypad-first variants.",
  },
  {
    id: "launch_safety_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "Launch Safety",
    description: "Keeps a freezer cartridge from hijacking Run/Load into its own menu. A no-op without a cartridge configured.",
  },
  {
    id: "disk_explorer_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "Disk Explorer",
    description: "Run, Load or Mount & Load a single program inside a disk image, not just the whole disk.",
  },
  {
    id: "in_image_search_enabled",
    enabled: false,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "In-image search",
    description: "Search finds programs inside .d64/.d71/.d81 images, not just filenames. Depends on Disk Explorer.",
  },
  {
    id: "live_view_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "Live View",
    description: "See and hear the running machine on Home, Play and Remote Input. Audio Mirror and Video Mirror below choose the feeds.",
  },
  {
    id: "av_sync_tests_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "A/V sync tests",
    description: "Adds A/V-sync and tap-latency measurement tools to Live View on Home. Requires Live View.",
  },
  {
    id: "audio_mirror_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Audio Mirror",
    description: "Hear the running machine's audio in Live View, with optional recording.",
  },
  {
    id: "video_mirror_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "experimental",
    title: "Video Mirror",
    description: "See the running machine's video in Live View, with zoom/pan in Remote Input.",
  },
  {
    id: "new_disk_enabled",
    enabled: true,
    visible_to_user: true,
    developer_only: false,
    group: "stable",
    title: "New disk",
    description: "Create a formatted blank disk image (D64/D71/D81/DNP) on the device.",
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
