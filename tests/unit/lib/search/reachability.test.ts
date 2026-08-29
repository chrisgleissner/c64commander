/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { STATIC_SEARCH_ENTRIES } from "@/generated/searchIndex";
import { variant } from "@/generated/variant";
import { resolveSearchHandler } from "@/lib/search/handlers";
import { configCategorySectionId } from "@/lib/search/configDeepLink";
import { TAB_ROUTES, tabIndexForPath } from "@/lib/navigation/tabRoutes";
import type { SearchEntry } from "@/lib/search/types";

/**
 * The walk of spec.md section 5.13, for the kinds that can be proven without rendering a page:
 * `route`, `action` and `configItem`. `section` and `control` need a live page and are walked in
 * playwright/searchReachability.spec.ts against the mock device.
 *
 * This is what stops the index rotting: a route removed, a handler renamed or a config item that no
 * device reports fails here rather than as a search result that does nothing.
 */

/** Routes the router serves that are not in TAB_ROUTES. Sub-routes render inside their tab's slot. */
const SUB_ROUTES = new Set(["/settings/open-source-licenses"]);

/**
 * Entries excluded because the build variant under test does not build them. It is asserted empty,
 * so an entry cannot be quietly parked here — removing it from the index is the honest fix.
 */
const VARIANT_EXCLUSIONS: Readonly<Record<string, readonly string[]>> = {};

const excludedForThisVariant = new Set(VARIANT_EXCLUSIONS[variant.id] ?? []);

const entriesOfKind = <K extends SearchEntry["target"]["kind"]>(kind: K) =>
  STATIC_SEARCH_ENTRIES.filter((entry) => entry.target.kind === kind && !excludedForThisVariant.has(entry.id));

const recordedConfig = yaml.load(readFileSync(path.resolve(process.cwd(), "docs/c64/c64u-config.yaml"), "utf8")) as {
  config: { categories: Record<string, { items: Record<string, unknown> }> };
};

describe("search index reachability", () => {
  it("excludes nothing for the variant under test", () => {
    expect([...excludedForThisVariant]).toEqual([]);
  });

  it("has a unique id for every entry", () => {
    const ids = STATIC_SEARCH_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("route targets", () => {
    const routes = entriesOfKind("route");

    it("has route entries to walk", () => {
      expect(routes.length).toBeGreaterThan(0);
    });

    it.each(routes.map((entry) => [entry.id, entry] as const))(
      "%s names a path the router serves, not the 404",
      (_id, entry) => {
        if (entry.target.kind !== "route") throw new Error("filtered by kind");
        const { path: routePath } = entry.target;
        const isTabRoute = TAB_ROUTES.some((route) => route.path === routePath);
        expect(isTabRoute || SUB_ROUTES.has(routePath)).toBe(true);
        // NotFoundForUnknownPaths renders NotFound for anything tabIndexForPath does not claim.
        expect(tabIndexForPath(routePath)).toBeGreaterThanOrEqual(0);
      },
    );
  });

  describe("action targets", () => {
    const actions = entriesOfKind("action");

    it("has action entries to walk", () => {
      expect(actions.length).toBeGreaterThan(0);
    });

    it.each(actions.map((entry) => [entry.id, entry] as const))("%s names a handler the map resolves", (_id, entry) => {
      if (entry.target.kind !== "action") throw new Error("filtered by kind");
      expect(resolveSearchHandler(entry.target.handlerId)).toBeTypeOf("function");
    });
  });

  describe("configItem targets", () => {
    const items = entriesOfKind("configItem");

    it("has configItem entries to walk", () => {
      expect(items.length).toBeGreaterThan(0);
    });

    it.each(items.map((entry) => [entry.id, entry] as const))(
      "%s names a category and item the recorded device config has",
      (_id, entry) => {
        if (entry.target.kind !== "configItem") throw new Error("filtered by kind");
        const category = recordedConfig.config.categories[entry.target.category];
        expect(category, `category ${entry.target.category} is not in the recorded config`).toBeDefined();
        expect(Object.keys(category.items)).toContain(entry.target.itemName);
      },
    );

    /*
     * That the Config page and the deep-link resolver agree is now held by construction: both call
     * configCategorySectionId, including the menu-page branch, which used to slug its label
     * separately. What is left worth asserting is that the id a category produces is one an HTML
     * id and a CSS selector can carry — the resolver looks the section up by it.
     */
    it.each(items.map((entry) => [entry.id, entry] as const))(
      "%s resolves its category to a usable section id",
      (_id, entry) => {
        if (entry.target.kind !== "configItem") throw new Error("filtered by kind");
        const sectionId = configCategorySectionId(entry.target.category);
        expect(sectionId).not.toBe("");
        expect(sectionId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      },
    );
  });

  describe("section and control targets", () => {
    it("only names paths the router serves", () => {
      for (const entry of STATIC_SEARCH_ENTRIES) {
        if (entry.target.kind !== "section" && entry.target.kind !== "control") continue;
        expect(tabIndexForPath(entry.target.path), `${entry.id} points at ${entry.target.path}`).toBeGreaterThanOrEqual(
          0,
        );
      }
    });
  });
});
