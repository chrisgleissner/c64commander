#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
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

const ensureFileExists = (repoRoot, relativePath, label) => {
    requireNonEmptyString(relativePath, label);
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!absolutePath.startsWith(repoRoot)) {
        fail(`${label} must stay within the repository: ${relativePath}`);
    }
    if (!fs.existsSync(absolutePath)) {
        fail(`${label} is missing: ${relativePath}`);
    }
    return relativePath;
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
                cachePrefix: requireNonEmptyString(
                    raw.platform.web.cache_prefix,
                    `variants.${variantId}.platform.web.cache_prefix`,
                ),
                storagePrefix: requireNonEmptyString(
                    raw.platform.web.storage_prefix,
                    `variants.${variantId}.platform.web.storage_prefix`,
                ),
                loginTitle: requireNonEmptyString(
                    raw.platform.web.login_title,
                    `variants.${variantId}.platform.web.login_title`,
                ),
                loginHeading: requireNonEmptyString(
                    raw.platform.web.login_heading,
                    `variants.${variantId}.platform.web.login_heading`,
                ),
                imageRepo: requireNonEmptyString(raw.platform.web.image_repo, `variants.${variantId}.platform.web.image_repo`),
            },
        },
        assets: {
            sources: {
                iconSvg: ensureFileExists(repoRoot, raw.assets.sources.icon_svg, `variants.${variantId}.assets.sources.icon_svg`),
                logoSvg: ensureFileExists(repoRoot, raw.assets.sources.logo_svg, `variants.${variantId}.assets.sources.logo_svg`),
                splashSvg: ensureFileExists(
                    repoRoot,
                    raw.assets.sources.splash_svg,
                    `variants.${variantId}.assets.sources.splash_svg`,
                ),
            },
            public: {
                faviconSvg: '/favicon.svg',
                homeLogoPng: `/${requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`)}.png`,
                icon192Png: `/${requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`)}-192.png`,
                icon512Png: `/${requireNonEmptyString(raw.app_id, `variants.${variantId}.app_id`)}.png`,
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

export const buildLocalStorageKey = (suffix) => variant.platform.web.storagePrefix + ':' + suffix;
export const buildSessionStorageKey = (suffix) => variant.platform.web.storagePrefix + ':' + suffix;
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

    <link rel="icon" href="%BASE_URL%favicon.svg" type="image/svg+xml" />
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

export const renderWebServiceWorker = (selection) => `const CACHE_PREFIX = '${selection.variant.platform.web.cachePrefix}';
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

export const renderWebServerVariantModule = (selection) => `${LICENSE_HEADER}
${GENERATED_BANNER}
export const webServerVariantConfig = ${JSON.stringify(selection, null, 2)} as const;

export const variant = webServerVariantConfig.variant;
`;

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

const renderPublicAssets = async ({ repoRoot, selection, check }) => {
    const iconSvgPath = path.join(repoRoot, selection.variant.assets.sources.iconSvg);
    const iconSvg = fs.readFileSync(iconSvgPath, 'utf8');

    const changes = [
        writeOutputFile({ outputPath: path.join(repoRoot, 'public/favicon.svg'), rendered: iconSvg, check }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.icon192Png.slice(1)),
            content: await sharp(Buffer.from(iconSvg)).resize(192, 192).png().toBuffer(),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.icon512Png.slice(1)),
            content: await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toBuffer(),
            check,
        }),
        await writeBinaryOutputFile({
            outputPath: path.join(repoRoot, 'public', selection.variant.assets.public.iconMaskable512Png.slice(1)),
            content: await sharp(Buffer.from(iconSvg))
                .resize(512, 512, {
                    fit: 'contain',
                    background: selection.variant.platform.web.backgroundColor,
                })
                .png()
                .toBuffer(),
            check,
        }),
    ];

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
    const overlayPath = path.join(overlaysDir, `${variantId ?? config.repo.defaultVariant}.yaml`);
    if (!fs.existsSync(overlayPath)) {
        fail(`missing feature flag overlay for variant "${variantId ?? config.repo.defaultVariant}": ${path.relative(repoRoot, overlayPath)}`);
    }
    const overlay = parseFeatureFlagOverlaySource(fs.readFileSync(overlayPath, 'utf8'), {
        featureIds: new Set(baseRegistry.features.map((feature) => feature.id)),
        variantId: variantId ?? config.repo.defaultVariant,
    });
    const publishVariants = resolvePublishVariants(config, {
        publishTarget,
        explicitVariants: explicitPublishVariants,
    });
    const selection = buildVariantSelection({
        config,
        variantId,
        baseRegistry,
        overlay,
        publishVariants,
    });

    const changed = [
        writeOutputFile({ outputPath: resolvedRuntimeTsPath, rendered: renderVariantRuntimeModule(selection), check }),
        writeOutputFile({ outputPath: resolvedRuntimeJsonPath, rendered: renderVariantJson(selection), check }),
        writeOutputFile({ outputPath: resolvedWebIndexPath, rendered: renderWebIndexHtml(selection), check }),
        writeOutputFile({ outputPath: resolvedWebManifestPath, rendered: renderWebManifest(selection), check }),
        writeOutputFile({ outputPath: resolvedWebServiceWorkerPath, rendered: renderWebServiceWorker(selection), check }),
        writeOutputFile({
            outputPath: resolvedWebServerVariantTsPath,
            rendered: renderWebServerVariantModule(selection),
            check,
        }),
        await renderPublicAssets({ repoRoot, selection, check }),
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

if (isDirectInvocation()) {
    try {
        const args = parseCliArgs(process.argv.slice(2));
        const resolvedArgs = {
            ...args,
            variantId: args.variantId ?? process.env.APP_VARIANT ?? undefined,
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
