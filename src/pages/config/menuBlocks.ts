/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MenuNode } from "@/lib/config/menuMapping";

/** Static fields the device disables while "Use DHCP" is on (Wired / Wi-Fi setup). */
export const DHCP_STATIC_FIELDS = new Set(["Static IP", "Static Netmask", "Static Gateway", "Static DNS"]);

export interface MenuLeafSpec {
  item: string;
  label: string;
  formatterId?: string;
  alias?: boolean;
}

/**
 * One renderable block of a menu page: a single REST category fetched once, with an
 * optional sub-section title. A page's multi-category nature comes from DIFFERENT
 * sections (each single-category), so every block fetches exactly one category — which
 * keeps the per-block hook usage stable (no hooks-in-a-loop) and the fetch lazy.
 */
export interface MenuBlockSpec {
  key: string;
  /** Sub-section header, or null for the page's top-level (intro) block. */
  title: string | null;
  /** REST category to fetch, or null for a menu-only (action/status) block. */
  category: string | null;
  leaves: MenuLeafSpec[];
  menuOnly: { label: string }[];
}

interface RawGroup {
  title: string | null;
  items: MenuNode[];
  menuOnly: MenuNode[];
}

/** Flatten a page node into ordered groups (intro + one per section, nesting prefixed). */
const collectGroups = (page: MenuNode): RawGroup[] => {
  const groups: RawGroup[] = [];
  let anon: RawGroup | null = null;

  const flushAnon = () => {
    if (anon && (anon.items.length || anon.menuOnly.length)) groups.push(anon);
    anon = null;
  };

  const addSection = (section: MenuNode, titlePrefix: string) => {
    const group: RawGroup = { title: titlePrefix, items: [], menuOnly: [] };
    const nested: MenuNode[] = [];
    for (const child of section.children ?? []) {
      if (child.kind === "section") nested.push(child);
      else if (child.kind === "item") group.items.push(child);
      else if (child.kind === "menuOnly") group.menuOnly.push(child);
    }
    if (group.items.length || group.menuOnly.length) groups.push(group);
    for (const child of nested) addSection(child, `${titlePrefix} / ${child.label}`);
  };

  for (const child of page.children ?? []) {
    if (child.kind === "section") {
      flushAnon();
      addSection(child, child.label);
      continue;
    }
    anon ??= { title: null, items: [], menuOnly: [] };
    if (child.kind === "item") anon.items.push(child);
    else if (child.kind === "menuOnly") anon.menuOnly.push(child);
  }
  flushAnon();
  return groups;
};

/**
 * Build the single-category render blocks for a menu page. Items in a group are split by
 * REST category (defensive — the captured data never mixes categories within a section),
 * and menu-only entries attach to the group's last block (or a category-less block).
 */
export const buildMenuBlocks = (page: MenuNode): MenuBlockSpec[] => {
  const blocks: MenuBlockSpec[] = [];
  const groups = collectGroups(page);

  groups.forEach((group, groupIndex) => {
    // Preserve item order while splitting by category.
    const byCategory: { category: string; leaves: MenuLeafSpec[] }[] = [];
    for (const node of group.items) {
      if (!node.rest) continue;
      let bucket = byCategory.find((entry) => entry.category === node.rest!.category);
      if (!bucket) {
        bucket = { category: node.rest.category, leaves: [] };
        byCategory.push(bucket);
      }
      bucket.leaves.push({
        item: node.rest.item,
        label: node.label,
        ...(node.formatterId ? { formatterId: node.formatterId } : {}),
        ...(node.alias ? { alias: true } : {}),
      });
    }

    const menuOnly = group.menuOnly.map((node) => ({ label: node.label }));

    if (byCategory.length === 0) {
      // A purely menu-only group (e.g. a Wi-Fi "Status" section).
      blocks.push({ key: `${groupIndex}-menuonly`, title: group.title, category: null, leaves: [], menuOnly });
      return;
    }

    byCategory.forEach((bucket, bucketIndex) => {
      blocks.push({
        key: `${groupIndex}-${bucketIndex}-${bucket.category}`,
        title: group.title,
        category: bucket.category,
        leaves: bucket.leaves,
        // Attach menu-only entries to the last block of the group.
        menuOnly: bucketIndex === byCategory.length - 1 ? menuOnly : [],
      });
    });
  });

  return blocks;
};
