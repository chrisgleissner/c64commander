/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MenuNode } from "./types";

/** A settings page plus the parent menu group it belongs to (e.g. "Audio setup" › "Audio mixer"). */
export type MenuPageEntry = { page: MenuNode; groupLabel: string | null };

const includesQuery = (text: string | null | undefined, query: string) => (text ?? "").toLowerCase().includes(query);

const nodeMatchesQuery = (node: MenuNode, query: string): boolean => {
  if (includesQuery(node.label, query)) return true;
  if (node.rest && (includesQuery(node.rest.item, query) || includesQuery(node.rest.category, query))) return true;
  return (node.children ?? []).some((child) => nodeMatchesQuery(child, query));
};

/**
 * A page matches when its title, its group, or any setting on it matches, so a search for a setting
 * the page shows ("CPU speed", "Vol Master") finds the page that holds it.
 */
export const filterMenuPagesByQuery = (entries: MenuPageEntry[], rawQuery: string): MenuPageEntry[] => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => includesQuery(entry.groupLabel, query) || nodeMatchesQuery(entry.page, query));
};

export const filterCategoriesByQuery = (categories: string[], rawQuery: string): string[] => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return categories;
  return categories.filter((category) => includesQuery(category, query));
};
