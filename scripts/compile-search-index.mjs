#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Compile search/search-index.yaml into src/generated/searchIndex.ts — tier 0 of the app-wide
 * search index (docs/plans/discoverability/spec.md section 5.4).
 *
 * Generation runs in `prebuild` beside feature-flags:compile, and `--check` runs in `lint`. Both
 * are needed: `styles:check` alone would leave the hole that test:ci never calls lint, so a stale
 * generated index could pass the whole test suite.
 *
 *   node scripts/compile-search-index.mjs           # write the generated file
 *   node scripts/compile-search-index.mjs --check   # verify it is up to date
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import prettier from "prettier";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");
export const DEFAULT_SOURCE_PATH = join(REPO_ROOT, "search", "search-index.yaml");
export const DEFAULT_OUTPUT_PATH = join(REPO_ROOT, "src", "generated", "searchIndex.ts");

const ENTRY_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
const TRANSLATION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)+$/;
const HANDLER_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

const GROUPS = new Set(["action", "page", "setting", "config", "music", "disk", "docs"]);
const TARGET_KINDS = new Set(["route", "section", "control", "configItem", "action"]);
const REQUIREMENT_KINDS = new Set([
  "device",
  "capability",
  "productFamily",
  "telnet",
  "flag",
  "variant",
  "hvsc",
  "session",
]);

/** Field sets per target kind, so an extra or a missing key is a compile error, not a silent no-op. */
const TARGET_FIELDS = {
  route: ["path"],
  section: ["path", "scope", "id"],
  control: ["path", "scope", "sectionId", "testId"],
  configItem: ["category", "itemName"],
  action: ["handlerId"],
};

const REQUIREMENT_FIELDS = {
  device: [],
  capability: ["capability"],
  productFamily: ["families"],
  telnet: [],
  flag: ["flag"],
  variant: ["variant"],
  hvsc: [],
  session: [],
};

export class SearchIndexCompileError extends Error {
  constructor(message) {
    super(message);
    this.name = "SearchIndexCompileError";
  }
}

const fail = (message) => {
  throw new SearchIndexCompileError(message);
};

const requireMapping = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a mapping`);
  }
};

const requireNonEmptyString = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
};

const validateTarget = (target, label) => {
  requireMapping(target, label);
  if (!TARGET_KINDS.has(target.kind)) {
    fail(`${label}.kind must be one of ${[...TARGET_KINDS].join(", ")}, got ${JSON.stringify(target.kind)}`);
  }
  const expected = TARGET_FIELDS[target.kind];
  const actual = Object.keys(target).filter((key) => key !== "kind");
  const missing = expected.filter((key) => !actual.includes(key));
  const unknown = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0) fail(`${label} (kind ${target.kind}) is missing: ${missing.join(", ")}`);
  if (unknown.length > 0) fail(`${label} (kind ${target.kind}) has unknown field(s): ${unknown.join(", ")}`);
  for (const key of expected) requireNonEmptyString(target[key], `${label}.${key}`);
  if (target.kind === "route" || target.kind === "section" || target.kind === "control") {
    if (!target.path.startsWith("/")) fail(`${label}.path must start with "/", got ${JSON.stringify(target.path)}`);
  }
  if (target.kind === "action" && !HANDLER_ID_PATTERN.test(target.handlerId)) {
    fail(`${label}.handlerId must be lowerCamelCase, got ${JSON.stringify(target.handlerId)}`);
  }
};

const validateRequirement = (requirement, label) => {
  requireMapping(requirement, label);
  if (!REQUIREMENT_KINDS.has(requirement.kind)) {
    fail(`${label}.kind must be one of ${[...REQUIREMENT_KINDS].join(", ")}, got ${JSON.stringify(requirement.kind)}`);
  }
  const expected = REQUIREMENT_FIELDS[requirement.kind];
  const actual = Object.keys(requirement).filter((key) => key !== "kind");
  const missing = expected.filter((key) => !actual.includes(key));
  const unknown = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0) fail(`${label} (kind ${requirement.kind}) is missing: ${missing.join(", ")}`);
  if (unknown.length > 0) fail(`${label} (kind ${requirement.kind}) has unknown field(s): ${unknown.join(", ")}`);
  if (requirement.kind === "productFamily") {
    if (!Array.isArray(requirement.families) || requirement.families.length === 0) {
      fail(`${label}.families must be a non-empty array`);
    }
    for (const family of requirement.families) requireNonEmptyString(family, `${label}.families[]`);
  } else {
    for (const key of expected) requireNonEmptyString(requirement[key], `${label}.${key}`);
  }
};

export const validateEntry = (entry, index, seenIds) => {
  const label = `entries[${index}]`;
  requireMapping(entry, label);
  requireNonEmptyString(entry.id, `${label}.id`);
  if (!ENTRY_ID_PATTERN.test(entry.id)) {
    fail(`${label}.id ${JSON.stringify(entry.id)} must be dotted lowercase, matching ${ENTRY_ID_PATTERN}`);
  }
  if (seenIds.has(entry.id)) fail(`duplicate entry id ${JSON.stringify(entry.id)}`);
  seenIds.add(entry.id);

  requireNonEmptyString(entry.title_key, `${label}.title_key`);
  if (!TRANSLATION_KEY_PATTERN.test(entry.title_key)) {
    fail(`${label}.title_key ${JSON.stringify(entry.title_key)} must be a dotted translation key`);
  }
  requireNonEmptyString(entry.title, `${label}.title`);

  // A subtitle needs its own key: storing a bare English string would make it untranslatable
  // while the title beside it is not, which is the split section 5.11 exists to avoid.
  if ((entry.subtitle === undefined) !== (entry.subtitle_key === undefined)) {
    fail(`${label}: subtitle and subtitle_key must be given together or not at all`);
  }
  if (entry.subtitle !== undefined) {
    requireNonEmptyString(entry.subtitle, `${label}.subtitle`);
    requireNonEmptyString(entry.subtitle_key, `${label}.subtitle_key`);
    if (!TRANSLATION_KEY_PATTERN.test(entry.subtitle_key)) {
      fail(`${label}.subtitle_key ${JSON.stringify(entry.subtitle_key)} must be a dotted translation key`);
    }
  }

  if (entry.keywords !== undefined) {
    if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) {
      fail(`${label}.keywords must be a non-empty array when present`);
    }
    for (const keyword of entry.keywords) requireNonEmptyString(keyword, `${label}.keywords[]`);
    const lowered = entry.keywords.map((keyword) => keyword.toLowerCase());
    if (new Set(lowered).size !== lowered.length) fail(`${label}.keywords has duplicates`);
  }

  if (!GROUPS.has(entry.group)) {
    fail(`${label}.group must be one of ${[...GROUPS].join(", ")}, got ${JSON.stringify(entry.group)}`);
  }
  if (entry.icon !== undefined) requireNonEmptyString(entry.icon, `${label}.icon`);

  validateTarget(entry.target, `${label}.target`);

  if (entry.requires !== undefined) {
    if (!Array.isArray(entry.requires) || entry.requires.length === 0) {
      fail(`${label}.requires must be a non-empty array when present`);
    }
    entry.requires.forEach((requirement, i) => validateRequirement(requirement, `${label}.requires[${i}]`));
  }

  const known = new Set([
    "id",
    "title_key",
    "title",
    "subtitle_key",
    "subtitle",
    "keywords",
    "group",
    "icon",
    "target",
    "requires",
  ]);
  const unknown = Object.keys(entry).filter((key) => !known.has(key));
  if (unknown.length > 0) fail(`${label} has unknown field(s): ${unknown.join(", ")}`);
};

export const loadIndex = ({ yamlPath = DEFAULT_SOURCE_PATH } = {}) => {
  const raw = readFileSync(yamlPath, "utf8");
  const config = yaml.load(raw);
  requireMapping(config, "search/search-index.yaml");
  if (config.version !== 1) {
    fail(`unsupported version: ${JSON.stringify(config.version)} (expected 1)`);
  }
  if (!Array.isArray(config.entries) || config.entries.length === 0) {
    fail("search/search-index.yaml declares no entries");
  }
  const seenIds = new Set();
  config.entries.forEach((entry, index) => validateEntry(entry, index, seenIds));
  return config;
};

const renderEntryLiteral = (entry) => {
  const lines = [
    `    id: ${JSON.stringify(entry.id)},`,
    `    titleKey: ${JSON.stringify(entry.title_key)},`,
    `    titleDefault: ${JSON.stringify(entry.title)},`,
  ];
  if (entry.subtitle !== undefined) {
    lines.push(`    subtitleKey: ${JSON.stringify(entry.subtitle_key)},`);
    lines.push(`    subtitleDefault: ${JSON.stringify(entry.subtitle)},`);
  }
  if (entry.keywords !== undefined) {
    lines.push(`    keywords: ${JSON.stringify(entry.keywords)},`);
  }
  lines.push(`    group: ${JSON.stringify(entry.group)},`);
  if (entry.icon !== undefined) lines.push(`    iconId: ${JSON.stringify(entry.icon)},`);
  lines.push(`    target: ${JSON.stringify(entry.target)},`);
  if (entry.requires !== undefined) {
    lines.push(`    requires: ${JSON.stringify(entry.requires)},`);
  }
  return `  {\n${lines.join("\n")}\n  },`;
};

export const renderTs = (config) => {
  const entries = config.entries.map(renderEntryLiteral).join("\n");
  const handlerIds = [
    ...new Set(config.entries.filter((e) => e.target.kind === "action").map((e) => e.target.handlerId)),
  ].sort();

  return `/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * GENERATED by scripts/compile-search-index.mjs from search/search-index.yaml — do not edit by hand.
 *
 * Tier 0 of the app-wide search index. See docs/plans/discoverability/spec.md section 5 for the
 * entry contract, and section 5.13 for the reachability walk that keeps it from rotting.
 */

import type { SearchEntry } from "@/lib/search/types";

export const SEARCH_INDEX_VERSION = ${config.version} as const;

export const STATIC_SEARCH_ENTRIES: readonly SearchEntry[] = [
${entries}
];

/** Every distinct handler id an \`action\` entry names, for the handler-map contract test. */
export const REFERENCED_SEARCH_HANDLER_IDS: readonly string[] = ${JSON.stringify(handlerIds, null, 2)};
`;
};

const formatGenerated = async (rendered, outputPath) => {
  const config = (await prettier.resolveConfig(outputPath)) ?? {};
  return prettier.format(rendered, { ...config, filepath: outputPath });
};

export const compileSearchIndex = async ({
  yamlPath = DEFAULT_SOURCE_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  check = false,
} = {}) => {
  const config = loadIndex({ yamlPath });
  const rendered = await formatGenerated(renderTs(config), outputPath);

  let existing = null;
  try {
    existing = readFileSync(outputPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (check) {
    if (existing !== rendered) {
      fail(
        `generated file is out of date: ${relative(REPO_ROOT, outputPath)}\n` +
          `  run: node scripts/compile-search-index.mjs`,
      );
    }
    return { config, changed: false };
  }

  if (existing === rendered) return { config, changed: false };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered, "utf8");
  return { config, changed: true };
};

const isDirectInvocation = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
  const check = process.argv.includes("--check");
  try {
    const { config, changed } = await compileSearchIndex({ check });
    if (check) {
      console.log(`search index check: ${config.entries.length} entries up to date`);
    } else {
      console.log(
        `wrote ${relative(REPO_ROOT, DEFAULT_OUTPUT_PATH)} (${config.entries.length} entries)` +
          (changed ? "" : " (unchanged)"),
      );
    }
  } catch (error) {
    if (error instanceof SearchIndexCompileError) {
      console.error(`error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
