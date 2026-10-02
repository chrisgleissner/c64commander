/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { cloneBudgetValue } from "@/lib/c64api/requestRuntime";

const STRUCTURED_CONFIG_METADATA_KEYS = [
  "selected",
  "value",
  "current",
  "current_value",
  "currentValue",
  "default",
  "default_value",
  "defaultValue",
  "options",
  "values",
  "choices",
  "details",
  "presets",
  "min",
  "max",
  "minimum",
  "maximum",
  "format",
];

export const hasStructuredConfigMetadata = (config: unknown) => {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return false;
  const record = config as Record<string, unknown>;
  return STRUCTURED_CONFIG_METADATA_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key));
};

/** The requested items the item cache already knows, cloned so the cache cannot be mutated through them. */
export const seedConfigItemsFromCache = (items: readonly string[], cachedItems: Record<string, unknown>) => {
  const mergedItems: Record<string, unknown> = {};
  items.forEach((item) => {
    if (cachedItems[item] !== undefined) mergedItems[item] = cloneBudgetValue(cachedItems[item]);
  });
  return mergedItems;
};

/**
 * Merges a category listing's values for `items` into `mergedItems`, keeping cached option metadata
 * when the listing carries only the value. Returns the listed items that still have no metadata.
 */
export const mergeListedConfigItems = (
  items: readonly string[],
  itemsBlock: Record<string, unknown>,
  cachedItems: Record<string, unknown>,
  mergedItems: Record<string, unknown>,
) => {
  const itemsNeedingEnrichment = new Set<string>();
  items.forEach((item) => {
    if (!Object.prototype.hasOwnProperty.call(itemsBlock, item)) return;
    const itemConfig = itemsBlock[item];
    const cachedConfig = cachedItems[item];
    if (hasStructuredConfigMetadata(itemConfig)) {
      mergedItems[item] = itemConfig;
      return;
    }
    if (hasStructuredConfigMetadata(cachedConfig)) {
      mergedItems[item] = { ...(cachedConfig as Record<string, unknown>), selected: extractConfigValue(itemConfig) };
      return;
    }
    mergedItems[item] = itemConfig;
    itemsNeedingEnrichment.add(item);
  });
  return itemsNeedingEnrichment;
};
