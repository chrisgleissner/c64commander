/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { normalizeOptionToken } from "./uiLogic";

export const buildConfigKey = (category: string, itemName: string) => `${category}::${itemName}`;

export const readItemValue = (payload: unknown, categoryName: string, itemName: string) => {
  const record = payload as Record<string, unknown> | undefined;
  const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
  const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
  if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
  return normalizeConfigItem(items[itemName]).value;
};

export const readItemOptions = (payload: unknown, categoryName: string, itemName: string) => {
  const record = payload as Record<string, unknown> | undefined;
  const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
  const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
  if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return [];
  return normalizeConfigItem(items[itemName]).options ?? [];
};

export const readItemDetails = (payload: unknown, categoryName: string, itemName: string) => {
  const record = payload as Record<string, unknown> | undefined;
  const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
  const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
  if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
  return normalizeConfigItem(items[itemName]).details;
};

export const resolveConfigValue = (
  payload: unknown,
  category: string,
  itemName: string,
  fallback: string | number,
  configOverrides: Record<string, string | number | boolean>,
) => {
  const override = configOverrides[buildConfigKey(category, itemName)];
  if (override !== undefined) return override;
  const value = readItemValue(payload, category, itemName);
  return value === undefined ? fallback : value;
};

export const parseNumericValue = (value: string | number, fallback: number) => {
  const match = String(value)
    .trim()
    .match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const resolveTurboControlValue = (cpuSpeed: string, options: string[], currentValue?: string) => {
  const speed = parseNumericValue(cpuSpeed, 1);
  if (speed <= 1 && currentValue !== undefined) {
    const normalizedCurrent = normalizeOptionToken(currentValue);
    // At stock speed, "Manual" with CPU Speed 1 behaves exactly like "Off",
    // so keep the current mode and skip the redundant Turbo Control write.
    // Turbo Control writes have coincided with Ultimate network dropouts
    // (BUG-010), so every write we can avoid is a win.
    if (normalizedCurrent === "off" || normalizedCurrent === "manual") {
      return currentValue;
    }
  }
  const desired = speed <= 1 ? "Off" : "Manual";
  const match = options.find((option) => normalizeOptionToken(option) === normalizeOptionToken(desired));
  return match ?? options[0] ?? desired;
};

export const formatPrinterLabel = (itemName: string) => {
  if (itemName === "Page top margin (default is 5)") return "Margin";
  if (itemName === "Page height (default is 60)") return "Height";
  if (itemName === "Output file") return "Output";
  if (itemName === "Output type") return "Type";
  if (itemName === "Ink density") return "Ink";
  if (itemName === "Commodore charset") return "CBM charset";
  if (itemName === "Epson charset") return "Epson set";
  if (itemName === "IBM table 2") return "IBM set";
  return itemName;
};

export const formatPrinterOptionLabel = (value: string) => {
  const normalized = value.trim();
  if (normalized === "PNG B&W") return "PNG B/W";
  if (normalized === "PNG COLOR") return "PNG Color";
  if (normalized === "IBM Graphics Printer") return "IBM Graphics";
  if (normalized === "Commodore MPS") return "MPS";
  if (normalized === "Epson FX-80/JX-80") return "Epson FX";
  if (normalized === "IBM Proprinter") return "IBM Pro";
  if (normalized === "USA/UK") return "US/UK";
  if (normalized === "France/Italy") return "FR/IT";
  if (normalized === "Germany") return "DE";
  if (normalized === "Denmark") return "DK";
  if (normalized === "Denmark I") return "DK I";
  if (normalized === "Denmark II") return "DK II";
  if (normalized === "Spain") return "ES";
  if (normalized === "Sweden") return "SE";
  if (normalized === "Switzerland") return "CH";
  if (normalized === "France") return "FR";
  if (normalized === "Italy") return "IT";
  if (normalized === "Norway") return "NO";
  if (normalized === "Portugal") return "PT";
  if (normalized === "Greece") return "GR";
  if (normalized === "Israel") return "IL";
  if (normalized === "Japan") return "JP";
  if (normalized === "International 1") return "Intl 1";
  if (normalized === "International 2") return "Intl 2";
  return normalized;
};

/**
 * What a summary card prints when it has no value to print.
 *
 * Two different situations used to produce the same words. A card whose category the
 * device does not expose says "Not available", which is true. A card whose read is still
 * in flight also said "Not available", which is not: the value is coming. Measured on the
 * 0.9.6 walkthrough, eight cards on Home said it at once while the reads were outstanding,
 * and all eight filled in a few seconds later.
 *
 * `isItemSupported` cannot tell them apart on its own - `readItemValue(...) !== undefined`
 * is false either way - so the card has to be told whether its read has completed.
 */
export const CONFIG_UNAVAILABLE_LABEL = "Not available";

/** Shown while the read is outstanding. An ellipsis, not a word, so it reads as "waiting". */
export const CONFIG_PENDING_LABEL = "…";

/**
 * Pick the label for a value the card may or may not have yet.
 *
 * `disconnected` wins: with no device there is nothing to wait for. Otherwise an
 * outstanding read shows the pending label, and only a completed read that returned
 * nothing says the item is unavailable.
 */
export const resolveConfigDisplayValue = ({
  isActive,
  hasLoaded,
  value,
}: {
  isActive: boolean;
  hasLoaded: boolean;
  value: string;
}): string => {
  if (!isActive) return CONFIG_UNAVAILABLE_LABEL;
  if (!hasLoaded) return CONFIG_PENDING_LABEL;
  return value;
};
