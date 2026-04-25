#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import prettier from 'prettier';
import sharp from 'sharp';
import { parseRegistrySource } from './compile-feature-flags.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

export const SUPPORTED_SCHEMA_VERSION = 1;
export const DEFAULT_VARIANTS_PATH = path.join(REPO_ROOT, 'variants/variants.yaml');
export const DEFAULT_FEATURE_FLAGS_PATH = path.join(REPO_ROOT, 'src/lib/config/feature-flags.yaml');
export const DEFAULT_OVERLAYS_DIR = path.join(REPO_ROOT, 'variants/feature-flags');
export const DEFAULT_RUNTIME_TS_PATH = path.join(REPO_ROOT, 'src/generated/variant.ts');
export const DEFAULT_RUNTIME_JSON_PATH = path.join(REPO_ROOT, 'src/generated/variant.json');
export const DEFAULT_WEB_INDEX_PATH = path.join(REPO_ROOT, 'index.html');
export const DEFAULT_WEB_MANIFEST_PATH = path.join(REPO_ROOT, 'public/manifest.webmanifest');
export const DEFAULT_WEB_SW_PATH = path.join(REPO_ROOT, 'public/sw.js');
export const DEFAULT_WEB_SERVER_VARIANT_TS_PATH = path.join(REPO_ROOT, 'web/server/src/variant.generated.ts');
export const DEFAULT_ANDROID_STRINGS_XML_PATH = path.join(REPO_ROOT, 'android/app/src/main/res/values/strings.xml');
export const DEFAULT_ANDROID_LAUNCHER_BACKGROUND_XML_PATH = path.join(
    REPO_ROOT,
    'android/app/src/main/res/values/ic_launcher_background.xml',
);
export const DEFAULT_IOS_VARIANT_XCCONFIG_PATH = path.join(REPO_ROOT, 'ios/App/App/Config/Variant.generated.xcconfig');
export const ALLOWED_ENDPOINT_KEYS = ['device_host', 'hvsc_base_url', 'commoserve_base_url'];

const VARIANT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const LICENSE_HEADER = `/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
`;

const GENERATED_BANNER = `// AUTO-GENERATED FILE. Do not edit by hand.
// Source:   variants/variants.yaml
// Compiler: scripts/generate-variant.mjs
// Run \`node scripts/generate-variant.mjs\` to regenerate.
`;

const GENERATED_XML_BANNER = `<!-- AUTO-GENERATED FILE. Do not edit by hand.
     Source:   variants/variants.yaml
     Compiler: scripts/generate-variant.mjs
     Run \`node scripts/generate-variant.mjs\` to regenerate. -->\n`;

const IOS_XCCONFIG_BANNER = `// AUTO-GENERATED FILE. Do not edit by hand.
// Source:   variants/variants.yaml
// Compiler: scripts/generate-variant.mjs
// Run \`node scripts/generate-variant.mjs\` to regenerate.
`;

const ANDROID_ICON_SIZES = [
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
];

const IOS_SPLASH_FILENAMES = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'];

const TRANSPARENT_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 0 };
const SUPPORTED_ASSET_SOURCE_FORMATS = ['png', 'svg', 'jpg', 'jpeg', 'webp'];

class VariantCompileError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VariantCompileError';
    }
}

const fail = (message) => {
    throw new VariantCompileError(message);
};

const requireMapping = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must be a YAML mapping`);
    }
};

const requireNonEmptyString = (value, label) => {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${label} must be a non-empty string`);
    }
    return value.trim();
};

const requireStringArray = (value, label) => {
    if (!Array.isArray(value)) {
        fail(`${label} must be a YAML sequence`);
    }
    return value.map((entry, index) => requireNonEmptyString(entry, `${label}[${index}]`));
};

const requireBoolean = (value, label) => {
    if (typeof value !== 'boolean') {
        fail(`${label} must be a boolean`);
    }
    return value;
};

const parseYamlFile = (filePath, failureLabel) => {
    let source;
    try {
        source = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        fail(`failed to read ${failureLabel}: ${error.message}`);
    }

    try {
        return yaml.load(source);
    } catch (error) {
        fail(`failed to parse ${failureLabel}: ${error.message}`);
    }
};

const xmlEscape = (value) =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');

const hexColorToStoryboardRgb = (value, label) => {
    const normalized = requireNonEmptyString(value, label);
    const match = /^#?([0-9a-fA-F]{6})$/.exec(normalized);
    if (!match) {
        fail(`${label} must be a 6-digit hex color`);
    }

    const hex = match[1];
    const readChannel = (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255;

    return {
        red: readChannel(0).toFixed(16),
        green: readChannel(2).toFixed(16),
        blue: readChannel(4).toFixed(16),
    };
};

const ensureFileExists = (repoRoot, relativePath, label) => {
    requireNonEmptyString(relativePath, label);
    const absolutePath = path.resolve(repoRoot, relativePath);
    const relativeToRepoRoot = path.relative(repoRoot, absolutePath);
    if (
        relativeToRepoRoot === '..' ||
        relativeToRepoRoot.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToRepoRoot)
    ) {
        fail(`${label} must stay within the repository: ${relativePath}`);
    }
    if (!fs.existsSync(absolutePath)) {
        fail(`${label} is missing: ${relativePath}`);
    }
    return relativePath;
};

const normalizeAssetSource = (repoRoot, raw, label) => {
    requireMapping(raw, label);
    const assetPath = ensureFileExists(repoRoot, raw.path, `${label}.path`);
    const explicitFormat = raw.format === undefined ? '' : requireNonEmptyString(raw.format, `${label}.format`).toLowerCase();
    const inferredFormat = path.extname(assetPath).slice(1).toLowerCase();
    const format = explicitFormat || inferredFormat;

    if (!format) {
        fail(`${label}.format must be provided or inferable from the file extension`);
    }
    if (explicitFormat && inferredFormat && explicitFormat !== inferredFormat) {
        fail(`${label}.format "${explicitFormat}" does not match file extension ".${inferredFormat}"`);
    }
    if (!SUPPORTED_ASSET_SOURCE_FORMATS.includes(format)) {
        fail(`${label}.format must be one of: ${SUPPORTED_ASSET_SOURCE_FORMATS.join(', ')}`);
    }

    return {
        path: assetPath,
        format,
    };
};

const readSchemaVersion = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('variant root must be a YAML mapping');
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'schema_version')) {
        fail('variants/variants.yaml must declare schema_version');
    }
    const schemaVersion = raw.schema_version;
    if (!Number.isInteger(schemaVersion)) {
        fail(`schema_version must be an integer, got ${JSON.stringify(schemaVersion)}`);
    }
    if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
        fail(`unsupported schema_version ${schemaVersion}; max supported version is ${SUPPORTED_SCHEMA_VERSION}`);
    }
    if (schemaVersion < 1) {
        fail(`unsupported schema_version ${schemaVersion}`);
    }
    return schemaVersion;
};

const normalizeVariant = (repoRoot, variantId, raw) => {
    if (!VARIANT_ID_PATTERN.test(variantId)) {
        fail(`variant id "${variantId}" must match ${VARIANT_ID_PATTERN}`);
    }
    requireMapping(raw, `variants.${variantId}`);
    requireMapping(raw.platform, `variants.${variantId}.platform`);
    requireMapping(raw.platform.android, `variants.${variantId}.platform.android`);
    requireMapping(raw.platform.ios, `variants.${variantId}.platform.ios`);
    requireMapping(raw.platform.web, `variants.${variantId}.platform.web`);
    requireMapping(raw.assets, `variants.${variantId}.assets`);
    requireMapping(raw.assets.sources, `variants.${variantId}.assets.sources`);

    const runtime = raw.runtime ?? {};
    requireMapping(runtime, `variants.${variantId}.runtime`);
    const runtimeEndpointsRaw = runtime.endpoints ?? {};
    requireMapping(runtimeEndpointsRaw, `variants.${variantId}.runtime.endpoints`);
    const endpointKeys = Object.keys(runtimeEndpointsRaw).sort();
    endpointKeys.forEach((key) => {
        if (!ALLOWED_ENDPOINT_KEYS.includes(key)) {
            fail(`variants.${variantId}.runtime.endpoints contains unsupported key "${key}"`);
        }
        requireNonEmptyString(runtimeEndpointsRaw[key], `variants.${variantId}.runtime.endpoints.${key}`);
    });

    return {
        id: variantId,
        displayName: requireNonEmptyString(raw.display_name, `variants.${variantId}.display_name`),
        appId: requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`),
        description: requireNonEmptyString(raw.description, `variants.${variantId}.description`),
        exportedFileBasename: requireNonEmptyString(
            raw.exported_file_basename,
            `variants.${variantId}.exported_file_basename`,
        ),
        platform: {
            android: {
                applicationId: requireNonEmptyString(
                    raw.platform.android.application_id,
                    `variants.${variantId}.platform.android.application_id`,
                ),
                customUrlScheme: requireNonEmptyString(
                    raw.platform.android.custom_url_scheme,
                    `variants.${variantId}.platform.android.custom_url_scheme`,
                ),
            },
            ios: {
                bundleId: requireNonEmptyString(raw.platform.ios.bundle_id, `variants.${variantId}.platform.ios.bundle_id`),
            },
            web: {
                shortName: requireNonEmptyString(raw.platform.web.short_name, `variants.${variantId}.platform.web.short_name`),
                themeColor: requireNonEmptyString(
                    raw.platform.web.theme_color,
                    `variants.${variantId}.platform.web.theme_color`,
                ),
                backgroundColor: requireNonEmptyString(
                    raw.platform.web.background_color,
                    `variants.${variantId}.platform.web.background_color`,
                ),
                loginTitle: requireNonEmptyString(
                    raw.platform.web.login_title,
                    `variants.${variantId}.platform.web.login_title`,
                ),
                loginHeading: requireNonEmptyString(
                    raw.platform.web.login_heading,
                    `variants.${variantId}.platform.web.login_heading`,
                ),
            },
        },
        assets: {
            sources: {
                icon: normalizeAssetSource(repoRoot, raw.assets.sources.icon, `variants.${variantId}.assets.sources.icon`),
                logo: normalizeAssetSource(repoRoot, raw.assets.sources.logo, `variants.${variantId}.assets.sources.logo`),
                splash: normalizeAssetSource(
                    repoRoot,
                    raw.assets.sources.splash,
                    `variants.${variantId}.assets.sources.splash`,
                ),
            },
            public: {
                faviconPng: '/favicon.png',
                homeLogoPng: `/${requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`)}.png`,
                icon192Png: `/${requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`)}-192.png`,
                icon512Png: `/${requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`)}-512.png`,
                iconMaskable512Png: `/${requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`)}-maskable-512.png`,
            },
        },
        runtime: {
            endpoints: Object.fromEntries(endpointKeys.map((key) => [key, runtimeEndpointsRaw[key].trim()])),
        },
    };
};

export const validateVariantConfig = (raw, { repoRoot = REPO_ROOT } = {}) => {
    const schemaVersion = readSchemaVersion(raw);
    requireMapping(raw.repo, 'repo');
    requireMapping(raw.repo.publish_defaults, 'repo.publish_defaults');
    requireMapping(raw.variants, 'variants');

    const variants = {};
    const appIds = new Map();
    const applicationIds = new Map();
    const bundleIds = new Map();
    const customUrlSchemes = new Map();

    for (const [variantId, entry] of Object.entries(raw.variants)) {
        const normalized = normalizeVariant(repoRoot, variantId, entry);
        variants[variantId] = normalized;

        const uniquenessChecks = [
            ['app_id', normalized.appId, appIds],
            ['application_id', normalized.platform.android.applicationId, applicationIds],
            ['bundle_id', normalized.platform.ios.bundleId, bundleIds],
            ['custom_url_scheme', normalized.platform.android.customUrlScheme, customUrlSchemes],
        ];

        uniquenessChecks.forEach(([label, value, seen]) => {
            if (seen.has(value)) {
                fail(`${label} collision: "${value}" is declared by both "${seen.get(value)}" and "${variantId}"`);
            }
            seen.set(value, variantId);
        });
    }

    const variantIds = Object.keys(variants).sort();
    if (variantIds.length === 0) {
        fail('variants must declare at least one variant');
    }

    const defaultVariant = requireNonEmptyString(raw.repo.default_variant, 'repo.default_variant');
    if (!variants[defaultVariant]) {
        fail(`repo.default_variant references unknown variant "${defaultVariant}"`);
    }

    const publishDefaults = {};
    for (const [publishKey, entries] of Object.entries(raw.repo.publish_defaults)) {
        const values = requireStringArray(entries, `repo.publish_defaults.${publishKey}`);
        values.forEach((variantId) => {
            if (!variants[variantId]) {
                fail(`repo.publish_defaults.${publishKey} references unknown variant "${variantId}"`);
            }
        });
        publishDefaults[publishKey] = [...new Set(values)].sort();
    }

    return {
        schemaVersion,
        repo: {
            defaultVariant,
            publishDefaults,
        },
        variants,
    };
};

export const parseVariantSource = (source, { repoRoot = REPO_ROOT } = {}) => {
    let raw;
    try {
        raw = yaml.load(source);
    } catch (error) {
        fail(`failed to parse variants/variants.yaml: ${error.message}`);
    }
    return validateVariantConfig(raw, { repoRoot });
};

export const validateFeatureFlagOverlay = (raw, { featureIds, variantId }) => {
    if (raw === undefined || raw === null) {
        return { overrides: {} };
    }
    requireMapping(raw, `variants/feature-flags/${variantId}.yaml`);
    const overridesRaw = raw.overrides ?? {};
    requireMapping(overridesRaw, `variants/feature-flags/${variantId}.yaml overrides`);

    const overrides = {};
    const allowedFields = ['enabled', 'visible_to_user', 'developer_only'];

    for (const [featureId, overrideValue] of Object.entries(overridesRaw)) {
        if (!featureIds.has(featureId)) {
            fail(`variants/feature-flags/${variantId}.yaml references unknown feature id "${featureId}"`);
        }
        requireMapping(overrideValue, `feature override ${featureId}`);
        const unknownKeys = Object.keys(overrideValue).filter((key) => !allowedFields.includes(key));
        if (unknownKeys.length > 0) {
            fail(`feature override ${featureId} contains disallowed fields: ${unknownKeys.join(', ')}`);
        }

        const normalizedOverride = {};
        for (const key of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(overrideValue, key)) {
                normalizedOverride[key] = requireBoolean(overrideValue[key], `feature override ${featureId}.${key}`);
            }
        }
        overrides[featureId] = normalizedOverride;
    }

    return { overrides };
};

export const parseFeatureFlagOverlaySource = (source, options) => {
    let raw;
    try {
        raw = yaml.load(source);
    } catch (error) {
        fail(`failed to parse feature flag overlay: ${error.message}`);
    }
    return validateFeatureFlagOverlay(raw, options);
};

export const resolveVariantFeatureRegistry = (baseRegistry, overlay) => {
    const resolved = baseRegistry.features.map((feature) => {
        const featureOverride = overlay.overrides[feature.id] ?? {};
        const normalized = {
            ...feature,
            ...featureOverride,
        };
        if (normalized.developer_only && normalized.visible_to_user) {
            fail(
                `feature override ${feature.id} violates invariant: developer_only: true requires visible_to_user: false`,
            );
        }
        return normalized;
    });

    return {
        version: baseRegistry.version,
        groups: baseRegistry.groups,
        features: resolved,
    };
};

export const resolvePublishVariants = (config, { publishTarget = 'release', explicitVariants = null } = {}) => {
    const selected = explicitVariants && explicitVariants.length > 0 ? explicitVariants : config.repo.publishDefaults[publishTarget];
    if (!selected) {
        fail(`unknown publish target "${publishTarget}"`);
    }
    const unique = [...new Set(selected.map((value) => requireNonEmptyString(value, 'publish variant id')))].sort();
    unique.forEach((variantId) => {
        if (!config.variants[variantId]) {
            fail(`publish selection references unknown variant "${variantId}"`);
        }
    });
    return unique;
};

const toPascalCase = (value) =>
    value
        .split(/[-_]/g)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join('');

const sortObject = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => sortObject(entry));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, sortObject(value[key])]),
    );
};

export const buildVariantSelection = ({ config, variantId, baseRegistry, overlay, publishVariants }) => {
    const selectedVariantId = variantId ?? config.repo.defaultVariant;
    const selectedVariant = config.variants[selectedVariantId];
    if (!selectedVariant) {
        fail(`unknown variant "${selectedVariantId}"`);
    }

    const resolvedFeatureRegistry = resolveVariantFeatureRegistry(baseRegistry, overlay);
    const featureFlags = Object.fromEntries(
        resolvedFeatureRegistry.features.map((feature) => [feature.id, {
            enabled: feature.enabled,
            visible_to_user: feature.visible_to_user,
            developer_only: feature.developer_only,
        }]),
    );

    return sortObject({
        schemaVersion: config.schemaVersion,
        repo: {
            defaultVariant: config.repo.defaultVariant,
            publishDefaults: config.repo.publishDefaults,
            selectedPublishVariants: publishVariants,
        },
        selectedVariantId,
        variant: {
            ...selectedVariant,
            featureFlags,
            displayNamePascalCase: toPascalCase(selectedVariant.id),
        },
    });
};

export const renderVariantRuntimeModule = (selection) => {
    const serialized = JSON.stringify(selection, null, 2);
    return `${LICENSE_HEADER}
${GENERATED_BANNER}
export const variantConfig = ${serialized} as const;

export const variant = variantConfig.variant;
export const repoVariantConfig = variantConfig.repo;
`;
};

export const renderVariantJson = (selection) => `${JSON.stringify(selection, null, 2)}\n`;

export const renderWebIndexHtml = (selection) => {
    const { variant } = selection;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover"
    />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta
      name="apple-mobile-web-app-status-bar-style"
      content="black-translucent"
    />
    <meta name="theme-color" content="${variant.platform.web.themeColor}" />
    <title>${variant.displayName}</title>
    <meta
      name="description"
      content="${variant.description}"
    />
    <meta name="author" content="${variant.displayName}" />

    <link rel="icon" href="%BASE_URL%${variant.assets.public.faviconPng.slice(1)}" type="image/png" />
    <link rel="icon" href="%BASE_URL%${variant.assets.public.icon512Png.slice(1)}" type="image/png" />
    <link rel="apple-touch-icon" href="%BASE_URL%${variant.assets.public.icon512Png.slice(1)}" />
    <link rel="manifest" href="%BASE_URL%manifest.webmanifest" />

    <meta property="og:title" content="${variant.displayName}" />
    <meta
      property="og:description"
      content="${variant.description}"
    />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary" />
        <style>
            html,
            body,
            #root {
                min-height: 100%;
                margin: 0;
                background: ${variant.platform.web.backgroundColor};
            }
        </style>
  </head>

  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
};

export const renderWebManifest = (selection) => {
    const { variant } = selection;
    return `${JSON.stringify(
        {
            name: variant.displayName,
            short_name: variant.platform.web.shortName,
            description: variant.description,
            start_url: '.',
            scope: '/',
            display: 'standalone',
            orientation: 'any',
            background_color: variant.platform.web.backgroundColor,
            theme_color: variant.platform.web.themeColor,
            icons: [
                {
                    src: variant.assets.public.icon192Png.slice(1),
                    sizes: '192x192',
                    type: 'image/png',
                },
                {
                    src: variant.assets.public.icon512Png.slice(1),
                    sizes: '512x512',
                    type: 'image/png',
                },
                {
                    src: variant.assets.public.iconMaskable512Png.slice(1),
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                },
            ],
        },
        null,
        2,
    )}\n`;
};

export const renderWebServiceWorker = () => `const CACHE_PREFIX = 'c64commander-static';
const STATIC_ASSETS = ['/manifest.webmanifest'];

const buildId = (() => {
  try {
    const url = new URL(self.location.href);
    return url.searchParams.get('v') || 'dev';
  } catch {
    return 'dev';
  }
})();

const CACHE_NAME = \`${'${CACHE_PREFIX}-${buildId}'}\`;

const isShellRequest = (request, url) => request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) return;

  const isApiRequest =
    url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');
  if (isApiRequest) {
    event.respondWith(fetch(request));
    return;
  }

  if (isShellRequest(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
`;

export const renderAndroidStringsXml = (selection) => `${GENERATED_XML_BANNER}<resources>
    <string name="app_name">${xmlEscape(selection.variant.displayName)}</string>
    <string name="title_activity_main">${xmlEscape(selection.variant.displayName)}</string>
    <string name="package_name">${xmlEscape(selection.variant.platform.android.applicationId)}</string>
    <string name="custom_url_scheme">${xmlEscape(selection.variant.platform.android.customUrlScheme)}</string>
</resources>
`;

export const renderAndroidLauncherBackgroundXml = (selection) => `${GENERATED_XML_BANNER}<resources>
    <color name="ic_launcher_background">${xmlEscape(selection.variant.platform.web.backgroundColor)}</color>
</resources>
`;

export const renderIosVariantXcconfig = (selection) => `${IOS_XCCONFIG_BANNER}VARIANT_DISPLAY_NAME = ${selection.variant.displayName}
VARIANT_BUNDLE_IDENTIFIER = ${selection.variant.platform.ios.bundleId}
`;

export const renderIosLaunchScreenStoryboard = (selection) => {
    const { red, green, blue } = hexColorToStoryboardRgb(
        selection.variant.platform.web.backgroundColor,
        'variant.platform.web.backgroundColor',
    );

    return `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="17132" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="17105"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <imageView key="view" userInteractionEnabled="NO" contentMode="scaleAspectFill" horizontalHuggingPriority="251" verticalHuggingPriority="251" image="Splash" id="snD-IY-ifK">
                        <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                        <autoresizingMask key="autoresizingMask"/>
                        <color key="backgroundColor" red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                    </imageView>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="53" y="375"/>
        </scene>
    </scenes>
    <resources>
        <image name="Splash" width="1366" height="1366"/>
    </resources>
</document>
`;
};

export const renderWebServerVariantModule = (selection) => `${LICENSE_HEADER}
${GENERATED_BANNER}
export const webServerVariantConfig = ${JSON.stringify(selection, null, 2)} as const;

export const variant = webServerVariantConfig.variant;
`;

const formatGeneratedText = async ({ outputPath, rendered }) => {
    const extension = path.extname(outputPath);
    if (!['.json', '.ts', '.tsx'].includes(extension)) {
        return rendered;
    }

    const config = (await prettier.resolveConfig(outputPath)) ?? {};
    return prettier.format(rendered, {
        ...config,
        filepath: outputPath,
    });
};

const writeOutputFile = ({ outputPath, rendered, check }) => {
    let existing = '';
    try {
        existing = fs.readFileSync(outputPath, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (check) {
        if (existing !== rendered) {
            fail(`generated file is out of date: ${path.relative(REPO_ROOT, outputPath)}\n  run: node scripts/generate-variant.mjs`);
        }
        return false;
    }

    if (existing === rendered) {
        return false;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, rendered, 'utf8');
    return true;
};

const writeBinaryOutputFile = async ({ outputPath, content, check }) => {
    let existing = null;
    try {
        existing = fs.readFileSync(outputPath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (check) {
        if (!existing || !existing.equals(content)) {
            fail(`generated file is out of date: ${path.relative(REPO_ROOT, outputPath)}\n  run: node scripts/generate-variant.mjs`);
        }
        return false;
    }

    if (existing && existing.equals(content)) {
        return false;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    return true;
};

const renderImageAsPng = async (inputPath, { size, fit = 'contain', background = TRANSPARENT_BACKGROUND } = {}) => {
    let pipeline = sharp(inputPath);
    if (size !== undefined) {
        pipeline = pipeline.resize(size, size, {
            fit,
            background,
        });
    }
    return pipeline.png().toBuffer();
};

const loadSourcePng = async (inputPath, format) => {
    if (format === 'png') {
        return fs.readFileSync(inputPath);
    }
    return renderImageAsPng(inputPath);
};

const renderPublicAssets = async ({ repoRoot, selection, check }) => {
    const iconPath = path.join(repoRoot, selection.variant.assets.sources.icon.path);
    const logoPath = path.join(repoRoot, selection.variant.assets.sources.logo.path);

    const changes = [
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.faviconPng.slice(1)),
            content: await renderImageAsPng(iconPath, { size: 64 }),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.homeLogoPng.slice(1)),
            content: await loadSourcePng(logoPath, selection.variant.assets.sources.logo.format),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.icon192Png.slice(1)),
            content: await renderImageAsPng(iconPath, { size: 192 }),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.icon512Png.slice(1)),
            content: await renderImageAsPng(iconPath, { size: 512 }),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.iconMaskable512Png.slice(1)),
            content: await renderImageAsPng(iconPath, {
                size: 512,
                fit: 'contain',
                background: selection.variant.platform.web.backgroundColor,
            }),
            check,
        }),
    ];

    return changes.some(Boolean);
};

const renderAndroidAssets = async ({ repoRoot, selection, check }) => {
    const iconPath = path.join(repoRoot, selection.variant.assets.sources.icon.path);
    const splashPath = path.join(repoRoot, selection.variant.assets.sources.splash.path);

    const changes = [
        writeOutputFile({
            outputPath: path.join(repoRoot, 'android/app/src/main/res/values/strings.xml'),
            rendered: renderAndroidStringsXml(selection),
            check,
        }),
        writeOutputFile({
            outputPath: path.join(repoRoot, 'android/app/src/main/res/values/ic_launcher_background.xml'),
            rendered: renderAndroidLauncherBackgroundXml(selection),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'android/app/src/main/res/drawable/splash.png'),
            content: await renderImageAsPng(splashPath, {
                size: 1366,
                fit: 'contain',
                background: selection.variant.platform.web.backgroundColor,
            }),
            check,
        }),
    ];

    for (const [density, size] of ANDROID_ICON_SIZES) {
        const directory = path.join(repoRoot, `android/app/src/main/res/mipmap-${density}`);
        const iconPng = await renderImageAsPng(iconPath, { size });
        const foregroundPng = await renderImageAsPng(iconPath, { size, fit: 'contain' });
        changes.push(
            await writeBinaryOutputFile({
                outputPath: path.join(directory, 'ic_launcher.png'),
                content: iconPng,
                check,
            }),
        );
        changes.push(
            await writeBinaryOutputFile({
                outputPath: path.join(directory, 'ic_launcher_round.png'),
                content: iconPng,
                check,
            }),
        );
        changes.push(
            await writeBinaryOutputFile({
                outputPath: path.join(directory, 'ic_launcher_foreground.png'),
                content: foregroundPng,
                check,
            }),
        );
    }

    return changes.some(Boolean);
};

const renderIosAssets = async ({ repoRoot, selection, check }) => {
    const iconPath = path.join(repoRoot, selection.variant.assets.sources.icon.path);
    const splashPath = path.join(repoRoot, selection.variant.assets.sources.splash.path);
    const splashPng = await renderImageAsPng(splashPath, {
        size: 2732,
        fit: 'contain',
        background: selection.variant.platform.web.backgroundColor,
    });

    const changes = [
        writeOutputFile({
            outputPath: path.join(repoRoot, 'ios/App/App/Config/Variant.generated.xcconfig'),
            rendered: renderIosVariantXcconfig(selection),
            check,
        }),
        writeOutputFile({
            outputPath: path.join(repoRoot, 'ios/App/App/Base.lproj/LaunchScreen.storyboard'),
            rendered: renderIosLaunchScreenStoryboard(selection),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
            content: await renderImageAsPng(iconPath, { size: 1024 }),
            check,
        }),
    ];

    for (const filename of IOS_SPLASH_FILENAMES) {
        changes.push(
            await writeBinaryOutputFile({
                outputPath: path.join(repoRoot, 'ios/App/App/Assets.xcassets/Splash.imageset', filename),
                content: splashPng,
                check,
            }),
        );
    }

    return changes.some(Boolean);
};

export const compileVariant = async ({
    variantsPath = DEFAULT_VARIANTS_PATH,
    featureFlagsPath = DEFAULT_FEATURE_FLAGS_PATH,
    overlaysDir = DEFAULT_OVERLAYS_DIR,
    runtimeTsPath,
    runtimeJsonPath,
    webIndexPath,
    webManifestPath,
    webServiceWorkerPath,
    webServerVariantTsPath,
    variantId,
    publishTarget = 'release',
    explicitPublishVariants = null,
    check = false,
} = {}) => {
    const normalizedVariantId = normalizeOptionalVariantId(variantId);
    const repoRoot = path.resolve(path.dirname(variantsPath), '..');
    const resolvedRuntimeTsPath = runtimeTsPath ?? path.join(repoRoot, 'src/generated/variant.ts');
    const resolvedRuntimeJsonPath = runtimeJsonPath ?? path.join(repoRoot, 'src/generated/variant.json');
    const resolvedWebIndexPath = webIndexPath ?? path.join(repoRoot, 'index.html');
    const resolvedWebManifestPath = webManifestPath ?? path.join(repoRoot, 'public/manifest.webmanifest');
    const resolvedWebServiceWorkerPath = webServiceWorkerPath ?? path.join(repoRoot, 'public/sw.js');
    const resolvedWebServerVariantTsPath = webServerVariantTsPath ?? path.join(repoRoot, 'web/server/src/variant.generated.ts');
    const variantSource = fs.readFileSync(variantsPath, 'utf8');
    const config = parseVariantSource(variantSource, { repoRoot });
    const baseRegistry = parseRegistrySource(fs.readFileSync(featureFlagsPath, 'utf8'));
    const overlayPath = path.join(overlaysDir, `${normalizedVariantId ?? config.repo.defaultVariant}.yaml`);
    if (!fs.existsSync(overlayPath)) {
        fail(
            `missing feature flag overlay for variant "${normalizedVariantId ?? config.repo.defaultVariant}": ${path.relative(repoRoot, overlayPath)}`,
        );
    }
    const overlay = parseFeatureFlagOverlaySource(fs.readFileSync(overlayPath, 'utf8'), {
        featureIds: new Set(baseRegistry.features.map((feature) => feature.id)),
        variantId: normalizedVariantId ?? config.repo.defaultVariant,
    });
    const publishVariants = resolvePublishVariants(config, {
        publishTarget,
        explicitVariants: explicitPublishVariants,
    });
    const selection = buildVariantSelection({
        config,
        variantId: normalizedVariantId,
        baseRegistry,
        overlay,
        publishVariants,
    });

    const changed = [
        writeOutputFile({
            outputPath: resolvedRuntimeTsPath,
            rendered: await formatGeneratedText({
                outputPath: resolvedRuntimeTsPath,
                rendered: renderVariantRuntimeModule(selection),
            }),
            check,
        }),
        writeOutputFile({
            outputPath: resolvedRuntimeJsonPath,
            rendered: await formatGeneratedText({
                outputPath: resolvedRuntimeJsonPath,
                rendered: renderVariantJson(selection),
            }),
            check,
        }),
        writeOutputFile({ outputPath: resolvedWebIndexPath, rendered: renderWebIndexHtml(selection), check }),
        writeOutputFile({ outputPath: resolvedWebManifestPath, rendered: renderWebManifest(selection), check }),
        writeOutputFile({ outputPath: resolvedWebServiceWorkerPath, rendered: renderWebServiceWorker(selection), check }),
        writeOutputFile({
            outputPath: resolvedWebServerVariantTsPath,
            rendered: await formatGeneratedText({
                outputPath: resolvedWebServerVariantTsPath,
                rendered: renderWebServerVariantModule(selection),
            }),
            check,
        }),
        await renderPublicAssets({ repoRoot, selection, check }),
        await renderAndroidAssets({ repoRoot, selection, check }),
        await renderIosAssets({ repoRoot, selection, check }),
    ].some(Boolean);

    return {
        changed,
        selection,
        overlayPath,
    };
};

const isDirectInvocation = () => {
    const entry = process.argv[1];
    if (!entry) return false;
    return path.resolve(entry) === fileURLToPath(import.meta.url);
};

const parseCliArgs = (args) => {
    let variantId;
    let publishTarget = 'release';
    let explicitPublishVariants = null;
    let check = false;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--check') {
            check = true;
            continue;
        }
        if (arg === '--variant') {
            variantId = args[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--publish-target') {
            publishTarget = args[index + 1] ?? publishTarget;
            index += 1;
            continue;
        }
        if (arg === '--publish-variants') {
            explicitPublishVariants = (args[index + 1] ?? '')
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
            index += 1;
            continue;
        }
        fail(`unknown argument: ${arg}`);
    }

    return { variantId, publishTarget, explicitPublishVariants, check };
};

const normalizeOptionalVariantId = (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
};

if (isDirectInvocation()) {
    try {
        const args = parseCliArgs(process.argv.slice(2));
        const envPublishVariants = (process.env.APP_PUBLISH_VARIANTS ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
        const resolvedArgs = {
            ...args,
            variantId: normalizeOptionalVariantId(args.variantId) ?? normalizeOptionalVariantId(process.env.APP_VARIANT),
            explicitPublishVariants: args.explicitPublishVariants ?? (envPublishVariants.length > 0 ? envPublishVariants : null),
        };
        const result = await compileVariant(resolvedArgs);
        if (resolvedArgs.check) {
            console.log(`variant outputs are up to date for ${result.selection.selectedVariantId}`);
        } else if (result.changed) {
            console.log(`wrote variant outputs for ${result.selection.selectedVariantId}`);
        } else {
            console.log(`variant outputs already up to date for ${result.selection.selectedVariantId}`);
        }
    } catch (error) {
        if (error instanceof VariantCompileError) {
            console.error(`variant generation failed: ${error.message}`);
            process.exit(1);
        }
        throw error;
    }
}

export { VariantCompileError };
