import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VariantCompileError,
  buildVariantSelection,
  compileVariant,
  parseFeatureFlagOverlaySource,
  parseVariantSource,
  resolveVariantFeatureRegistry,
  validateVariantConfig,
} from "../../../scripts/generate-variant.mjs";
import { parseRegistrySource } from "../../../scripts/compile-feature-flags.mjs";

const REAL_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// A strictly-valid 1x1 transparent RGBA PNG (sharp/libpng read-safe).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64",
);

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
const writePng = (repoRoot: string, relativePath: string) => {
  mkdirSync(path.dirname(path.join(repoRoot, relativePath)), { recursive: true });
  writeFileSync(path.join(repoRoot, relativePath), TINY_PNG);
};

const ANDROID_ONLY_VARIANTS_YAML = [
  "schema_version: 1",
  "repo:",
  "  default_variant: c64commander",
  "  publish_defaults:",
  "    release:",
  "      - c64commander",
  "      - c64u-remote",
  "    ci:",
  "      - c64commander",
  "      - c64u-remote",
  "variants:",
  "  c64commander:",
  "    display_name: C64 Commander",
  "    app_id: c64commander",
  "    description: Configure and control your Commodore 64 Ultimate over your local network.",
  "    exported_file_basename: c64commander",
  "    platform:",
  "      android:",
  "        application_id: uk.gleissner.c64commander",
  "        custom_url_scheme: uk.gleissner.c64commander",
  "      ios:",
  "        bundle_id: uk.gleissner.c64commander",
  "      web:",
  "        short_name: C64 Commander",
  "        theme_color: '#6C7EB7'",
  "        background_color: '#6C7EB7'",
  "        login_title: C64 Commander Login",
  "        login_heading: C64 Commander",
  "    assets:",
  "      sources:",
  "        icon:",
  "          path: variants/assets/c64commander/icon.png",
  "          format: png",
  "        logo:",
  "          path: variants/assets/c64commander/logo.png",
  "          format: png",
  "        splash:",
  "          path: variants/assets/c64commander/splash.png",
  "          format: png",
  "    runtime:",
  "      endpoints:",
  "        device_host: c64u",
  "  c64u-remote:",
  "    display_name: C64U Remote",
  "    app_id: c64u-remote",
  "    description: Configure and control your Commodore 64 Ultimate over your local network.",
  "    exported_file_basename: c64u-remote",
  "    platform:",
  "      android:",
  "        application_id: uk.gleissner.c64uremote",
  "        custom_url_scheme: uk.gleissner.c64uremote",
  "    theme:",
  "      theme_color: '#2F6B8B'",
  "      background_color: '#2F6B8B'",
  "    assets:",
  "      sources:",
  "        icon:",
  "          path: variants/assets/c64u-remote/icon.png",
  "          format: png",
  "        logo:",
  "          path: variants/assets/c64u-remote/logo.png",
  "          format: png",
  "        splash:",
  "          path: variants/assets/c64u-remote/splash.png",
  "          format: png",
  "    runtime:",
  "      endpoints:",
  "        device_host: c64u",
  "",
].join("\n");

const writeAndroidOnlyFixtureRepo = (repoRoot: string) => {
  writePng(repoRoot, "variants/assets/c64commander/icon.png");
  writePng(repoRoot, "variants/assets/c64commander/logo.png");
  writePng(repoRoot, "variants/assets/c64commander/splash.png");
  writePng(repoRoot, "variants/assets/c64u-remote/icon.png");
  writePng(repoRoot, "variants/assets/c64u-remote/logo.png");
  writePng(repoRoot, "variants/assets/c64u-remote/splash.png");
  writeFile(path.join(repoRoot, "variants/variants.yaml"), ANDROID_ONLY_VARIANTS_YAML);
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
      "",
    ].join("\n"),
  );
  writeFile(path.join(repoRoot, "variants/feature-flags/c64commander.yaml"), "overrides: {}\n");
  writeFile(
    path.join(repoRoot, "variants/feature-flags/c64u-remote.yaml"),
    ["overrides:", "  hvsc_enabled:", "    enabled: false", "    visible_to_user: false", ""].join("\n"),
  );
};

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Android-only variant schema", () => {
  it("accepts a variant that declares only platform.android plus a theme block", () => {
    const repoRoot = createTempDir("variant-android-only-");
    writeAndroidOnlyFixtureRepo(repoRoot);
    const config = parseVariantSource(ANDROID_ONLY_VARIANTS_YAML, { repoRoot }) as any;
    const remote = config.variants["c64u-remote"];
    expect(remote.platform.android.applicationId).toBe("uk.gleissner.c64uremote");
    expect(remote.platform.ios).toBeUndefined();
    expect(remote.platform.web).toBeUndefined();
    expect(remote.theme).toEqual({ themeColor: "#2F6B8B", backgroundColor: "#2F6B8B" });
  });

  it("rejects a variant that is missing the mandatory platform.android block", () => {
    const repoRoot = createTempDir("variant-android-only-");
    writeAndroidOnlyFixtureRepo(repoRoot);
    const raw = {
      schema_version: 1,
      repo: { default_variant: "c64commander", publish_defaults: { release: ["c64commander"], ci: ["c64commander"] } },
      variants: {
        c64commander: {
          display_name: "C64 Commander",
          app_id: "c64commander",
          description: "x",
          exported_file_basename: "c64commander",
          platform: {
            web: {
              short_name: "x",
              theme_color: "#000000",
              background_color: "#000000",
              login_title: "x",
              login_heading: "x",
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
      },
    };
    expect(() => validateVariantConfig(raw, { repoRoot })).toThrow(VariantCompileError);
    expect(() => validateVariantConfig(raw, { repoRoot })).toThrow(/platform\.android/);
  });

  it("rejects an Android-only variant that declares no theme and no platform.web", () => {
    const repoRoot = createTempDir("variant-android-only-");
    writeAndroidOnlyFixtureRepo(repoRoot);
    const raw = {
      schema_version: 1,
      repo: { default_variant: "c64u-remote", publish_defaults: { release: ["c64u-remote"], ci: ["c64u-remote"] } },
      variants: {
        "c64u-remote": {
          display_name: "C64U Remote",
          app_id: "c64u-remote",
          description: "x",
          exported_file_basename: "c64u-remote",
          platform: {
            android: { application_id: "uk.gleissner.c64uremote", custom_url_scheme: "uk.gleissner.c64uremote" },
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
      },
    };
    expect(() => validateVariantConfig(raw, { repoRoot })).toThrow(/theme block/);
  });

  it("compiles an Android-only variant without emitting any web or iOS artifacts", async () => {
    const repoRoot = createTempDir("variant-android-only-compile-");
    writeAndroidOnlyFixtureRepo(repoRoot);
    const result = await compileVariant({
      variantsPath: path.join(repoRoot, "variants/variants.yaml"),
      featureFlagsPath: path.join(repoRoot, "src/lib/config/feature-flags.yaml"),
      overlaysDir: path.join(repoRoot, "variants/feature-flags"),
      variantId: "c64u-remote",
    });
    expect(result.selection.selectedVariantId).toBe("c64u-remote");

    // Runtime config, the Vite entry, and Android resources ARE generated.
    expect(existsSync(path.join(repoRoot, "src/generated/variant.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "index.html"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "android/app/src/main/res/values/strings.xml"))).toBe(true);

    // Web + iOS artifacts are NOT generated for an Android-only variant.
    expect(existsSync(path.join(repoRoot, "public/manifest.webmanifest"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "public/sw.js"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "web/server/src/variant.generated.ts"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "ios/App/App/Config/Variant.generated.xcconfig"))).toBe(false);

    // The Android string resources carry the C64U Remote identity.
    const strings = readFileSync(path.join(repoRoot, "android/app/src/main/res/values/strings.xml"), "utf8");
    expect(strings).toContain('<string name="app_name">C64U Remote</string>');
    expect(strings).toContain('<string name="package_name">uk.gleissner.c64uremote</string>');
  });
});

describe("real variants.yaml — c64u-remote migration", () => {
  const config = parseVariantSource(readFileSync(path.join(REAL_REPO_ROOT, "variants/variants.yaml"), "utf8"), {
    repoRoot: REAL_REPO_ROOT,
  }) as any;

  it("keeps c64commander as the default variant", () => {
    expect(config.repo.defaultVariant).toBe("c64commander");
  });

  it("declares the c64u-remote variant with the exact required identity", () => {
    const remote = config.variants["c64u-remote"];
    expect(remote).toBeDefined();
    expect(remote.displayName).toBe("C64U Remote");
    expect(remote.appId).toBe("c64u-remote");
    expect(remote.exportedFileBasename).toBe("c64u-remote");
    expect(remote.platform.android.applicationId).toBe("uk.gleissner.c64uremote");
    expect(remote.platform.android.customUrlScheme).toBe("uk.gleissner.c64uremote");
  });

  it("makes c64u-remote Android-only (no iOS, no web)", () => {
    const remote = config.variants["c64u-remote"];
    expect(remote.platform.ios).toBeUndefined();
    expect(remote.platform.web).toBeUndefined();
    expect(remote.theme).toEqual({ themeColor: "#2F6B8B", backgroundColor: "#2F6B8B" });
  });

  it("does not declare internet-content endpoints for c64u-remote", () => {
    const remote = config.variants["c64u-remote"];
    expect(remote.runtime.endpoints).toEqual({ device_host: "c64u" });
  });

  it("publishes both c64commander and c64u-remote on release and ci", () => {
    expect(config.repo.publishDefaults.release).toEqual(["c64commander", "c64u-remote"]);
    expect(config.repo.publishDefaults.ci).toEqual(["c64commander", "c64u-remote"]);
  });

  it("retains no stale c64u-controller variant", () => {
    expect(config.variants["c64u-controller"]).toBeUndefined();
  });
});

describe("real c64u-remote feature-flag overlay", () => {
  const baseRegistry = parseRegistrySource(
    readFileSync(path.join(REAL_REPO_ROOT, "src/lib/config/feature-flags.yaml"), "utf8"),
  );
  const overlay = parseFeatureFlagOverlaySource(
    readFileSync(path.join(REAL_REPO_ROOT, "variants/feature-flags/c64u-remote.yaml"), "utf8"),
    { featureIds: new Set(baseRegistry.features.map((f: any) => f.id)), variantId: "c64u-remote" },
  );

  it("disables AND hides every feature flag for C64U Remote", () => {
    const resolved = resolveVariantFeatureRegistry(baseRegistry, overlay);
    for (const feature of resolved.features) {
      expect(feature.enabled, `${feature.id}.enabled`).toBe(false);
      expect(feature.visible_to_user, `${feature.id}.visible_to_user`).toBe(false);
    }
  });

  it("disables HVSC and CommoServe specifically", () => {
    const resolved = resolveVariantFeatureRegistry(baseRegistry, overlay) as any;
    const byId = Object.fromEntries(resolved.features.map((f: any) => [f.id, f]));
    expect(byId.hvsc_enabled.enabled).toBe(false);
    expect(byId.commoserve_enabled.enabled).toBe(false);
  });

  it("disables every experimental feature flag", () => {
    const resolved = resolveVariantFeatureRegistry(baseRegistry, overlay) as any;
    const experimental = resolved.features.filter((f: any) => f.group === "experimental");
    expect(experimental.length).toBeGreaterThan(0);
    for (const feature of experimental) {
      expect(feature.enabled, `${feature.id}.enabled`).toBe(false);
    }
  });

  it("baking the variant selection exposes the disabled+hidden flags", () => {
    const config = parseVariantSource(readFileSync(path.join(REAL_REPO_ROOT, "variants/variants.yaml"), "utf8"), {
      repoRoot: REAL_REPO_ROOT,
    });
    const selection = buildVariantSelection({
      config,
      variantId: "c64u-remote",
      baseRegistry,
      overlay,
      publishVariants: ["c64commander", "c64u-remote"],
    }) as any;
    expect(selection.variant.featureFlags.hvsc_enabled).toEqual({
      enabled: false,
      visible_to_user: false,
      developer_only: false,
    });
    expect(selection.variant.featureFlags.background_execution_enabled.enabled).toBe(false);
    expect(selection.variant.featureFlags.background_execution_enabled.visible_to_user).toBe(false);
  });
});
