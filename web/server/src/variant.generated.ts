/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// AUTO-GENERATED FILE. Do not edit by hand.
// Source:   variants/variants.yaml
// Compiler: scripts/generate-variant.mjs
// Run `node scripts/generate-variant.mjs` to regenerate.

export const webServerVariantConfig = {
  repo: {
    defaultVariant: "c64commander",
    publishDefaults: {
      ci: ["c64commander", "c64u-remote"],
      release: ["c64commander", "c64u-remote"],
    },
    selectedPublishVariants: ["c64commander", "c64u-remote"],
  },
  schemaVersion: 1,
  selectedVariantId: "c64commander",
  variant: {
    appId: "c64commander",
    assets: {
      public: {
        faviconPng: "/favicon.png",
        homeLogoPng: "/c64commander.png",
        icon192Png: "/c64commander-192.png",
        icon512Png: "/c64commander-512.png",
        iconMaskable512Png: "/c64commander-maskable-512.png",
      },
      sources: {
        icon: {
          format: "png",
          path: "variants/assets/c64commander/icon.png",
        },
        logo: {
          format: "png",
          path: "variants/assets/c64commander/logo.png",
        },
        splash: {
          format: "png",
          path: "variants/assets/c64commander/splash.png",
        },
      },
    },
    description: "Configure and control your Commodore 64 Ultimate over your local network.",
    displayName: "C64 Commander",
    displayNamePascalCase: "C64commander",
    exportedFileBasename: "c64commander",
    featureFlags: {
      audio_mirror_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      background_execution_enabled: {
        developer_only: true,
        enabled: true,
        visible_to_user: false,
      },
      commoserve_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      demo_mode_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      disk_explorer_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      home_telnet_clear_ram_reboot_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      home_telnet_config_actions_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      home_telnet_drive_actions_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      home_telnet_power_cycle_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      home_telnet_printer_actions_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      home_telnet_reu_snapshot_enabled: {
        developer_only: true,
        enabled: false,
        visible_to_user: false,
      },
      hvsc_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      in_image_search_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      keypad_input_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      launch_safety_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      lighting_studio_enabled: {
        developer_only: true,
        enabled: false,
        visible_to_user: false,
      },
      new_disk_enabled: {
        developer_only: false,
        enabled: false,
        visible_to_user: true,
      },
      ram_snapshots_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      remote_input_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      video_mirror_enabled: {
        developer_only: true,
        enabled: false,
        visible_to_user: false,
      },
    },
    id: "c64commander",
    platform: {
      android: {
        applicationId: "uk.gleissner.c64commander",
        customUrlScheme: "uk.gleissner.c64commander",
      },
      ios: {
        bundleId: "uk.gleissner.c64commander",
      },
      web: {
        backgroundColor: "#6C7EB7",
        loginHeading: "C64 Commander",
        loginTitle: "C64 Commander Login",
        shortName: "C64 Commander",
        themeColor: "#6C7EB7",
      },
    },
    publishToGooglePlay: true,
    runtime: {
      defaultDisplayProfile: "auto",
      defaultHideNavigationBar: false,
      defaultHideStatusBar: false,
      defaultT9InputEnabled: false,
      endpoints: {
        commoserve_base_url: "http://commoserve.files.commodore.net",
        device_host: "c64u",
        hvsc_base_url: "https://hvsc.brona.dk/HVSC/",
      },
    },
    theme: {
      backgroundColor: "#6C7EB7",
      themeColor: "#6C7EB7",
    },
  },
} as const;

export const variant = webServerVariantConfig.variant;
