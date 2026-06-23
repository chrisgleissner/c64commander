/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Pure projection: live REST config + (hierarchy?, overlay) → a renderable menu tree.
 *
 * Headline guarantee — LOSSLESS: every live `{category,item}` is emitted exactly once
 * (in a menu page OR the fallback), on every device. The projection is computed OVER
 * LIVE DATA and consults NO static category/item roster to decide whether to render —
 * only where/how to label. Two branches:
 *  - hierarchy present → menu pages (Layer B) + Advanced (REST-only) fallback for
 *    everything the hierarchy did not claim (live − claimed). Stale pointers (claimed
 *    but absent live) are dropped, never errored.
 *  - hierarchy null → the live REST-category grouping, with Layer A labels applied.
 *
 * REST identity is preserved verbatim on every leaf for control-type inference + write-back.
 */

import type { NormalizedConfigItem } from "@/lib/config/normalizeConfigItem";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { routeAdvancedItem } from "./advancedRouting";
import { humanizeRestName } from "./humanize";
import { lookupOverlay, restKey } from "./types";
import type { MenuHierarchy, MenuNode, RestPointer, TerminologyOverlay } from "./types";

// ---- Live config (normalized input) -----------------------------------------

export interface LiveItem {
  value: string | number;
  options?: string[];
  details?: NormalizedConfigItem["details"];
}

export interface LiveConfig {
  /** category → (item → value/options/details). */
  categories: Record<string, Record<string, LiveItem>>;
  /** Category render order (preserved for the REST-grouped layout). */
  categoryOrder: string[];
}

/** Build a LiveConfig from a parsed `*-config.yaml` fixture (`config.categories.*`). */
export const liveConfigFromFixture = (parsed: unknown): LiveConfig => {
  const categoriesRaw = (parsed as { config?: { categories?: Record<string, unknown> } })?.config?.categories ?? {};
  return liveConfigFromCategoryItems(
    Object.fromEntries(
      Object.entries(categoriesRaw).map(([category, body]) => {
        const items = ((body as { items?: Record<string, unknown> })?.items ?? {}) as Record<string, unknown>;
        return [category, items];
      }),
    ),
  );
};

/**
 * Build a LiveConfig from a `category → (item → rawItemConfig)` map (the page feeds
 * per-category REST payloads here). Each raw item is normalized via `normalizeConfigItem`.
 */
export const liveConfigFromCategoryItems = (raw: Record<string, Record<string, unknown>>): LiveConfig => {
  const categories: Record<string, Record<string, LiveItem>> = {};
  const categoryOrder: string[] = [];
  for (const [category, items] of Object.entries(raw)) {
    categoryOrder.push(category);
    const bucket: Record<string, LiveItem> = {};
    for (const [item, config] of Object.entries(items ?? {})) {
      if (item === "errors") continue;
      const { value, options, details } = normalizeConfigItem(config);
      bucket[item] = { value, options, details };
    }
    categories[category] = bucket;
  }
  return { categories, categoryOrder };
};

// ---- Projected (output) tree ------------------------------------------------

export interface ProjectedLeaf {
  type: "leaf";
  rest: RestPointer;
  label: string;
  formatterId?: string;
  alias?: boolean;
  value: string | number;
  options?: string[];
  details?: NormalizedConfigItem["details"];
}

export interface ProjectedMenuOnly {
  type: "menuOnly";
  label: string;
  path: string[];
}

export interface ProjectedSection {
  type: "section";
  title: string;
  path: string[];
  children: ProjectedNode[];
}

export type ProjectedNode = ProjectedLeaf | ProjectedMenuOnly | ProjectedSection;

export interface ProjectedPage {
  /** Menu page label (hierarchy mode) or REST category name (rest-grouped mode). */
  title: string;
  /** Parent menu group, e.g. "Audio setup" (hierarchy mode only). */
  groupLabel: string | null;
  path: string[];
  /** REST categories this page reads from (for multi-category lazy fetch). */
  restCategories: string[];
  children: ProjectedNode[];
  /** Unclaimed items smart-routed onto this page (rendered under an "Advanced" header). */
  advanced: ProjectedFallbackGroup[];
}

export interface ProjectedFallbackGroup {
  category: string;
  leaves: ProjectedLeaf[];
}

export interface ProjectionDrift {
  /** Live items not claimed by the hierarchy → routed to the fallback. */
  unmappedRestItems: RestPointer[];
  /** Hierarchy pointers with no matching live item → dropped from the tree. */
  staleMappingRefs: RestPointer[];
}

export interface ProjectionResult {
  mode: "hierarchy" | "rest-grouped";
  pages: ProjectedPage[];
  fallback: ProjectedFallbackGroup[];
  drift: ProjectionDrift;
  /** Deduped set of every REST identity the tree renders (mapped pages + fallback). */
  renderedRest: RestPointer[];
}

export interface ProjectionContext {
  hierarchy: MenuHierarchy | null;
  overlay: TerminologyOverlay;
  /** Device family — selects the advanced-routing keyword/default table. */
  family?: string;
}

const labelAndFormatter = (overlay: TerminologyOverlay, category: string, item: string) => {
  const entry = lookupOverlay(overlay, category, item);
  return { label: entry?.label ?? humanizeRestName(item), formatterId: entry?.formatterId };
};

const makeFallbackLeaf = (
  overlay: TerminologyOverlay,
  category: string,
  item: string,
  live: LiveItem,
): ProjectedLeaf => {
  const { label, formatterId } = labelAndFormatter(overlay, category, item);
  return {
    type: "leaf",
    rest: { category, item },
    label,
    ...(formatterId ? { formatterId } : {}),
    value: live.value,
    ...(live.options ? { options: live.options } : {}),
    ...(live.details ? { details: live.details } : {}),
  };
};

/**
 * Resolve one hierarchy `item` node against live data. Returns `null` (stale) when the
 * REST category/item is absent live — the node is then dropped, never errored.
 */
const projectItemNode = (node: MenuNode, live: LiveConfig): ProjectedLeaf | null => {
  const { category, item } = node.rest as RestPointer;
  const liveItem = live.categories[category]?.[item];
  if (!liveItem) return null;
  return {
    type: "leaf",
    rest: { category, item },
    label: node.label, // menu YAML label (same authority as the overlay)
    ...(node.formatterId ? { formatterId: node.formatterId } : {}),
    ...(node.alias ? { alias: true } : {}),
    value: liveItem.value,
    ...(liveItem.options ? { options: liveItem.options } : {}),
    ...(liveItem.details ? { details: liveItem.details } : {}),
  };
};

/** Recursively project a section/page child list; drops empty sections + stale leaves. */
const projectChildren = (
  nodes: MenuNode[] | undefined,
  live: LiveConfig,
  acc: { stale: RestPointer[]; claimedLive: RestPointer[] },
): ProjectedNode[] => {
  const out: ProjectedNode[] = [];
  for (const node of nodes ?? []) {
    if (node.kind === "section") {
      const children = projectChildren(node.children, live, acc);
      if (children.length) out.push({ type: "section", title: node.label, path: node.path, children });
      continue;
    }
    if (node.kind === "menuOnly") {
      out.push({ type: "menuOnly", label: node.label, path: node.path });
      continue;
    }
    if (node.kind === "item" && node.rest) {
      const leaf = projectItemNode(node, live);
      if (leaf) {
        out.push(leaf);
        acc.claimedLive.push({ ...node.rest });
      } else {
        acc.stale.push({ ...node.rest });
      }
    }
  }
  return out;
};

/** Collect the REST categories referenced by `item` descendants of a page node. */
const pageRestCategories = (node: MenuNode): string[] => {
  const set = new Set<string>();
  const walk = (n: MenuNode) => {
    if (n.kind === "item" && n.rest) set.add(n.rest.category);
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return Array.from(set);
};

const projectHierarchy = (
  hierarchy: MenuHierarchy,
  live: LiveConfig,
  overlay: TerminologyOverlay,
  family: string,
): ProjectionResult => {
  const acc = { stale: [] as RestPointer[], claimedLive: [] as RestPointer[] };
  const pages: ProjectedPage[] = [];
  const pageByLabel = new Map<string, ProjectedPage>();

  const emitPage = (node: MenuNode, groupLabel: string | null) => {
    const page: ProjectedPage = {
      title: node.label,
      groupLabel,
      path: node.path,
      restCategories: pageRestCategories(node),
      children: projectChildren(node.children, live, acc),
      advanced: [],
    };
    pages.push(page);
    pageByLabel.set(page.title, page);
  };

  for (const node of hierarchy.nodes) {
    if (node.kind === "group") {
      for (const child of node.children ?? []) emitPage(child, node.label);
    } else {
      emitPage(node, null);
    }
  }

  // Distribute everything live the hierarchy did NOT claim. Smart routing sends each
  // unclaimed item to its most-aligned page's "Advanced" sub-section; only the truly
  // homeless (no owner/keyword/default — i.e. unknown/future categories) land in the
  // residual fallback. Driven purely by live data — no allow-list.
  const claimedByCategory = hierarchy.claimedItemsByCategory;
  const advancedByPage = new Map<string, Map<string, ProjectedLeaf[]>>();
  const fallback: ProjectedFallbackGroup[] = [];
  const unmapped: RestPointer[] = [];
  for (const category of live.categoryOrder) {
    const claimed = new Set(claimedByCategory[category] ?? []);
    const residual: ProjectedLeaf[] = [];
    for (const [item, liveItem] of Object.entries(live.categories[category] ?? {})) {
      if (claimed.has(item)) continue;
      unmapped.push({ category, item });
      const leaf = makeFallbackLeaf(overlay, category, item, liveItem);
      const page = routeAdvancedItem(hierarchy, family, category, item);
      if (page && pageByLabel.has(page)) {
        const byCategory = advancedByPage.get(page) ?? new Map<string, ProjectedLeaf[]>();
        const leaves = byCategory.get(category) ?? [];
        leaves.push(leaf);
        byCategory.set(category, leaves);
        advancedByPage.set(page, byCategory);
      } else {
        residual.push(leaf);
      }
    }
    if (residual.length) fallback.push({ category, leaves: residual });
  }

  for (const [pageLabel, byCategory] of advancedByPage) {
    const page = pageByLabel.get(pageLabel);
    if (!page) continue;
    page.advanced = [...byCategory.entries()].map(([category, leaves]) => ({ category, leaves }));
  }

  const renderedRest = dedupeRest([...acc.claimedLive, ...unmapped]);

  return {
    mode: "hierarchy",
    pages,
    fallback,
    drift: { unmappedRestItems: unmapped, staleMappingRefs: acc.stale },
    renderedRest,
  };
};

const projectRestGrouped = (live: LiveConfig, overlay: TerminologyOverlay): ProjectionResult => {
  const pages: ProjectedPage[] = [];
  const renderedRest: RestPointer[] = [];
  for (const category of live.categoryOrder) {
    const leaves: ProjectedNode[] = [];
    for (const [item, liveItem] of Object.entries(live.categories[category] ?? {})) {
      leaves.push(makeFallbackLeaf(overlay, category, item, liveItem));
      renderedRest.push({ category, item });
    }
    pages.push({
      title: category,
      groupLabel: null,
      path: [category],
      restCategories: [category],
      children: leaves,
      advanced: [],
    });
  }
  return {
    mode: "rest-grouped",
    pages,
    fallback: [],
    drift: { unmappedRestItems: [], staleMappingRefs: [] },
    renderedRest: dedupeRest(renderedRest),
  };
};

/**
 * Project live REST config into a renderable menu tree. The single entry point for the
 * lossless guarantee — see the module doc-comment.
 */
export const projectConfigToMenu = (live: LiveConfig, ctx: ProjectionContext): ProjectionResult => {
  if (ctx.hierarchy) return projectHierarchy(ctx.hierarchy, live, ctx.overlay, ctx.family ?? ctx.hierarchy.family);
  return projectRestGrouped(live, ctx.overlay);
};

// ---- helpers ----------------------------------------------------------------

const dedupeRest = (pointers: RestPointer[]): RestPointer[] => {
  const seen = new Set<string>();
  const out: RestPointer[] = [];
  for (const pointer of pointers) {
    const key = restKey(pointer.category, pointer.item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pointer);
  }
  return out;
};

/** The set of REST identity keys the projection renders (for lossless assertions). */
export const renderedRestKeySet = (result: ProjectionResult): Set<string> =>
  new Set(result.renderedRest.map((pointer) => restKey(pointer.category, pointer.item)));

/** The set of REST identity keys present in a LiveConfig. */
export const liveRestKeySet = (live: LiveConfig): Set<string> => {
  const set = new Set<string>();
  for (const [category, items] of Object.entries(live.categories)) {
    for (const item of Object.keys(items)) set.add(restKey(category, item));
  }
  return set;
};
