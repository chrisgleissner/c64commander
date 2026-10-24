/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MenuHierarchy, MenuNode } from "@/lib/config/menuMapping";
import type { MenuPageEntry } from "@/lib/config/menuMapping/searchMenuPages";

export const flattenMenuPages = (hierarchy: MenuHierarchy): MenuPageEntry[] => {
  const entries: MenuPageEntry[] = [];
  for (const node of hierarchy.nodes) {
    if (node.kind === "group") {
      for (const child of node.children ?? []) entries.push({ page: child, groupLabel: node.label });
    } else {
      entries.push({ page: node, groupLabel: null });
    }
  }
  return entries;
};

/** Whether a menu page edits a REST item (or, without `item`, any item of the category). */
export const pageReadsRest = (node: MenuNode, category: string, item?: string): boolean =>
  (node.kind === "item" && node.rest?.category === category && (item === undefined || node.rest.item === item)) ||
  (node.children ?? []).some((child) => pageReadsRest(child, category, item));

// The single REST category a page reads from when it is a flat, single-category page
// (used to delegate the Audio Mixer page to the specialized CategorySection).
export const soleRestCategory = (page: MenuNode): string | null => {
  const categories = new Set<string>();
  const walk = (node: MenuNode) => {
    if (node.kind === "item" && node.rest) categories.add(node.rest.category);
    for (const child of node.children ?? []) walk(child);
  };
  walk(page);
  return categories.size === 1 ? [...categories][0] : null;
};
