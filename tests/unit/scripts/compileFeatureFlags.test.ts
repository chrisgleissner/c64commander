import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CompileError,
  compileFeatureFlags,
  parseRegistrySource,
  renderRegistryModule,
  validateRegistry,
} from "../../../scripts/compile-feature-flags.mjs";

const tempDirs: string[] = [];

const createTempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const validRegistry = () => ({
  version: 1,
  groups: {
    experimental: {
      label: "Experimental Features",
      description: "Unstable or rollout-controlled capabilities.",
    },
  },
  features: [
    {
      id: "hvsc_enabled",
      enabled: true,
      visible_to_user: true,
      developer_only: false,
      group: "experimental",
      title: "HVSC downloads",
      description: "Show HVSC download and ingest controls on the Play page.",
    },
  ],
});

const writeYaml = (dir: string, source: string) => {
  const yamlPath = path.join(dir, "feature-flags.yaml");
  writeFileSync(yamlPath, source, "utf8");
  return yamlPath;
};

describe("compile-feature-flags", () => {
  describe("validateRegistry", () => {
    it("accepts a well-formed registry", () => {
      const registry = validateRegistry(validRegistry());
      expect(registry.features).toHaveLength(1);
      expect(registry.groups.experimental.label).toBe("Experimental Features");
      expect(registry.features[0]).toEqual({
        id: "hvsc_enabled",
        enabled: true,
        visible_to_user: true,
        developer_only: false,
        group: "experimental",
        title: "HVSC downloads",
        description: "Show HVSC download and ingest controls on the Play page.",
      });
    });

    it("rejects a non-mapping root", () => {
      expect(() => validateRegistry([])).toThrow(/root must be a YAML mapping/);
      expect(() => validateRegistry(null)).toThrow(/root must be a YAML mapping/);
    });

    it("rejects an unsupported version", () => {
      const raw = validRegistry();
      (raw as unknown as { version: number }).version = 2;
      expect(() => validateRegistry(raw)).toThrow(/version must be 1/);
    });

    it("rejects missing or malformed groups", () => {
      const raw = validRegistry();
      (raw as unknown as { groups: unknown }).groups = null;
      expect(() => validateRegistry(raw)).toThrow(/groups must be a mapping/);
    });

    it("rejects non-snake-case group keys", () => {
      const raw = validRegistry();
      (raw as unknown as { groups: Record<string, unknown> }).groups = {
        "Bad-Group": { label: "x", description: "y" },
      };
      (raw as unknown as { features: { group: string }[] }).features[0].group = "Bad-Group";
      expect(() => validateRegistry(raw)).toThrow(/must be snake_case/);
    });

    it("rejects a group missing label or description", () => {
      const raw = validRegistry();
      raw.groups.experimental = {
        label: "",
        description: "ok",
      } as (typeof raw.groups)["experimental"];
      expect(() => validateRegistry(raw)).toThrow(/label must be a non-empty string/);
    });

    it("rejects features that are not a sequence", () => {
      const raw = validRegistry();
      (raw as unknown as { features: unknown }).features = {};
      expect(() => validateRegistry(raw)).toThrow(/features must be a YAML sequence/);
    });

    it("rejects an empty features sequence", () => {
      const raw = validRegistry();
      raw.features = [];
      expect(() => validateRegistry(raw)).toThrow(/must contain at least one entry/);
    });

    it("rejects unknown feature fields", () => {
      const raw = validRegistry();
      (raw.features[0] as Record<string, unknown>).unexpected = true;
      expect(() => validateRegistry(raw)).toThrow(/unknown fields: unexpected/);
    });

    it("rejects non-snake-case feature ids", () => {
      const raw = validRegistry();
      raw.features[0].id = "HvscEnabled";
      expect(() => validateRegistry(raw)).toThrow(/must be snake_case/);
    });

    it("rejects duplicate feature ids", () => {
      const raw = validRegistry();
      raw.features.push({ ...raw.features[0] });
      expect(() => validateRegistry(raw)).toThrow(/duplicate feature id "hvsc_enabled"/);
    });

    it("rejects features whose group is undeclared", () => {
      const raw = validRegistry();
      raw.features[0].group = "unknown_group";
      expect(() => validateRegistry(raw)).toThrow(/references unknown group "unknown_group"/);
    });

    it("rejects non-boolean boolean fields", () => {
      const raw = validRegistry();
      (raw.features[0] as Record<string, unknown>).enabled = "yes";
      expect(() => validateRegistry(raw)).toThrow(/\.enabled must be a boolean/);
    });

    it("rejects developer_only: true combined with visible_to_user: true", () => {
      const raw = validRegistry();
      raw.features[0].developer_only = true;
      raw.features[0].visible_to_user = true;
      expect(() => validateRegistry(raw)).toThrow(/developer_only: true requires visible_to_user: false/);
    });

    it("rejects empty titles and descriptions", () => {
      const raw = validRegistry();
      raw.features[0].title = "";
      expect(() => validateRegistry(raw)).toThrow(/title must be a non-empty string/);
    });
  });

  describe("parseRegistrySource", () => {
    it("parses valid YAML", () => {
      const registry = parseRegistrySource(
        [
          "version: 1",
          "groups:",
          "  experimental:",
          "    label: Experimental Features",
          "    description: Unstable or rollout-controlled capabilities.",
          "features:",
          "  - id: hvsc_enabled",
          "    enabled: true",
          "    visible_to_user: true",
          "    developer_only: false",
          "    group: experimental",
          "    title: HVSC downloads",
          "    description: Show HVSC download and ingest controls on the Play page.",
          "",
        ].join("\n"),
      );
      expect(registry.features[0].id).toBe("hvsc_enabled");
    });

    it("reports YAML syntax errors with a helpful message", () => {
      expect(() => parseRegistrySource(":\n  bad: [")).toThrow(CompileError);
      expect(() => parseRegistrySource(":\n  bad: [")).toThrow(/failed to parse feature flags YAML/);
    });
  });

  describe("renderRegistryModule", () => {
    it("emits a TypeScript union of ids and definition entries", () => {
      const registry = validateRegistry(validRegistry());
      const output = renderRegistryModule(registry);
      expect(output).toContain("export const FEATURE_REGISTRY_VERSION = 1 as const;");
      expect(output).toContain('export type FeatureFlagId = "hvsc_enabled";');
      expect(output).toContain('id: "hvsc_enabled",');
      expect(output).toContain("readonly visible_to_user: boolean;");
      expect(output).toContain("readonly developer_only: boolean;");
      expect(output).toContain("AUTO-GENERATED FILE. Do not edit by hand.");
    });
  });

  describe("compileFeatureFlags", () => {
    it("writes a fresh file when the output is missing", () => {
      const dir = createTempDir("feature-flags-compile-");
      const yamlPath = writeYaml(
        dir,
        [
          "version: 1",
          "groups:",
          "  experimental:",
          "    label: Experimental Features",
          "    description: Unstable or rollout-controlled capabilities.",
          "features:",
          "  - id: hvsc_enabled",
          "    enabled: true",
          "    visible_to_user: true",
          "    developer_only: false",
          "    group: experimental",
          "    title: HVSC downloads",
          "    description: Show HVSC download and ingest controls on the Play page.",
          "",
        ].join("\n"),
      );
      const outputPath = path.join(dir, "out/featureFlagsRegistry.generated.ts");
      const result = compileFeatureFlags({ yamlPath, outputPath });
      expect(result.changed).toBe(true);
      expect(readFileSync(outputPath, "utf8")).toContain('id: "hvsc_enabled",');
    });

    it("is idempotent when the output already matches", () => {
      const dir = createTempDir("feature-flags-compile-");
      const yamlPath = writeYaml(
        dir,
        [
          "version: 1",
          "groups:",
          "  experimental:",
          "    label: Experimental Features",
          "    description: Unstable or rollout-controlled capabilities.",
          "features:",
          "  - id: hvsc_enabled",
          "    enabled: true",
          "    visible_to_user: true",
          "    developer_only: false",
          "    group: experimental",
          "    title: HVSC downloads",
          "    description: Show HVSC download and ingest controls on the Play page.",
          "",
        ].join("\n"),
      );
      const outputPath = path.join(dir, "featureFlagsRegistry.generated.ts");
      compileFeatureFlags({ yamlPath, outputPath });
      const second = compileFeatureFlags({ yamlPath, outputPath });
      expect(second.changed).toBe(false);
    });

    it("--check succeeds when the emitted file is current", () => {
      const dir = createTempDir("feature-flags-compile-");
      const yamlPath = writeYaml(
        dir,
        [
          "version: 1",
          "groups:",
          "  experimental:",
          "    label: Experimental Features",
          "    description: Unstable or rollout-controlled capabilities.",
          "features:",
          "  - id: hvsc_enabled",
          "    enabled: true",
          "    visible_to_user: true",
          "    developer_only: false",
          "    group: experimental",
          "    title: HVSC downloads",
          "    description: Show HVSC download and ingest controls on the Play page.",
          "",
        ].join("\n"),
      );
      const outputPath = path.join(dir, "featureFlagsRegistry.generated.ts");
      compileFeatureFlags({ yamlPath, outputPath });
      const checkResult = compileFeatureFlags({ yamlPath, outputPath, check: true });
      expect(checkResult.changed).toBe(false);
    });

    it("--check fails when the emitted file is stale", () => {
      const dir = createTempDir("feature-flags-compile-");
      const yamlPath = writeYaml(
        dir,
        [
          "version: 1",
          "groups:",
          "  experimental:",
          "    label: Experimental Features",
          "    description: Unstable or rollout-controlled capabilities.",
          "features:",
          "  - id: hvsc_enabled",
          "    enabled: true",
          "    visible_to_user: true",
          "    developer_only: false",
          "    group: experimental",
          "    title: HVSC downloads",
          "    description: Show HVSC download and ingest controls on the Play page.",
          "",
        ].join("\n"),
      );
      const outputPath = path.join(dir, "featureFlagsRegistry.generated.ts");
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, "// stale\n", "utf8");
      expect(() => compileFeatureFlags({ yamlPath, outputPath, check: true })).toThrow(/out of date/);
    });
  });
});
