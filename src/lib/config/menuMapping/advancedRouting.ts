/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Smart routing for items the menu hierarchy does not claim, so the "Advanced
 * (REST-only)" page dissolves into the most-aligned menu pages instead of being a
 * junk drawer.
 *
 * Three tiers, most-specific first — deliberately small and resilient, not a rule
 * engine:
 *  1. **Keyword rules** (per family, category-scoped) — for the one multi-owner
 *     category (`U64 Specific Settings`) whose items split by topic (HDMI → Video
 *     setup, user-port → Joystick, drive comms → Built-in drive A).
 *  2. **Sole-owner derivation** (data-driven from the hierarchy) — a category claimed
 *     by exactly one menu page sends its leftover items to that page. Covers 16 of 17
 *     C64U categories with zero hand-authoring and stays correct as the menu evolves.
 *  3. **Category defaults** (per family) — a home for categories no page claims
 *     (`SoftIEC Drive Settings`, `Tape Settings`, `Data Streams`).
 *
 * Anything that still resolves to `null` (an unknown/future category with no owner,
 * keyword, or default) falls through to the residual Advanced section — which is
 * hidden entirely when empty. This keeps the page lossless while making the junk
 * drawer disappear on every device we have a menu for.
 */

import type { MenuHierarchy, MenuNode } from "./types";

interface KeywordRule {
  category: string;
  pattern: RegExp;
  page: string;
}

interface FamilyRouting {
  /** Ordered, category-scoped keyword rules (checked first). */
  keywords: KeywordRule[];
  /** Home page for a whole category's leftovers (checked after sole-owner). */
  categoryDefaults: Record<string, string>;
}

// Per-family routing. Page strings MUST match menu page labels in the hierarchy
// (asserted by the routing drift test). Keep this small; prefer sole-owner routing.
const FAMILY_ROUTING: Record<string, FamilyRouting> = {
  C64U: {
    keywords: [
      // U64 Specific Settings is the only multi-owner category — split it by topic.
      {
        category: "U64 Specific Settings",
        pattern: /hdmi|tx swing|color clock|palette|scan|analog|digital|\bvideo\b/i,
        page: "Video setup",
      },
      { category: "U64 Specific Settings", pattern: /user ?port/i, page: "Joystick & controllers" },
      {
        category: "U64 Specific Settings",
        pattern: /serial bus|parallel cable|burst mode|speeddos|\bdrive\b/i,
        page: "Built-in drive A",
      },
    ],
    categoryDefaults: {
      // Leftover U64 Specific items (e.g. "C64U Model") with no topical keyword.
      "U64 Specific Settings": "Video setup",
      // No menu page claims these categories — give each a sensible storage/network home.
      "SoftIEC Drive Settings": "Built-in drive A",
      "Tape Settings": "Built-in drive A",
      "Data Streams": "Network services & timezone",
    },
  },
};

// Memoize the per-hierarchy sole-owner map (hierarchies are module-level singletons).
const ownerCache = new WeakMap<MenuHierarchy, Map<string, string>>();

/** category → the single menu page that claims it via non-alias leaves (sole owner). */
const deriveSoleOwners = (hierarchy: MenuHierarchy): Map<string, string> => {
  const cached = ownerCache.get(hierarchy);
  if (cached) return cached;

  const pagesByCategory = new Map<string, Set<string>>();
  const walk = (node: MenuNode, pageLabel: string) => {
    for (const child of node.children ?? []) {
      if (child.kind === "item" && child.rest && !child.alias) {
        const pages = pagesByCategory.get(child.rest.category) ?? new Set<string>();
        pages.add(pageLabel);
        pagesByCategory.set(child.rest.category, pages);
      }
      if (child.kind === "section") walk(child, pageLabel);
    }
  };
  for (const node of hierarchy.nodes) {
    if (node.kind === "group") {
      for (const page of node.children ?? []) walk(page, page.label);
    } else {
      walk(node, node.label);
    }
  }

  const owners = new Map<string, string>();
  for (const [category, pages] of pagesByCategory) {
    if (pages.size === 1) owners.set(category, [...pages][0]);
  }
  ownerCache.set(hierarchy, owners);
  return owners;
};

/**
 * Route one unclaimed REST item to its most-aligned menu page, or `null` if no page
 * is a sensible home (→ residual Advanced section). `family` selects the keyword/default
 * table; the sole-owner tier is derived from the hierarchy itself.
 */
export const routeAdvancedItem = (
  hierarchy: MenuHierarchy,
  family: string,
  category: string,
  item: string,
): string | null => {
  const routing = FAMILY_ROUTING[family];
  if (routing) {
    for (const rule of routing.keywords) {
      if (rule.category === category && rule.pattern.test(item)) return rule.page;
    }
  }
  const owner = deriveSoleOwners(hierarchy).get(category);
  if (owner) return owner;
  return routing?.categoryDefaults[category] ?? null;
};

/**
 * Categories whose leftover items can land on `pageLabel` (sole-owned, defaulted, or
 * keyword-routed to it). A page fetches these to render its "Advanced" sub-section.
 */
export const advancedCategoriesForPage = (hierarchy: MenuHierarchy, family: string, pageLabel: string): string[] => {
  const categories = new Set<string>();
  for (const [category, owner] of deriveSoleOwners(hierarchy)) {
    if (owner === pageLabel) categories.add(category);
  }
  const routing = FAMILY_ROUTING[family];
  if (routing) {
    for (const rule of routing.keywords) if (rule.page === pageLabel) categories.add(rule.category);
    for (const [category, page] of Object.entries(routing.categoryDefaults)) {
      if (page === pageLabel) categories.add(category);
    }
  }
  return [...categories];
};

/** True when `category`'s leftover items have a home page (so never hit the residual). */
const isRoutableCategory = (hierarchy: MenuHierarchy, family: string, category: string): boolean => {
  if (deriveSoleOwners(hierarchy).has(category)) return true;
  return Boolean(FAMILY_ROUTING[family]?.categoryDefaults[category]);
};

/**
 * Live categories whose unclaimed items would route to `null` (no owner / default).
 * Their items populate the residual Advanced section; when this is empty the section is
 * hidden entirely. Computed from the category list alone — no per-item fetch.
 */
export const unroutedCategories = (hierarchy: MenuHierarchy, family: string, liveCategories: string[]): string[] =>
  liveCategories.filter((category) => !isRoutableCategory(hierarchy, family, category));
