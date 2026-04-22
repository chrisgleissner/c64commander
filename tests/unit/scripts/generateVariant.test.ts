import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    VariantCompileError,
    compileVariant,
    parseFeatureFlagOverlaySource,
    parseVariantSource,
    renderVariantRuntimeModule,
    resolvePublishVariants,
    validateVariantConfig,
} from '../../../scripts/generate-variant.mjs';

const tempDirs = [];

const createTempDir = (prefix) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
};

const writeFile = (filePath, contents) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents, 'utf8');
};

const writeSvg = (repoRoot, relativePath) => {
    writeFile(path.join(repoRoot, relativePath), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>');
};

const buildVariantsYaml = (overrides = {}) => {
    const base = {
        schema_version: 1,
        repo: {
            default_variant: 'c64commander',
            publish_defaults: {
                release: ['c64commander'],
                ci: ['c64commander'],
            },
        },
        variants: {
            c64commander: {
                display_name: 'C64 Commander',
                app_id: 'c64commander',
                description: 'Configure and control your Commodore 64 Ultimate over your local network.',
                exported_file_basename: 'c64commander',
                platform: {
                    android: {
                        application_id: 'uk.gleissner.c64commander',
                        custom_url_scheme: 'uk.gleissner.c64commander',
                    },
                    ios: {
                        bundle_id: 'uk.gleissner.c64commander',
                    },
                    web: {
                        short_name: 'C64 Commander',
                        theme_color: '#6C7EB7',
                        background_color: '#6C7EB7',
                        cache_prefix: 'c64commander-static',
                        storage_prefix: 'c64commander',
                        login_title: 'C64 Commander Login',
                        login_heading: 'C64 Commander',
                        image_repo: 'ghcr.io/chrisgleissner/c64commander',
                    },
                },
                assets: {
                    sources: {
                        icon_svg: 'variants/assets/c64commander/icon.svg',
                        logo_svg: 'variants/assets/c64commander/logo.svg',
                        splash_svg: 'variants/assets/c64commander/splash.svg',
                    },
                },
                runtime: {
                    endpoints: {
                        device_host: 'c64u',
                        hvsc_base_url: 'https://hvsc.brona.dk/HVSC/',
                        commoserve_base_url: 'http://commoserve.files.commodore.net',
                    },
                },
            },
            'c64u-controller': {
                display_name: 'C64U Controller',
                app_id: 'c64u-controller',
                description: 'Configure and control your Commodore 64 Ultimate over your local network.',
                exported_file_basename: 'c64u-controller',
                platform: {
                    android: {
                        application_id: 'uk.gleissner.c64ucontroller',
                        custom_url_scheme: 'uk.gleissner.c64ucontroller',
                    },
                    ios: {
                        bundle_id: 'uk.gleissner.c64ucontroller',
                    },
                    web: {
                        short_name: 'C64U Controller',
                        theme_color: '#2F6B8B',
                        background_color: '#2F6B8B',
                        cache_prefix: 'c64u-controller-static',
                        storage_prefix: 'c64u-controller',
                        login_title: 'C64U Controller Login',
                        login_heading: 'C64U Controller',
                        image_repo: 'ghcr.io/chrisgleissner/c64u-controller',
                    },
                },
                assets: {
                    sources: {
                        icon_svg: 'variants/assets/c64u-controller/icon.svg',
                        logo_svg: 'variants/assets/c64u-controller/logo.svg',
                        splash_svg: 'variants/assets/c64u-controller/splash.svg',
                    },
                },
                runtime: {
                    endpoints: {
                        device_host: 'c64u',
                        hvsc_base_url: 'https://hvsc.brona.dk/HVSC/',
                        commoserve_base_url: 'http://commoserve.files.commodore.net',
                    },
                },
            },
        },
    };

    const merged = structuredClone(base);
    if (overrides.schema_version !== undefined) {
        merged.schema_version = overrides.schema_version;
    }
    if (overrides.repo) {
        merged.repo = overrides.repo;
    }
    if (overrides.variants) {
        merged.variants = overrides.variants;
    }

    return [
        `schema_version: ${merged.schema_version}`,
        '',
        'repo:',
        `  default_variant: ${merged.repo.default_variant}`,
        '  publish_defaults:',
        ...Object.entries(merged.repo.publish_defaults).flatMap(([key, values]) => [
            `    ${key}:`,
            ...values.map((value) => `      - ${value}`),
        ]),
        '',
        'variants:',
        ...Object.entries(merged.variants).flatMap(([variantId, variant]) => [
            `  ${variantId}:`,
            `    display_name: ${variant.display_name}`,
            `    app_id: ${variant.app_id}`,
            `    description: ${variant.description}`,
            `    exported_file_basename: ${variant.exported_file_basename}`,
            '    platform:',
            '      android:',
            `        application_id: ${variant.platform.android.application_id}`,
            `        custom_url_scheme: ${variant.platform.android.custom_url_scheme}`,
            '      ios:',
            `        bundle_id: ${variant.platform.ios.bundle_id}`,
            '      web:',
            `        short_name: ${variant.platform.web.short_name}`,
            `        theme_color: '${variant.platform.web.theme_color}'`,
            `        background_color: '${variant.platform.web.background_color}'`,
            `        cache_prefix: ${variant.platform.web.cache_prefix}`,
            `        storage_prefix: ${variant.platform.web.storage_prefix}`,
            `        login_title: ${variant.platform.web.login_title}`,
            `        login_heading: ${variant.platform.web.login_heading}`,
            `        image_repo: ${variant.platform.web.image_repo}`,
            '    assets:',
            '      sources:',
            `        icon_svg: ${variant.assets.sources.icon_svg}`,
            `        logo_svg: ${variant.assets.sources.logo_svg}`,
            `        splash_svg: ${variant.assets.sources.splash_svg}`,
            '    runtime:',
            '      endpoints:',
            ...Object.entries(variant.runtime.endpoints).map(([key, value]) => `        ${key}: ${value}`),
        ]),
        '',
    ].join('\n');
};

const writeRepoFixtures = (repoRoot) => {
    writeSvg(repoRoot, 'variants/assets/c64commander/icon.svg');
    writeSvg(repoRoot, 'variants/assets/c64commander/logo.svg');
    writeSvg(repoRoot, 'variants/assets/c64commander/splash.svg');
    writeSvg(repoRoot, 'variants/assets/c64u-controller/icon.svg');
    writeSvg(repoRoot, 'variants/assets/c64u-controller/logo.svg');
    writeSvg(repoRoot, 'variants/assets/c64u-controller/splash.svg');
    writeFile(
        path.join(repoRoot, 'src/lib/config/feature-flags.yaml'),
        [
            'version: 1',
            'groups:',
            '  stable:',
            '    label: Stable',
            '    description: Stable features.',
            'features:',
            '  - id: hvsc_enabled',
            '    enabled: true',
            '    visible_to_user: true',
            '    developer_only: false',
            '    group: stable',
            '    title: HVSC',
            '    description: HVSC support.',
            '  - id: commoserve_enabled',
            '    enabled: true',
            '    visible_to_user: true',
            '    developer_only: false',
            '    group: stable',
            '    title: CommoServe',
            '    description: CommoServe support.',
            '',
        ].join('\n'),
    );
    writeFile(path.join(repoRoot, 'variants/feature-flags/c64commander.yaml'), 'overrides: {}\n');
    writeFile(
        path.join(repoRoot, 'variants/feature-flags/c64u-controller.yaml'),
        ['overrides:', '  commoserve_enabled:', '    enabled: false', ''].join('\n'),
    );
};

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('generate-variant', () => {
    it('validates a well-formed config and keeps publish defaults explicit', () => {
        const repoRoot = createTempDir('variant-config-');
        writeRepoFixtures(repoRoot);
        const config = parseVariantSource(buildVariantsYaml(), { repoRoot });
        expect(config.repo.defaultVariant).toBe('c64commander');
        expect(config.repo.publishDefaults.release).toEqual(['c64commander']);
        expect(config.variants['c64u-controller'].platform.web.storagePrefix).toBe('c64u-controller');
    });

    it('fails when schema_version is absent', () => {
        const repoRoot = createTempDir('variant-config-');
        writeRepoFixtures(repoRoot);
        expect(() =>
            validateVariantConfig(
                {
                    repo: { default_variant: 'c64commander', publish_defaults: { release: ['c64commander'] } },
                    variants: {},
                },
                { repoRoot },
            ),
        ).toThrow(/schema_version/);
    });

    it('fails when schema_version is unsupported', () => {
        const repoRoot = createTempDir('variant-config-');
        writeRepoFixtures(repoRoot);
        expect(() => parseVariantSource(buildVariantsYaml({ schema_version: 2 }), { repoRoot })).toThrow(
            /unsupported schema_version 2/,
        );
    });

    it.each([
        ['app_id', 'app_id'],
        ['application_id', 'application_id'],
        ['bundle_id', 'bundle_id'],
        ['custom_url_scheme', 'custom_url_scheme'],
    ])('fails on %s collisions', (_label, field) => {
        const repoRoot = createTempDir('variant-config-');
        writeRepoFixtures(repoRoot);
        const variants = {
            c64commander: {
                display_name: 'C64 Commander',
                app_id: 'same-value',
                description: 'One',
                exported_file_basename: 'one',
                platform: {
                    android: {
                        application_id: 'same-android',
                        custom_url_scheme: 'same-scheme',
                    },
                    ios: {
                        bundle_id: 'same-bundle',
                    },
                    web: {
                        short_name: 'One',
                        theme_color: '#000000',
                        background_color: '#000000',
                        cache_prefix: 'one-cache',
                        storage_prefix: 'one',
                        login_title: 'One Login',
                        login_heading: 'One',
                        image_repo: 'repo/one',
                    },
                },
                assets: {
                    sources: {
                        icon_svg: 'variants/assets/c64commander/icon.svg',
                        logo_svg: 'variants/assets/c64commander/logo.svg',
                        splash_svg: 'variants/assets/c64commander/splash.svg',
                    },
                },
                runtime: { endpoints: { device_host: 'c64u' } },
            },
            duplicate: {
                display_name: 'Duplicate',
                app_id: field === 'app_id' ? 'same-value' : 'different-app-id',
                description: 'Two',
                exported_file_basename: 'two',
                platform: {
                    android: {
                        application_id: field === 'application_id' ? 'same-android' : 'different-android',
                        custom_url_scheme: field === 'custom_url_scheme' ? 'same-scheme' : 'different-scheme',
                    },
                    ios: {
                        bundle_id: field === 'bundle_id' ? 'same-bundle' : 'different-bundle',
                    },
                    web: {
                        short_name: 'Two',
                        theme_color: '#111111',
                        background_color: '#111111',
                        cache_prefix: 'two-cache',
                        storage_prefix: 'two',
                        login_title: 'Two Login',
                        login_heading: 'Two',
                        image_repo: 'repo/two',
                    },
                },
                assets: {
                    sources: {
                        icon_svg: 'variants/assets/c64u-controller/icon.svg',
                        logo_svg: 'variants/assets/c64u-controller/logo.svg',
                        splash_svg: 'variants/assets/c64u-controller/splash.svg',
                    },
                },
                runtime: { endpoints: { device_host: 'c64u' } },
            },
        };

        expect(() => parseVariantSource(buildVariantsYaml({ variants }), { repoRoot })).toThrow(new RegExp(field));
    });

    it('fails when a publish default references an unknown variant', () => {
        const repoRoot = createTempDir('variant-config-');
        writeRepoFixtures(repoRoot);
        expect(() =>
            parseVariantSource(
                buildVariantsYaml({
                    repo: {
                        default_variant: 'c64commander',
                        publish_defaults: {
                            release: ['missing-variant'],
                            ci: ['c64commander'],
                        },
                    },
                }),
                { repoRoot },
            ),
        ).toThrow(/publish_defaults.release references unknown variant/);
    });

    it('fails when a declared asset path is missing', () => {
        const repoRoot = createTempDir('variant-config-');
        writeRepoFixtures(repoRoot);
        rmSync(path.join(repoRoot, 'variants/assets/c64u-controller/logo.svg'));
        expect(() => parseVariantSource(buildVariantsYaml(), { repoRoot })).toThrow(/assets.sources.logo_svg is missing/);
    });

    it('fails for unknown feature ids in variant overlays', () => {
        expect(() =>
            parseFeatureFlagOverlaySource(['overrides:', '  missing_feature:', '    enabled: false', ''].join('\n'), {
                featureIds: new Set(['hvsc_enabled']),
                variantId: 'c64u-controller',
            }),
        ).toThrow(/unknown feature id/);
    });

    it('fails for disallowed feature overlay fields', () => {
        expect(() =>
            parseFeatureFlagOverlaySource(['overrides:', '  hvsc_enabled:', '    title: Nope', ''].join('\n'), {
                featureIds: new Set(['hvsc_enabled']),
                variantId: 'c64u-controller',
            }),
        ).toThrow(/disallowed fields: title/);
    });

    it('writes deterministic runtime outputs and resolves variant-specific feature defaults', async () => {
        const repoRoot = createTempDir('variant-compile-');
        writeRepoFixtures(repoRoot);
        const variantsPath = path.join(repoRoot, 'variants/variants.yaml');
        writeFile(variantsPath, buildVariantsYaml());
        const runtimeTsPath = path.join(repoRoot, 'src/generated/variant.ts');
        const runtimeJsonPath = path.join(repoRoot, 'src/generated/variant.json');

        const first = await compileVariant({
            variantsPath,
            featureFlagsPath: path.join(repoRoot, 'src/lib/config/feature-flags.yaml'),
            overlaysDir: path.join(repoRoot, 'variants/feature-flags'),
            runtimeTsPath,
            runtimeJsonPath,
            variantId: 'c64u-controller',
            explicitPublishVariants: ['c64commander', 'c64u-controller'],
        });

        expect(first.changed).toBe(true);
        expect(first.selection.variant.featureFlags.commoserve_enabled.enabled).toBe(false);
        expect(first.selection.repo.selectedPublishVariants).toEqual(['c64commander', 'c64u-controller']);
        expect(readFileSync(runtimeJsonPath, 'utf8')).toContain('"selectedVariantId": "c64u-controller"');
        expect(readFileSync(runtimeTsPath, 'utf8')).toContain('buildLocalStorageKey');
        expect(readFileSync(path.join(repoRoot, 'index.html'), 'utf8')).toContain('C64U Controller');
        expect(readFileSync(path.join(repoRoot, 'public/manifest.webmanifest'), 'utf8')).toContain('c64u-controller-192.png');
        expect(readFileSync(path.join(repoRoot, 'web/server/src/variant.generated.ts'), 'utf8')).toContain('C64U Controller');

        const second = await compileVariant({
            variantsPath,
            featureFlagsPath: path.join(repoRoot, 'src/lib/config/feature-flags.yaml'),
            overlaysDir: path.join(repoRoot, 'variants/feature-flags'),
            runtimeTsPath,
            runtimeJsonPath,
            variantId: 'c64u-controller',
            explicitPublishVariants: ['c64commander', 'c64u-controller'],
        });
        expect(second.changed).toBe(false);
    });

    it('supports check mode and detects drift', async () => {
        const repoRoot = createTempDir('variant-compile-');
        writeRepoFixtures(repoRoot);
        const variantsPath = path.join(repoRoot, 'variants/variants.yaml');
        writeFile(variantsPath, buildVariantsYaml());
        const runtimeTsPath = path.join(repoRoot, 'src/generated/variant.ts');
        const runtimeJsonPath = path.join(repoRoot, 'src/generated/variant.json');

        await compileVariant({
            variantsPath,
            featureFlagsPath: path.join(repoRoot, 'src/lib/config/feature-flags.yaml'),
            overlaysDir: path.join(repoRoot, 'variants/feature-flags'),
            runtimeTsPath,
            runtimeJsonPath,
            variantId: 'c64commander',
        });

        await expect(
            compileVariant({
                variantsPath,
                featureFlagsPath: path.join(repoRoot, 'src/lib/config/feature-flags.yaml'),
                overlaysDir: path.join(repoRoot, 'variants/feature-flags'),
                runtimeTsPath,
                runtimeJsonPath,
                variantId: 'c64commander',
                check: true,
            }),
        ).resolves.toMatchObject({ changed: false });

        writeFile(runtimeJsonPath, '{"stale":true}\n');
        await expect(
            compileVariant({
                variantsPath,
                featureFlagsPath: path.join(repoRoot, 'src/lib/config/feature-flags.yaml'),
                overlaysDir: path.join(repoRoot, 'variants/feature-flags'),
                runtimeTsPath,
                runtimeJsonPath,
                variantId: 'c64commander',
                check: true,
            }),
        ).rejects.toThrow(/out of date/);
    });

    it('resolves default and explicit publish selections', () => {
        const repoRoot = createTempDir('variant-config-');
        writeRepoFixtures(repoRoot);
        const config = parseVariantSource(buildVariantsYaml(), { repoRoot });
        expect(resolvePublishVariants(config)).toEqual(['c64commander']);
        expect(resolvePublishVariants(config, { explicitVariants: ['c64u-controller', 'c64commander'] })).toEqual([
            'c64commander',
            'c64u-controller',
        ]);
    });

    it('renders a runtime module with variant storage helpers', () => {
        const moduleSource = renderVariantRuntimeModule({
            schemaVersion: 1,
            repo: { defaultVariant: 'c64commander', publishDefaults: { release: ['c64commander'] }, selectedPublishVariants: [] },
            selectedVariantId: 'c64commander',
            variant: {
                id: 'c64commander',
                platform: { web: { storagePrefix: 'c64commander' } },
            },
        });
        expect(moduleSource).toContain('export const variantConfig =');
        expect(moduleSource).toContain('buildLocalStorageKey');
    });

    it('reports missing overlays with an explicit error', async () => {
        const repoRoot = createTempDir('variant-compile-');
        writeRepoFixtures(repoRoot);
        const variantsPath = path.join(repoRoot, 'variants/variants.yaml');
        writeFile(variantsPath, buildVariantsYaml());
        rmSync(path.join(repoRoot, 'variants/feature-flags/c64u-controller.yaml'));

        await expect(
            compileVariant({
                variantsPath,
                featureFlagsPath: path.join(repoRoot, 'src/lib/config/feature-flags.yaml'),
                overlaysDir: path.join(repoRoot, 'variants/feature-flags'),
                runtimeTsPath: path.join(repoRoot, 'src/generated/variant.ts'),
                runtimeJsonPath: path.join(repoRoot, 'src/generated/variant.json'),
                variantId: 'c64u-controller',
            }),
        ).rejects.toThrow(VariantCompileError);
    });
});
