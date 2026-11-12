/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** The firmware's default for one item, read from the per-item payload the app already fetches or caches. */
export const readConfigItemDefault = (config: unknown): string | number | undefined => {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return undefined;
  const record = config as Record<string, unknown>;
  const candidate = record.default;
  return typeof candidate === "string" || typeof candidate === "number" ? candidate : undefined;
};

/** True when a default is known and the item's value differs from it; numbers compare by value, text exactly. */
export const isModifiedFromDefault = (value: string | number, defaultValue: string | number | undefined): boolean => {
  if (defaultValue === undefined) return false;
  const current = String(value).trim();
  const expected = String(defaultValue).trim();
  if (PLAIN_NUMBER.test(current) && PLAIN_NUMBER.test(expected)) return Number(current) !== Number(expected);
  return current !== expected;
};

const CATEGORIES_WITHOUT_DEFAULT_STATE: ReadonlySet<string> = new Set(["Clock Settings"]);

const ITEMS_WITHOUT_DEFAULT_STATE: ReadonlySet<string> = new Set([
  "Host Name",
  "Unique ID",
  "Network Password",
  "Static IP",
  "Static Netmask",
  "Static Gateway",
  "Static DNS",
]);

/**
 * False for items whose default is not a setting the user would want back: the clock (the firmware reports a
 * factory date as the default of Year, Day, Hours and so on) and the items that identify the device or its
 * network, where resetting would rename the device, drop the password or move it off its address.
 */
export const hasMeaningfulDefault = (category: string, name: string): boolean =>
  !CATEGORIES_WITHOUT_DEFAULT_STATE.has(category) && !ITEMS_WITHOUT_DEFAULT_STATE.has(name);
