/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { ConfigWriteValidationError } from "@/lib/config/configWriteErrors";

export const getConfigCategoryItems = (payload: unknown, category: string): Record<string, unknown> => {
  const record = payload as Record<string, unknown> | undefined;
  const categoryBlock = (record?.[category] ?? record) as Record<string, unknown> | undefined;
  const itemsBlock = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
  if (!itemsBlock || typeof itemsBlock !== "object") {
    return {};
  }
  return itemsBlock;
};

const parseFiniteNumber = (value: string | number) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const validateConfigWrite = (params: {
  category: string;
  item: string;
  value: string | number;
  categoryPayload: unknown;
}) => {
  const { category, item, value, categoryPayload } = params;
  const items = getConfigCategoryItems(categoryPayload, category);
  const itemConfig = items[item];
  if (itemConfig === undefined) {
    throw new ConfigWriteValidationError(
      "CONFIG_ITEM_NOT_FOUND",
      `Cannot validate ${category}/${item}: config item is missing from the live category spec`,
      { category, item, value },
    );
  }

  const normalized = normalizeConfigItem(itemConfig);
  const options = normalized.options;
  if (Array.isArray(options) && options.length > 0) {
    if (typeof value !== "string" || !options.includes(value)) {
      throw new ConfigWriteValidationError(
        "INVALID_ENUM_VALUE",
        `Invalid value for ${category}/${item}: ${JSON.stringify(value)} is not one of the declared options`,
        { category, item, value, options },
      );
    }
    return;
  }

  const min = normalized.details?.min;
  const max = normalized.details?.max;
  if (min === undefined && max === undefined) {
    return;
  }

  const numericValue = parseFiniteNumber(value);
  if (numericValue === null) {
    throw new ConfigWriteValidationError(
      "INVALID_NUMERIC_VALUE",
      `Invalid numeric value for ${category}/${item}: ${JSON.stringify(value)}`,
      { category, item, value, min, max },
    );
  }

  if ((min !== undefined && numericValue < min) || (max !== undefined && numericValue > max)) {
    throw new ConfigWriteValidationError(
      "OUT_OF_RANGE",
      `Out-of-range value for ${category}/${item}: ${numericValue} is outside ${min ?? "-inf"}..${max ?? "+inf"}`,
      { category, item, value, min, max },
    );
  }
};

export const validateConfigBatchWrite = (params: {
  category: string;
  updates: Record<string, string | number>;
  categoryPayload: unknown;
}) => {
  const { category, updates, categoryPayload } = params;
  Object.entries(updates).forEach(([item, value]) => {
    validateConfigWrite({
      category,
      item,
      value,
      categoryPayload,
    });
  });
};
