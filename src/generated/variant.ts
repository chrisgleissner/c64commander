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

export const variantConfig = {
  repo: {
    defaultVariant: "c64commander",
    publishDefaults: {
      ci: ["c64commander", "c64u-remote"],
      release: ["c64commander"],
    },
    selectedPublishVariants: ["c64commander"],
  },
  schemaVersion: 1,
  selectedVariantId: "c64u-remote",
  variant: {
    appId: "c64u-remote",
    assets: {
      public: {
        faviconPng: "/favicon.png",
        homeLogoPng: "/c64u-remote.png",
        icon192Png: "/c64u-remote-192.png",
        icon512Png: "/c64u-remote-512.png",
        iconMaskable512Png: "/c64u-remote-maskable-512.png",
      },
      sources: {
        icon: {
          format: "png",
          path: "variants/assets/c64u-remote/icon.png",
        },
        logo: {
          format: "png",
          path: "variants/assets/c64u-remote/logo.png",
        },
        splash: {
          format: "png",
          path: "variants/assets/c64u-remote/splash.png",
        },
      },
    },
    description: "Configure and control your Commodore 64 Ultimate over your local network.",
    displayName: "C64U Remote",
    displayNamePascalCase: "C64uRemote",
    exportedFileBasename: "c64u-remote",
    featureFlags: {
      app_styles_gallery_enabled: {
        developer_only: true,
        enabled: false,
        visible_to_user: false,
      },
      audio_mirror_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      av_sync_tests_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      background_execution_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      commoserve_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      demo_mode_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      disk_explorer_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      home_telnet_clear_ram_reboot_enabled: {
        developer_only: false,
        enabled: true,
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
        enabled: true,
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
      live_view_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      new_disk_enabled: {
        developer_only: false,
        enabled: true,
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
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
    },
    id: "c64u-remote",
    platform: {
      android: {
        applicationId: "uk.gleissner.c64uremote",
        customUrlScheme: "uk.gleissner.c64uremote",
        releaseAbis: ["arm64-v8a"],
      },
    },
    publishToGooglePlay: false,
    runtime: {
      defaultDisplayProfile: "compact",
      defaultGameModeJoystick: "hidden",
      defaultGameModeOnLaunch: true,
      defaultHideNavigationBar: true,
      defaultHideStatusBar: true,
      defaultJoystickKeyLayout: "diamond8",
      defaultSidEmulationEngine: "residfp",
      defaultT9InputEnabled: true,
      endpoints: {
        commoserve_base_url: "http://commoserve.files.commodore.net",
        device_host: "c64u",
        hvsc_base_url: "https://hvsc.brona.dk/HVSC/",
      },
    },
    theme: {
      backgroundColor: "#2F6B8B",
      themeColor: "#2F6B8B",
    },
  },
} as const;

export const variant = variantConfig.variant;
export const repoVariantConfig = variantConfig.repo;
