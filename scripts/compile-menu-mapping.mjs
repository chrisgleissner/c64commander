/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Compile a captured device menu (labels + hierarchy + node kinds) PLUS its
 * REST-association sidecar into a committed, typed mapping module:
 *
 *   docs/c64/devices/<family>/<ver>/<family>-menu.yaml   (labels + hierarchy)
 *   src/lib/config/menuMapping/<family>-<ver>.association.yaml  (REST pointers)
 *        │  compile-menu-mapping.mjs  (validates vs <family>-config.yaml)
 *        ▼
 *   src/lib/config/menuMapping/<family>-<ver>.generated.ts  (HIERARCHY + OVERLAY)
 *
 * `--check` regenerates in-memory and fails (exit 1) if the committed file is stale
 * or if the association drifts from the menu/config samples. Wired into `npm run lint`.
 * Mirrors scripts/compile-feature-flags.mjs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

// The set of captured mappings to compile. Add a row when a new family/firmware menu
// is captured (see docs/research/menu-config-mapping/README.md).
const TARGETS = [
  {
    family: "C64U",
    firmwareVersion: "1.1.0",
    association: "src/lib/config/menuMapping/c64u-1.1.0.association.yaml",
    output: "src/lib/config/menuMapping/c64u-1.1.0.generated.ts",
    constPrefix: "C64U_1_1_0",
  },
];

const KNOWN_FORMATTER_IDS = new Set(["db", "pan", "address", "cpuSpeedMhz"]);
const NON_CONFIG_KINDS = new Set(["browser", "form", "info"]);

class CompileError extends Error {}

const rel = (abs) => abs.replace(`${REPO_ROOT}/`, "");
const readYaml = (relPath) => {
  const abs = resolve(REPO_ROOT, relPath);
  return { abs, data: yaml.load(readFileSync(abs, "utf8")) };
};
const pathKey = (segments) => JSON.stringify(segments);
// Collision-proof, tooling-safe key for a REST `{category, item}` pair. JSON.stringify
// escapes any embedded separator so distinct pairs never alias (mirrors `pathKey`).
const restKey = (category, item) => JSON.stringify([category, item]);

/** REST `{category: {item: rawItem}}` index from a *-config.yaml sample. */
const indexConfig = (configRoot) => {
  const categories = configRoot?.config?.categories ?? {};
  const index = {};
  for (const [category, body] of Object.entries(categories)) {
    index[category] = new Set(Object.keys(body?.items ?? {}));
  }
  return index;
};

/**
 * Walk a menu-YAML page's `items` tree, emitting MenuNode children. Section nodes
 * recurse; every other leaf is resolved against the association (mapped item, or
 * declared menu-only, else a hard error).
 */
const buildPageChildren = (items, parentPath, ctx) => {
  const children = [];
  for (const [label, rawObj] of Object.entries(items ?? {})) {
    const obj = rawObj ?? {};
    const nodePath = [...parentPath, label];
    if (obj.kind === "section" && obj.items && typeof obj.items === "object") {
      children.push({
        label,
        kind: "section",
        path: nodePath,
        children: buildPageChildren(obj.items, nodePath, ctx),
      });
      continue;
    }
    const key = pathKey(nodePath);
    const mapping = ctx.mappingByPath.get(key);
    if (mapping) {
      ctx.consumedMappingKeys.add(key);
      const node = {
        label,
        kind: "item",
        path: nodePath,
        rest: { category: mapping.category, item: mapping.item },
      };
      if (mapping.formatter) node.formatterId = mapping.formatter;
      if (mapping.alias) node.alias = true;
      children.push(node);
      ctx.itemNodes.push(node);
      continue;
    }
    if (ctx.menuOnlySet.has(key)) {
      ctx.consumedMenuOnlyKeys.add(key);
      children.push({ label, kind: "menuOnly", path: nodePath });
      continue;
    }
    throw new CompileError(
      `menu leaf ${key} has neither a mapping nor a menuOnly flag in the association ` +
        `(${ctx.associationRel}). Map it to a REST {category,item}, or list it under menuOnly.`,
    );
  }
  return children;
};

const compileTarget = (target) => {
  const { data: associationRaw, abs: assocAbs } = readYaml(target.association);
  const associationRel = rel(assocAbs);
  if (!associationRaw || typeof associationRaw !== "object") {
    throw new CompileError(`${associationRel}: not a mapping document.`);
  }
  if (associationRaw.family !== target.family || String(associationRaw.firmwareVersion) !== target.firmwareVersion) {
    throw new CompileError(
      `${associationRel}: family/firmwareVersion (${associationRaw.family}/${associationRaw.firmwareVersion}) ` +
        `do not match the compile target (${target.family}/${target.firmwareVersion}).`,
    );
  }
  const menuRel = associationRaw.sources?.menu;
  const configRel = associationRaw.sources?.config;
  if (!menuRel || !configRel) {
    throw new CompileError(`${associationRel}: sources.menu and sources.config are required.`);
  }
  const { data: menuRoot } = readYaml(menuRel);
  const { data: configRoot } = readYaml(configRel);
  const menu = menuRoot?.config;
  if (!menu?.menu_tree || !menu?.categories) {
    throw new CompileError(`${menuRel}: missing config.menu_tree / config.categories.`);
  }
  const configIndex = indexConfig(configRoot);

  const mappings = associationRaw.mappings ?? [];
  const menuOnly = associationRaw.menuOnly ?? [];
  const intentionallyUnmapped = associationRaw.intentionallyUnmapped ?? [];
  const nonConfigPages = new Set(associationRaw.nonConfigPages ?? []);

  // Index association rows by their menu path for the page walk.
  const mappingByPath = new Map();
  for (const m of mappings) {
    if (!Array.isArray(m.path) || !m.category || !m.item) {
      throw new CompileError(`${associationRel}: a mapping is missing path/category/item: ${JSON.stringify(m)}`);
    }
    if (m.formatter && !KNOWN_FORMATTER_IDS.has(m.formatter)) {
      throw new CompileError(`${associationRel}: unknown formatter "${m.formatter}" at ${pathKey(m.path)}.`);
    }
    const key = pathKey(m.path);
    if (mappingByPath.has(key)) throw new CompileError(`${associationRel}: duplicate mapping path ${key}.`);
    mappingByPath.set(key, m);
  }
  const menuOnlySet = new Set(menuOnly.map(pathKey));

  const ctx = {
    associationRel,
    mappingByPath,
    menuOnlySet,
    consumedMappingKeys: new Set(),
    consumedMenuOnlyKeys: new Set(),
    itemNodes: [],
  };

  // Walk the menu_tree to get top-level order + grouping, building page/group nodes.
  const buildPageNode = (categoryName) => {
    const page = menu.categories[categoryName];
    if (!page) throw new CompileError(`${menuRel}: menu_tree references unknown category "${categoryName}".`);
    const pagePath = Array.isArray(page.menu_path) ? page.menu_path : [categoryName];
    return {
      label: categoryName,
      kind: "page",
      path: pagePath,
      children: buildPageChildren(page.items ?? {}, pagePath, ctx),
    };
  };

  const nodes = [];
  for (const treeItem of menu.menu_tree.items ?? []) {
    if (Array.isArray(treeItem.children)) {
      const childPages = [];
      for (const child of treeItem.children) {
        if (nonConfigPages.has(child.category)) continue;
        childPages.push(buildPageNode(child.category));
      }
      if (childPages.length) {
        nodes.push({ label: treeItem.label, kind: "group", path: [treeItem.label], children: childPages });
      }
      continue;
    }
    const category = treeItem.category;
    if (nonConfigPages.has(category)) continue;
    const pageBody = menu.categories[category];
    if (pageBody && NON_CONFIG_KINDS.has(pageBody.kind)) continue; // browser/form/info, not REST config
    nodes.push(buildPageNode(category));
  }

  // ---- Validation -----------------------------------------------------------

  // Stale association rows (path the menu YAML never produced).
  for (const m of mappings) {
    const key = pathKey(m.path);
    if (!ctx.consumedMappingKeys.has(key)) {
      throw new CompileError(`${associationRel}: stale mapping path ${key} (not a leaf in ${menuRel}).`);
    }
  }
  for (const p of menuOnly) {
    const key = pathKey(p);
    if (!ctx.consumedMenuOnlyKeys.has(key)) {
      throw new CompileError(`${associationRel}: stale menuOnly path ${key} (not a leaf in ${menuRel}).`);
    }
  }

  // Every mapped REST pointer must exist in the config sample.
  for (const node of ctx.itemNodes) {
    const items = configIndex[node.rest.category];
    if (!items) {
      throw new CompileError(
        `${associationRel}: ${pathKey(node.path)} → category "${node.rest.category}" absent from ${configRel}.`,
      );
    }
    if (!items.has(node.rest.item)) {
      throw new CompileError(
        `${associationRel}: ${pathKey(node.path)} → item "${node.rest.category} / ${node.rest.item}" ` +
          `absent from ${configRel}.`,
      );
    }
  }

  // Overlay: primary (non-alias) leaves define the device-agnostic label; detect
  // conflicting primaries and aliases without a primary.
  const overlay = {};
  const primaryLabelByRest = new Map();
  for (const node of ctx.itemNodes) {
    if (node.alias) continue;
    const k = restKey(node.rest.category, node.rest.item);
    const existing = primaryLabelByRest.get(k);
    if (existing && existing !== node.label) {
      throw new CompileError(
        `${associationRel}: REST ${node.rest.category} / ${node.rest.item} has conflicting primary labels ` +
          `"${existing}" vs "${node.label}". Mark one as alias.`,
      );
    }
    primaryLabelByRest.set(k, node.label);
    (overlay[node.rest.category] ??= {})[node.rest.item] = node.formatterId
      ? { label: node.label, formatterId: node.formatterId }
      : { label: node.label };
  }
  for (const node of ctx.itemNodes) {
    if (!node.alias) continue;
    const k = restKey(node.rest.category, node.rest.item);
    if (!primaryLabelByRest.has(k)) {
      throw new CompileError(
        `${associationRel}: alias ${pathKey(node.path)} → ${node.rest.category} / ${node.rest.item} ` +
          `has no primary (non-alias) leaf.`,
      );
    }
  }

  // claimedItemsByCategory + restCategories (deduped, deterministic order).
  const claimedItemsByCategory = {};
  for (const node of ctx.itemNodes) {
    const list = (claimedItemsByCategory[node.rest.category] ??= []);
    if (!list.includes(node.rest.item)) list.push(node.rest.item);
  }
  const restCategories = Object.keys(claimedItemsByCategory).sort();

  // Drift checker (authoring completeness for THIS family only): every config-sample
  // item must be mapped OR declared intentionallyUnmapped. Never asserts a closed set.
  const intentionalSet = new Set(intentionallyUnmapped.map((e) => restKey(e.category, e.item)));
  const mappedSet = new Set(ctx.itemNodes.map((n) => restKey(n.rest.category, n.rest.item)));
  for (const e of intentionallyUnmapped) {
    const items = configIndex[e.category];
    if (!items || !items.has(e.item)) {
      throw new CompileError(
        `${associationRel}: intentionallyUnmapped ${e.category} / ${e.item} absent from ${configRel}.`,
      );
    }
    if (mappedSet.has(restKey(e.category, e.item))) {
      throw new CompileError(`${associationRel}: ${e.category} / ${e.item} is both mapped and intentionallyUnmapped.`);
    }
  }
  const unaccounted = [];
  for (const [category, items] of Object.entries(configIndex)) {
    if (nonConfigPages.has(category)) continue;
    for (const item of items) {
      const k = restKey(category, item);
      if (!mappedSet.has(k) && !intentionalSet.has(k)) unaccounted.push(`${category} / ${item}`);
    }
  }
  if (unaccounted.length) {
    throw new CompileError(
      `${associationRel}: ${unaccounted.length} config item(s) are neither mapped nor intentionallyUnmapped:\n` +
        unaccounted.map((s) => `  - ${s}`).join("\n") +
        `\nMap them to a menu path, or add to intentionallyUnmapped (advanced/REST-only).`,
    );
  }

  const hierarchy = {
    family: target.family,
    firmwareVersion: target.firmwareVersion,
    nodes,
    restCategories,
    claimedItemsByCategory,
  };

  return {
    hierarchy,
    overlay,
    counts: { mappings: mappings.length, menuOnly: menuOnly.length, items: ctx.itemNodes.length },
  };
};

const renderModule = (target, result) => {
  const banner = `/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: ${target.association} (+ its referenced menu/config YAMLs).
// Regenerate: npm run menu-mapping:compile  (validated by npm run menu-mapping:check).
`;
  const hierarchy = JSON.stringify(result.hierarchy, null, 2);
  const overlay = JSON.stringify(result.overlay, null, 2);
  return `${banner}
import type { MenuHierarchy, TerminologyOverlay } from "./types";

/** Layer B — the captured ${target.family} ${target.firmwareVersion} menu hierarchy. */
export const ${target.constPrefix}_HIERARCHY: MenuHierarchy = ${hierarchy};

/** Layer A — device-agnostic terminology overlay derived from the ${target.family} menu. */
export const ${target.constPrefix}_OVERLAY: TerminologyOverlay = ${overlay};
`;
};

export const compileMenuMapping = ({ check = false, targets = TARGETS } = {}) => {
  const summaries = [];
  for (const target of targets) {
    const result = compileTarget(target);
    const rendered = renderModule(target, result);
    const outAbs = resolve(REPO_ROOT, target.output);
    if (check) {
      let current = "";
      try {
        current = readFileSync(outAbs, "utf8");
      } catch {
        throw new CompileError(`${target.output} is missing. Run: npm run menu-mapping:compile`);
      }
      if (current !== rendered) {
        throw new CompileError(`${target.output} is stale. Run: npm run menu-mapping:compile`);
      }
    } else {
      writeFileSync(outAbs, rendered);
    }
    summaries.push({ target: `${target.family} ${target.firmwareVersion}`, ...result.counts });
  }
  return summaries;
};

const isDirectInvocation = () => {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
  const check = process.argv.includes("--check");
  try {
    const summaries = compileMenuMapping({ check });
    for (const s of summaries) {
      console.log(
        `menu-mapping ${check ? "check" : "compile"}: ${s.target} — ${s.items} items, ${s.menuOnly} menu-only.`,
      );
    }
    if (!check) console.log("menu-mapping: generated modules written.");
  } catch (error) {
    if (error instanceof CompileError) {
      console.error(`menu-mapping ${check ? "check" : "compile"} FAILED:\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

export { CompileError, TARGETS };
