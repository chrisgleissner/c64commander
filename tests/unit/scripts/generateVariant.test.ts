import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import {
  VariantCompileError,
  compileVariant,
  parseFeatureFlagOverlaySource,
  parseVariantSource,
  renderVariantRuntimeModule,
  resolvePublishVariants,
  validateVariantConfig,
} from "../../../scripts/generate-variant.mjs";

type VariantRepoConfig = {
  default_variant: string;
  publish_defaults: {
    release: string[];
    ci: string[];
  } & Record<string, string[]>;
};

type VariantYamlModel = {
  schema_version: number;
  repo: VariantRepoConfig;
  variants: Record<string, VariantDefinition>;
};

type VariantDefinition = {
  display_name: string;
  app_id: string;
  description: string;
  exported_file_basename: string;
  platform: {
    android: {
      application_id: string;
      custom_url_scheme: string;
    };
    ios: {
      bundle_id: string;
    };
    web: {
      short_name: string;
      theme_color: string;
      background_color: string;
      login_title: string;
      login_heading: string;
    };
  };
  assets: {
    sources: {
      icon: VariantAssetSource;
      logo: VariantAssetSource;
      splash: VariantAssetSource;
    };
  };
  runtime: {
    endpoints: Record<string, string>;
  };
};

type VariantAssetSource = {
  path: string;
  format: string;
};

type VariantYamlOverrides = {
  schema_version?: number;
  repo?: VariantRepoConfig;
  variants?: Record<string, VariantDefinition>;
  /** Extra raw YAML lines appended under a variant's `runtime:` block (indented). */
  runtimeExtras?: Record<string, string[]>;
};

type CompileVariantOptions = {
  variantsPath?: string;
  featureFlagsPath?: string;
  overlaysDir?: string;
  runtimeTsPath?: string;
  runtimeJsonPath?: string;
  webIndexPath?: string;
  webManifestPath?: string;
  webServiceWorkerPath?: string;
  webServerVariantTsPath?: string;
  variantId?: string;
  publishTarget?: string;
  explicitPublishVariants?: string[] | null;
  check?: boolean;
};

const compileVariantTyped = compileVariant as (options?: CompileVariantOptions) => Promise<any>;
const resolvePublishVariantsTyped = resolvePublishVariants as (
  config: any,
  options?: { publishTarget?: string; explicitVariants?: string[] | null },
) => string[];
const REAL_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const tempDirs: string[] = [];

const createTempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const writeFile = (filePath: string, contents: string) => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
};

const writeBinaryFile = (filePath: string, contents: Buffer) => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
};

// A conformant 1x1 transparent RGBA PNG produced by sharp itself. It MUST be a
// strictly-valid PNG: the previous hand-crafted fixture used a "Sub" scanline
// filter that older libpng tolerated but libpng >= 1.6.50 (shipped with sharp
// 0.35 / libvips 8.18) rejects on read with "vipspng: libpng read error",
// breaking every test that compiles a variant. Using sharp's own output keeps
// this fixture valid across future sharp/libvips upgrades (sharp uses 0.x
// versioning, so Dependabot "minor" bumps routinely carry libvips changes).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64",
);

const writePng = (repoRoot: string, relativePath: string) => {
  writeBinaryFile(path.join(repoRoot, relativePath), TINY_PNG);
};

const buildVariantsYaml = (overrides: VariantYamlOverrides = {}) => {
  const base: VariantYamlModel = {
    schema_version: 1,
    repo: {
      default_variant: "c64commander",
      publish_defaults: {
        release: ["c64commander"],
        ci: ["c64commander"],
      },
    },
    variants: {
      c64commander: {
        display_name: "C64 Commander",
        app_id: "c64commander",
        description: "Configure and control your Commodore 64 Ultimate over your local network.",
        exported_file_basename: "c64commander",
        platform: {
          android: {
            application_id: "uk.gleissner.c64commander",
            custom_url_scheme: "uk.gleissner.c64commander",
          },
          ios: {
            bundle_id: "uk.gleissner.c64commander",
          },
          web: {
            short_name: "C64 Commander",
            theme_color: "#6C7EB7",
            background_color: "#6C7EB7",
            login_title: "C64 Commander Login",
            login_heading: "C64 Commander",
          },
        },
        assets: {
          sources: {
            icon: { path: "variants/assets/c64commander/icon.png", format: "png" },
            logo: { path: "variants/assets/c64commander/logo.png", format: "png" },
            splash: { path: "variants/assets/c64commander/splash.png", format: "png" },
          },
        },
        runtime: {
          endpoints: {
            device_host: "c64u",
            hvsc_base_url: "https://hvsc.brona.dk/HVSC/",
            commoserve_base_url: "http://commoserve.files.commodore.net",
          },
        },
      },
      "c64u-remote": {
        display_name: "C64U Remote",
        app_id: "c64u-remote",
        description: "Configure and control your Commodore 64 Ultimate over your local network.",
        exported_file_basename: "c64u-remote",
        platform: {
          android: {
            application_id: "uk.gleissner.c64uremote",
            custom_url_scheme: "uk.gleissner.c64uremote",
          },
          ios: {
            bundle_id: "uk.gleissner.c64uremote",
          },
          web: {
            short_name: "C64U Remote",
            theme_color: "#2F6B8B",
            background_color: "#2F6B8B",
            login_title: "C64U Remote Login",
            login_heading: "C64U Remote",
          },
        },
        assets: {
          sources: {
            icon: { path: "variants/assets/c64u-remote/icon.png", format: "png" },
            logo: { path: "variants/assets/c64u-remote/logo.png", format: "png" },
            splash: { path: "variants/assets/c64u-remote/splash.png", format: "png" },
          },
        },
        runtime: {
          endpoints: {
            device_host: "c64u",
            hvsc_base_url: "https://hvsc.brona.dk/HVSC/",
            commoserve_base_url: "http://commoserve.files.commodore.net",
          },
        },
      },
    },
  };

  const merged: VariantYamlModel = structuredClone(base);
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
    "",
    "repo:",
    `  default_variant: ${merged.repo.default_variant}`,
    "  publish_defaults:",
    ...Object.entries(merged.repo.publish_defaults).flatMap(([key, values]) => [
      `    ${key}:`,
      ...values.map((value) => `      - ${value}`),
    ]),
    "",
    "variants:",
    ...Object.entries(merged.variants).flatMap(([variantId, variant]) => [
      `  ${variantId}:`,
      `    display_name: ${variant.display_name}`,
      `    app_id: ${variant.app_id}`,
      `    description: ${variant.description}`,
      `    exported_file_basename: ${variant.exported_file_basename}`,
      "    platform:",
      "      android:",
      `        application_id: ${variant.platform.android.application_id}`,
      `        custom_url_scheme: ${variant.platform.android.custom_url_scheme}`,
      "      ios:",
      `        bundle_id: ${variant.platform.ios.bundle_id}`,
      "      web:",
      `        short_name: ${variant.platform.web.short_name}`,
      `        theme_color: '${variant.platform.web.theme_color}'`,
      `        background_color: '${variant.platform.web.background_color}'`,
      `        login_title: ${variant.platform.web.login_title}`,
      `        login_heading: ${variant.platform.web.login_heading}`,
      "    assets:",
      "      sources:",
      "        icon:",
      `          path: ${variant.assets.sources.icon.path}`,
      `          format: ${variant.assets.sources.icon.format}`,
      "        logo:",
      `          path: ${variant.assets.sources.logo.path}`,
      `          format: ${variant.assets.sources.logo.format}`,
      "        splash:",
      `          path: ${variant.assets.sources.splash.path}`,
      `          format: ${variant.assets.sources.splash.format}`,
      "    runtime:",
      "      endpoints:",
      ...Object.entries(variant.runtime.endpoints).map(([key, value]) => `        ${key}: ${value}`),
      ...(overrides.runtimeExtras?.[variantId] ?? []).map((line) => `      ${line}`),
    ]),
    "",
  ].join("\n");
};

const writeRepoFixtures = (repoRoot: string) => {
  writePng(repoRoot, "variants/assets/c64commander/icon.png");
  writePng(repoRoot, "variants/assets/c64commander/logo.png");
  writePng(repoRoot, "variants/assets/c64commander/splash.png");
  writePng(repoRoot, "variants/assets/c64u-remote/icon.png");
  writePng(repoRoot, "variants/assets/c64u-remote/logo.png");
  writePng(repoRoot, "variants/assets/c64u-remote/splash.png");
  writeFile(
    path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
    [
      "version: 1",
      "groups:",
      "  stable:",
      "    label: Stable",
      "    description: Stable features.",
      "features:",
      "  - id: hvsc_enabled",
      "    enabled: true",
      "    visible_to_user: true",
      "    developer_only: false",
      "    group: stable",
      "    title: HVSC",
      "    description: HVSC support.",
      "  - id: commoserve_enabled",
      "    enabled: true",
      "    visible_to_user: true",
      "    developer_only: false",
      "    group: stable",
      "    title: CommoServe",
      "    description: CommoServe support.",
      "",
    ].join("\n"),
  );
  writeFile(path.join(repoRoot, "variants/feature-flags/c64commander.yaml"), "overrides: {}\n");
  writeFile(
    path.join(repoRoot, "variants/feature-flags/c64u-remote.yaml"),
    ["overrides:", "  hvsc_enabled:", "    enabled: false", ""].join("\n"),
  );
};

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("generate-variant", () => {
  it("validates a well-formed config and keeps publish defaults explicit", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    const config = parseVariantSource(buildVariantsYaml(), { repoRoot }) as any;
    expect(config.repo.defaultVariant).toBe("c64commander");
    expect(config.repo.publishDefaults.release).toEqual(["c64commander"]);
    expect(config.variants["c64u-remote"].platform.web.loginHeading).toBe("C64U Remote");
  });

  it("normalizes per-variant full-screen system-bar defaults from runtime, defaulting to false", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    const config = parseVariantSource(
      buildVariantsYaml({
        runtimeExtras: {
          "c64u-remote": ["default_hide_status_bar: true", "default_hide_navigation_bar: true"],
        },
      }),
      { repoRoot },
    ) as any;
    // A variant can opt into full-screen by default through runtime overrides...
    expect(config.variants["c64u-remote"].runtime.defaultHideStatusBar).toBe(true);
    expect(config.variants["c64u-remote"].runtime.defaultHideNavigationBar).toBe(true);
    // ...while a variant that does not opt in stays full-screen OFF.
    expect(config.variants["c64commander"].runtime.defaultHideStatusBar).toBe(false);
    expect(config.variants["c64commander"].runtime.defaultHideNavigationBar).toBe(false);
  });

  it("fails when schema_version is absent", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    expect(() =>
      validateVariantConfig(
        {
          repo: { default_variant: "c64commander", publish_defaults: { release: ["c64commander"] } },
          variants: {},
        },
        { repoRoot },
      ),
    ).toThrow(/schema_version/);
  });

  it("fails when schema_version is unsupported", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    expect(() => parseVariantSource(buildVariantsYaml({ schema_version: 2 }), { repoRoot })).toThrow(
      /unsupported schema_version 2/,
    );
  });

  it.each([
    ["app_id", "app_id"],
    ["application_id", "application_id"],
    ["bundle_id", "bundle_id"],
    ["custom_url_scheme", "custom_url_scheme"],
  ])("fails on %s collisions", (_label, field) => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    const variants = {
      c64commander: {
        display_name: "C64 Commander",
        app_id: "same-value",
        description: "One",
        exported_file_basename: "one",
        platform: {
          android: {
            application_id: "same-android",
            custom_url_scheme: "same-scheme",
          },
          ios: {
            bundle_id: "same-bundle",
          },
          web: {
            short_name: "One",
            theme_color: "#000000",
            background_color: "#000000",
            login_title: "One Login",
            login_heading: "One",
          },
        },
        assets: {
          sources: {
            icon: { path: "variants/assets/c64commander/icon.png", format: "png" },
            logo: { path: "variants/assets/c64commander/logo.png", format: "png" },
            splash: { path: "variants/assets/c64commander/splash.png", format: "png" },
          },
        },
        runtime: { endpoints: { device_host: "c64u" } },
      },
      duplicate: {
        display_name: "Duplicate",
        app_id: field === "app_id" ? "same-value" : "different-app-id",
        description: "Two",
        exported_file_basename: "two",
        platform: {
          android: {
            application_id: field === "application_id" ? "same-android" : "different-android",
            custom_url_scheme: field === "custom_url_scheme" ? "same-scheme" : "different-scheme",
          },
          ios: {
            bundle_id: field === "bundle_id" ? "same-bundle" : "different-bundle",
          },
          web: {
            short_name: "Two",
            theme_color: "#111111",
            background_color: "#111111",
            login_title: "Two Login",
            login_heading: "Two",
          },
        },
        assets: {
          sources: {
            icon: { path: "variants/assets/c64u-remote/icon.png", format: "png" },
            logo: { path: "variants/assets/c64u-remote/logo.png", format: "png" },
            splash: { path: "variants/assets/c64u-remote/splash.png", format: "png" },
          },
        },
        runtime: { endpoints: { device_host: "c64u" } },
      },
    };

    expect(() => parseVariantSource(buildVariantsYaml({ variants }), { repoRoot })).toThrow(new RegExp(field));
  });

  it("fails when a publish default references an unknown variant", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    expect(() =>
      parseVariantSource(
        buildVariantsYaml({
          repo: {
            default_variant: "c64commander",
            publish_defaults: {
              release: ["missing-variant"],
              ci: ["c64commander"],
            },
          },
        }),
        { repoRoot },
      ),
    ).toThrow(/publish_defaults.release references unknown variant/);
  });

  it("fails when a declared asset path is missing", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    rmSync(path.join(repoRoot, "variants/assets/c64u-remote/logo.png"));
    expect(() => parseVariantSource(buildVariantsYaml(), { repoRoot })).toThrow(/assets.sources.logo.path is missing/);
  });

  it("rejects asset paths that escape the repository root", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    const config = {
      schema_version: 1,
      repo: {
        default_variant: "c64commander",
        publish_defaults: {
          release: ["c64commander"],
          ci: ["c64commander"],
        },
      },
      variants: {
        c64commander: {
          display_name: "C64 Commander",
          app_id: "c64commander",
          description: "Configure and control your Commodore 64 Ultimate over your local network.",
          exported_file_basename: "c64commander",
          platform: {
            android: {
              application_id: "uk.gleissner.c64commander",
              custom_url_scheme: "uk.gleissner.c64commander",
            },
            ios: {
              bundle_id: "uk.gleissner.c64commander",
            },
            web: {
              short_name: "C64 Commander",
              theme_color: "#6C7EB7",
              background_color: "#6C7EB7",
              login_title: "C64 Commander Login",
              login_heading: "C64 Commander",
            },
          },
          assets: {
            sources: {
              icon: { path: "../outside/icon.png", format: "png" },
              logo: { path: "variants/assets/c64commander/logo.png", format: "png" },
              splash: { path: "variants/assets/c64commander/splash.png", format: "png" },
            },
          },
          runtime: {
            endpoints: {
              device_host: "c64u",
            },
          },
        },
      },
    };
    expect(() => validateVariantConfig(config, { repoRoot })).toThrow(/must stay within the repository/);
  });

  it("fails for unknown feature ids in variant overlays", () => {
    expect(() =>
      parseFeatureFlagOverlaySource(["overrides:", "  missing_feature:", "    enabled: false", ""].join("\n"), {
        featureIds: new Set(["hvsc_enabled"]),
        variantId: "c64u-remote",
      }),
    ).toThrow(/unknown feature id/);
  });

  it("fails for disallowed feature overlay fields", () => {
    expect(() =>
      parseFeatureFlagOverlaySource(["overrides:", "  hvsc_enabled:", "    title: Nope", ""].join("\n"), {
        featureIds: new Set(["hvsc_enabled"]),
        variantId: "c64u-remote",
      }),
    ).toThrow(/disallowed fields: title/);
  });

  it("writes deterministic runtime outputs and resolves variant-specific feature defaults", async () => {
    const repoRoot = createTempDir("variant-compile-");
    writeRepoFixtures(repoRoot);
    const variantsPath = path.join(repoRoot, "variants/variants.yaml");
    writeFile(variantsPath, buildVariantsYaml());
    const runtimeTsPath = path.join(repoRoot, "src/generated/variant.ts");
    const runtimeJsonPath = path.join(repoRoot, "src/generated/variant.json");

    const first = await compileVariantTyped({
      variantsPath,
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      runtimeTsPath,
      runtimeJsonPath,
      variantId: "c64u-remote",
      explicitPublishVariants: ["c64commander", "c64u-remote"],
    });

    expect(first.changed).toBe(true);
    expect(first.selection.variant.featureFlags.hvsc_enabled.enabled).toBe(false);
    expect(first.selection.variant.featureFlags.commoserve_enabled.enabled).toBe(true);
    expect(first.selection.repo.selectedPublishVariants).toEqual(["c64commander", "c64u-remote"]);
    expect(readFileSync(runtimeJsonPath, "utf8")).toContain('"selectedVariantId": "c64u-remote"');
    expect(readFileSync(runtimeTsPath, "utf8")).not.toContain("buildLocalStorageKey");
    expect(readFileSync(path.join(repoRoot, "index.html"), "utf8")).toContain("C64U Remote");
    expect(readFileSync(path.join(repoRoot, "index.html"), "utf8")).toContain("background: #2F6B8B;");
    expect(readFileSync(path.join(repoRoot, "public/manifest.webmanifest"), "utf8")).toContain("c64u-remote-192.png");
    expect(readFileSync(path.join(repoRoot, "web/server/src/variant.generated.ts"), "utf8")).toContain("C64U Remote");
    expect(readFileSync(path.join(repoRoot, "android/app/src/main/res/values/strings.xml"), "utf8")).toContain(
      '<string name="app_name">C64U Remote</string>',
    );
    expect(
      readFileSync(path.join(repoRoot, "android/app/src/main/res/values/ic_launcher_background.xml"), "utf8"),
    ).toContain("#2F6B8B");
    expect(readFileSync(path.join(repoRoot, "ios/App/App/Base.lproj/LaunchScreen.storyboard"), "utf8")).toContain(
      'customColorSpace="sRGB"',
    );
    expect(readFileSync(path.join(repoRoot, "ios/App/App/Base.lproj/LaunchScreen.storyboard"), "utf8")).not.toContain(
      "systemBackgroundColor",
    );
    expect(readFileSync(path.join(repoRoot, "ios/App/App/Config/Variant.generated.xcconfig"), "utf8")).toContain(
      "VARIANT_BUNDLE_IDENTIFIER = uk.gleissner.c64uremote",
    );
    expect(existsSync(path.join(repoRoot, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"))).toBe(
      true,
    );

    const second = await compileVariantTyped({
      variantsPath,
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      runtimeTsPath,
      runtimeJsonPath,
      variantId: "c64u-remote",
      explicitPublishVariants: ["c64commander", "c64u-remote"],
    });
    expect(second.changed).toBe(false);
  });

  it("supports check mode and detects drift", async () => {
    const repoRoot = createTempDir("variant-compile-");
    writeRepoFixtures(repoRoot);
    const variantsPath = path.join(repoRoot, "variants/variants.yaml");
    writeFile(variantsPath, buildVariantsYaml());
    const runtimeTsPath = path.join(repoRoot, "src/generated/variant.ts");
    const runtimeJsonPath = path.join(repoRoot, "src/generated/variant.json");

    await compileVariantTyped({
      variantsPath,
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      runtimeTsPath,
      runtimeJsonPath,
      variantId: "c64commander",
    });

    await expect(
      compileVariantTyped({
        variantsPath,
        featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
        overlaysDir: path.join(repoRoot, "variants/feature-flags"),
        runtimeTsPath,
        runtimeJsonPath,
        variantId: "c64commander",
        check: true,
      }),
    ).resolves.toMatchObject({ changed: false });

    writeFile(runtimeJsonPath, '{"stale":true}\n');
    await expect(
      compileVariantTyped({
        variantsPath,
        featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
        overlaysDir: path.join(repoRoot, "variants/feature-flags"),
        runtimeTsPath,
        runtimeJsonPath,
        variantId: "c64commander",
        check: true,
      }),
    ).rejects.toThrow(/out of date/);
  });

  it("keeps the checked-in c64commander icon within budget and emits native splash assets", async () => {
    const repoRoot = createTempDir("variant-compile-");
    writeRepoFixtures(repoRoot);
    const variantsPath = path.join(repoRoot, "variants/variants.yaml");
    writeFile(variantsPath, buildVariantsYaml());
    const runtimeTsPath = path.join(repoRoot, "src/generated/variant.ts");
    const runtimeJsonPath = path.join(repoRoot, "src/generated/variant.json");

    await compileVariantTyped({
      variantsPath,
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      runtimeTsPath,
      runtimeJsonPath,
      variantId: "c64commander",
    });

    const publicIconPath = path.join(REAL_REPO_ROOT, "public/c64commander.png");
    const publicIconSize = readFileSync(publicIconPath).byteLength;

    expect(publicIconSize).toBeLessThanOrEqual(256 * 1024);
    expect(existsSync(path.join(repoRoot, "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png"))).toBe(
      true,
    );
    expect(existsSync(path.join(repoRoot, "android/app/src/main/res/drawable/splash.png"))).toBe(true);
  });

  it("resolves default and explicit publish selections", () => {
    const repoRoot = createTempDir("variant-config-");
    writeRepoFixtures(repoRoot);
    const config = parseVariantSource(buildVariantsYaml(), { repoRoot }) as any;
    expect(resolvePublishVariantsTyped(config)).toEqual(["c64commander"]);
    expect(resolvePublishVariantsTyped(config, { explicitVariants: ["c64u-remote", "c64commander"] })).toEqual([
      "c64commander",
      "c64u-remote",
    ]);
  });

  it("renders a runtime module without storage helpers", () => {
    const moduleSource = renderVariantRuntimeModule({
      schemaVersion: 1,
      repo: {
        defaultVariant: "c64commander",
        publishDefaults: { release: ["c64commander"] },
        selectedPublishVariants: [],
      },
      selectedVariantId: "c64commander",
      variant: {
        id: "c64commander",
        platform: { web: { loginHeading: "C64 Commander" } },
      },
    });
    expect(moduleSource).toContain("export const variantConfig =");
    expect(moduleSource).not.toContain("buildLocalStorageKey");
    expect(moduleSource).not.toContain("suffix: string");
  });

  it("reports missing overlays with an explicit error", async () => {
    const repoRoot = createTempDir("variant-compile-");
    writeRepoFixtures(repoRoot);
    const variantsPath = path.join(repoRoot, "variants/variants.yaml");
    writeFile(variantsPath, buildVariantsYaml());
    rmSync(path.join(repoRoot, "variants/feature-flags/c64u-remote.yaml"));

    await expect(
      compileVariantTyped({
        variantsPath,
        featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
        overlaysDir: path.join(repoRoot, "variants/feature-flags"),
        runtimeTsPath: path.join(repoRoot, "src/generated/variant.ts"),
        runtimeJsonPath: path.join(repoRoot, "src/generated/variant.json"),
        variantId: "c64u-remote",
      }),
    ).rejects.toThrow(VariantCompileError);
  });

  it("uses APP_PUBLISH_VARIANTS when explicit publish variants are not passed on the CLI", async () => {
    const repoRoot = createTempDir("variant-env-");
    writeRepoFixtures(repoRoot);
    const variantsPath = path.join(repoRoot, "variants/variants.yaml");
    writeFile(variantsPath, buildVariantsYaml());
    const runtimeTsPath = path.join(repoRoot, "src/generated/variant.ts");
    const runtimeJsonPath = path.join(repoRoot, "src/generated/variant.json");

    process.env.APP_PUBLISH_VARIANTS = "c64u-remote,c64commander";
    const result = await compileVariantTyped({
      variantsPath,
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      runtimeTsPath,
      runtimeJsonPath,
      variantId: "c64commander",
      explicitPublishVariants: (process.env.APP_PUBLISH_VARIANTS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    });

    expect(result.selection.repo.selectedPublishVariants).toEqual(["c64commander", "c64u-remote"]);
    delete process.env.APP_PUBLISH_VARIANTS;
  });

  it("falls back to repo.default_variant when variantId is an empty string", async () => {
    const repoRoot = createTempDir("variant-env-");
    writeRepoFixtures(repoRoot);
    const variantsPath = path.join(repoRoot, "variants/variants.yaml");
    writeFile(variantsPath, buildVariantsYaml());
    const runtimeTsPath = path.join(repoRoot, "src/generated/variant.ts");
    const runtimeJsonPath = path.join(repoRoot, "src/generated/variant.json");

    const result = await compileVariantTyped({
      variantsPath,
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      runtimeTsPath,
      runtimeJsonPath,
      variantId: "   ",
    });

    expect(result.selection.selectedVariantId).toBe("c64commander");
    expect(readFileSync(runtimeJsonPath, "utf8")).toContain('"selectedVariantId": "c64commander"');
  });

  it("emits prettier-stable runtime and server variant outputs", async () => {
    const repoRoot = createTempDir("variant-format-");
    writeRepoFixtures(repoRoot);
    const variantsPath = path.join(repoRoot, "variants/variants.yaml");
    writeFile(variantsPath, buildVariantsYaml());
    const runtimeTsPath = path.join(repoRoot, "src/generated/variant.ts");
    const runtimeJsonPath = path.join(repoRoot, "src/generated/variant.json");
    const webServerVariantTsPath = path.join(repoRoot, "web/server/src/variant.generated.ts");

    await compileVariantTyped({
      variantsPath,
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      runtimeTsPath,
      runtimeJsonPath,
      webServerVariantTsPath,
      variantId: "c64commander",
    });

    const runtimeTs = readFileSync(runtimeTsPath, "utf8");
    const runtimeJson = readFileSync(runtimeJsonPath, "utf8");
    const webServerVariantTs = readFileSync(webServerVariantTsPath, "utf8");

    await expect(prettier.format(runtimeTs, { filepath: runtimeTsPath })).resolves.toBe(runtimeTs);
    await expect(prettier.format(runtimeJson, { filepath: runtimeJsonPath })).resolves.toBe(runtimeJson);
    await expect(prettier.format(webServerVariantTs, { filepath: webServerVariantTsPath })).resolves.toBe(
      webServerVariantTs,
    );
  });
});
