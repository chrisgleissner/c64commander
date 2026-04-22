#!/usr/bin/env node
/*
 * Compiles the authoritative feature flag registry from
 *   src/lib/config/feature-flags.yaml
 * into a generated TypeScript module consumed at runtime by
 *   src/lib/config/featureFlags.ts
 *
 * Validation (fail-fast, non-zero exit):
 *   - schema shape (version, groups, features)
 *   - field types
 *   - duplicate feature ids
 *   - snake_case ids
 *   - feature.group references an existing groups key
 *   - developer_only: true implies visible_to_user: false
 *
 * The generated TS is derived, not authoritative. It is committed so
 * lint/type-check and fresh clones work without running the build first.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const DEFAULT_YAML_PATH = path.join(REPO_ROOT, "src/lib/config/feature-flags.yaml");
export const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, "src/lib/config/featureFlagsRegistry.generated.ts");

const FEATURE_FIELDS = [
  "id",
  "enabled",
  "visible_to_user",
  "developer_only",
  "group",
  "title",
  "description",
];

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

class CompileError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeatureFlagCompileError";
  }
}

const fail = (message) => {
  throw new CompileError(message);
};

const requireBoolean = (value, label) => {
  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean, got ${typeof value}`);
  }
};

const requireNonEmptyString = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
};

export const validateRegistry = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("registry root must be a YAML mapping");
  }

  if (raw.version !== 1) {
    fail(`registry version must be 1, got ${JSON.stringify(raw.version)}`);
  }

  const groupsRaw = raw.groups;
  if (!groupsRaw || typeof groupsRaw !== "object" || Array.isArray(groupsRaw)) {
    fail("groups must be a mapping of group keys to metadata");
  }

  const groups = {};
  for (const [groupKey, groupValue] of Object.entries(groupsRaw)) {
    if (!ID_PATTERN.test(groupKey)) {
      fail(`group key "${groupKey}" must be snake_case`);
    }
    if (!groupValue || typeof groupValue !== "object" || Array.isArray(groupValue)) {
      fail(`group "${groupKey}" must be a mapping`);
    }
    requireNonEmptyString(groupValue.label, `group "${groupKey}" label`);
    requireNonEmptyString(groupValue.description, `group "${groupKey}" description`);
    groups[groupKey] = {
      key: groupKey,
      label: groupValue.label,
      description: groupValue.description,
    };
  }

  const featuresRaw = raw.features;
  if (!Array.isArray(featuresRaw)) {
    fail("features must be a YAML sequence");
  }
  if (featuresRaw.length === 0) {
    fail("features sequence must contain at least one entry");
  }

  const features = [];
  const seen = new Set();
  featuresRaw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`features[${index}] must be a mapping`);
    }

    const unknownKeys = Object.keys(entry).filter((key) => !FEATURE_FIELDS.includes(key));
    if (unknownKeys.length > 0) {
      fail(`features[${index}] contains unknown fields: ${unknownKeys.join(", ")}`);
    }

    const id = entry.id;
    requireNonEmptyString(id, `features[${index}].id`);
    if (!ID_PATTERN.test(id)) {
      fail(`feature id "${id}" must be snake_case`);
    }
    if (seen.has(id)) {
      fail(`duplicate feature id "${id}"`);
    }
    seen.add(id);

    requireBoolean(entry.enabled, `feature "${id}".enabled`);
    requireBoolean(entry.visible_to_user, `feature "${id}".visible_to_user`);
    requireBoolean(entry.developer_only, `feature "${id}".developer_only`);

    requireNonEmptyString(entry.group, `feature "${id}".group`);
    if (!Object.prototype.hasOwnProperty.call(groups, entry.group)) {
      fail(`feature "${id}" references unknown group "${entry.group}"`);
    }
    requireNonEmptyString(entry.title, `feature "${id}".title`);
    requireNonEmptyString(entry.description, `feature "${id}".description`);

    if (entry.developer_only && entry.visible_to_user) {
      fail(`feature "${id}" violates invariant: developer_only: true requires visible_to_user: false`);
    }

    features.push({
      id,
      enabled: entry.enabled,
      visible_to_user: entry.visible_to_user,
      developer_only: entry.developer_only,
      group: entry.group,
      title: entry.title,
      description: entry.description,
    });
  });

  return { version: raw.version, groups, features };
};

export const parseRegistrySource = (source) => {
  let raw;
  try {
    raw = yaml.load(source);
  } catch (error) {
    fail(`failed to parse feature flags YAML: ${error.message}`);
  }
  return validateRegistry(raw);
};

const LICENSE_HEADER = `/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
`;

const GENERATED_BANNER = `// AUTO-GENERATED FILE. Do not edit by hand.
// Source:   src/lib/config/feature-flags.yaml
// Compiler: scripts/compile-feature-flags.mjs
// Run \`node scripts/compile-feature-flags.mjs\` to regenerate.
`;

export const renderRegistryModule = (registry) => {
  const sortedGroupKeys = Object.keys(registry.groups);
  const renderStringLiteral = (value) => JSON.stringify(value);
  const renderObjectKey = (value) => (ID_PATTERN.test(value) ? value : renderStringLiteral(value));
  const idsUnion = registry.features.map((f) => renderStringLiteral(f.id)).join(" | ");

  const groupEntries = sortedGroupKeys
    .map((key) => {
      const g = registry.groups[key];
      return `  ${renderObjectKey(key)}: {
    key: ${renderStringLiteral(g.key)},
    label: ${renderStringLiteral(g.label)},
    description: ${renderStringLiteral(g.description)},
  },`;
    })
    .join("\n");

  const featureEntries = registry.features
    .map(
      (f) =>
        `  {
    id: ${renderStringLiteral(f.id)},
    enabled: ${f.enabled},
    visible_to_user: ${f.visible_to_user},
    developer_only: ${f.developer_only},
    group: ${renderStringLiteral(f.group)},
    title: ${renderStringLiteral(f.title)},
    description: ${renderStringLiteral(f.description)},
  },`,
    )
    .join("\n");

  return `${LICENSE_HEADER}
${GENERATED_BANNER}
export const FEATURE_REGISTRY_VERSION = ${registry.version} as const;

export type FeatureFlagId = ${idsUnion};

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
${groupEntries}
} as const satisfies Record<string, FeatureFlagGroupMetadata>;

export const FEATURE_FLAG_DEFINITIONS: readonly FeatureFlagDefinition[] = [
${featureEntries}
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
`;
};

export const compileFeatureFlags = ({
  yamlPath = DEFAULT_YAML_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  check = false,
} = {}) => {
  const source = fs.readFileSync(yamlPath, "utf8");
  const registry = parseRegistrySource(source);
  const rendered = renderRegistryModule(registry);

  if (check) {
    let existing = "";
    try {
      existing = fs.readFileSync(outputPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existing !== rendered) {
      fail(
        `generated file is out of date: ${path.relative(REPO_ROOT, outputPath)}\n` +
        `  run: node scripts/compile-feature-flags.mjs`,
      );
    }
    return { registry, changed: false };
  }

  let prior = "";
  try {
    prior = fs.readFileSync(outputPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (prior === rendered) {
    return { registry, changed: false };
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered, "utf8");
  return { registry, changed: true };
};

const isDirectInvocation = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  try {
    const { changed } = compileFeatureFlags({ check });
    if (check) {
      console.log("feature flags registry is up to date");
    } else if (changed) {
      console.log(`wrote ${path.relative(REPO_ROOT, DEFAULT_OUTPUT_PATH)}`);
    } else {
      console.log("feature flags registry already up to date");
    }
  } catch (error) {
    if (error instanceof CompileError) {
      console.error(`feature flag compile failed: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

export { CompileError };
