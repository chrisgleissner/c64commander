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
