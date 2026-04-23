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
      ci: ["c64commander"],
      release: ["c64commander"],
    },
    selectedPublishVariants: ["c64commander"],
  },
  schemaVersion: 1,
  selectedVariantId: "c64commander",
  variant: {
    appId: "c64commander",
    assets: {
      public: {
        faviconSvg: "/favicon.svg",
        homeLogoPng: "/c64commander.png",
        icon192Png: "/c64commander-192.png",
        icon512Png: "/c64commander.png",
        iconMaskable512Png: "/c64commander-maskable-512.png",
      },
      sources: {
        iconSvg: "variants/assets/c64commander/icon.svg",
        logoSvg: "variants/assets/c64commander/logo.svg",
        splashSvg: "variants/assets/c64commander/splash.svg",
      },
    },
    description: "Configure and control your Commodore 64 Ultimate over your local network.",
    displayName: "C64 Commander",
    displayNamePascalCase: "C64commander",
    exportedFileBasename: "c64commander",
    featureFlags: {
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
      hvsc_enabled: {
        developer_only: false,
        enabled: true,
        visible_to_user: true,
      },
      lighting_studio_enabled: {
        developer_only: true,
        enabled: false,
        visible_to_user: false,
      },
      reu_snapshot_enabled: {
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
    runtime: {
      endpoints: {
        commoserve_base_url: "http://commoserve.files.commodore.net",
        device_host: "c64u",
        hvsc_base_url: "https://hvsc.brona.dk/HVSC/",
      },
    },
  },
} as const;

export const variant = webServerVariantConfig.variant;
