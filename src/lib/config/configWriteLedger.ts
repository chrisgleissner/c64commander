/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { isLoopbackAddress, removeOtherLoopbackEntries } from "@/lib/storage/loopbackEntries";

/**
 * The last value this phone wrote to each config item, per device, since the revert baseline was captured.
 * Another client may share the device, so a revert puts back only what this phone changed.
 */
export type ConfigWritePayload = Record<string, Record<string, string | number>>;

const LEDGER_PREFIX = "c64u_config_writes:";
const REPLACED_PREFIX = "c64u_config_store_replaced:";

const ledgerKey = (baseUrl: string) => `${LEDGER_PREFIX}${baseUrl}`;
const replacedKey = (baseUrl: string) => `${REPLACED_PREFIX}${baseUrl}`;

export const loadConfigWriteLedger = (baseUrl: string): ConfigWritePayload => {
  try {
    const raw = localStorage.getItem(ledgerKey(baseUrl));
    return raw ? (JSON.parse(raw) as ConfigWritePayload) : {};
  } catch (error) {
    addLog("warn", "Config write ledger could not be read; revert will treat no setting as changed here", {
      baseUrl,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return {};
  }
};

export const recordConfigWrite = (baseUrl: string, category: string, item: string, value: string | number) => {
  const ledger = loadConfigWriteLedger(baseUrl);
  ledger[category] = { ...ledger[category], [item]: value };
  try {
    const key = ledgerKey(baseUrl);
    if (isLoopbackAddress(baseUrl)) removeOtherLoopbackEntries(LEDGER_PREFIX, key);
    localStorage.setItem(key, JSON.stringify(ledger));
  } catch (error) {
    addLog("warn", "Config write ledger could not be stored; revert will skip this setting", {
      baseUrl,
      category,
      item,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

/**
 * Load from flash and reset to default replace every item at once, so the ledger cannot list what changed.
 * A revert after either one puts back the whole baseline.
 */
export const markConfigStoreReplaced = (baseUrl: string) => {
  try {
    const key = replacedKey(baseUrl);
    if (isLoopbackAddress(baseUrl)) removeOtherLoopbackEntries(REPLACED_PREFIX, key);
    localStorage.setItem(key, "1");
  } catch (error) {
    addLog("warn", "Config store replacement could not be recorded; revert will put back only items written here", {
      baseUrl,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

export const wasConfigStoreReplaced = (baseUrl: string): boolean => {
  try {
    return localStorage.getItem(replacedKey(baseUrl)) === "1";
  } catch (error) {
    addLog("warn", "Config store replacement record could not be read; revert will put back only items written here", {
      baseUrl,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return false;
  }
};

export const clearConfigWriteLedger = (baseUrl: string) => {
  try {
    localStorage.removeItem(ledgerKey(baseUrl));
    localStorage.removeItem(replacedKey(baseUrl));
  } catch (error) {
    addLog("warn", "Config write ledger could not be cleared", {
      baseUrl,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

const sameValue = (left: string | number | undefined, right: string | number | undefined) =>
  left !== undefined && right !== undefined && String(left) === String(right);

/**
 * The baseline values to write back: only items this phone wrote that still hold the value it wrote. An item
 * another client has set since, or one that could not be read now, is left as it is.
 */
export const buildOwnRevertPayload = (
  baseline: ConfigWritePayload,
  current: ConfigWritePayload,
  ledger: ConfigWritePayload,
): ConfigWritePayload => {
  const payload: ConfigWritePayload = {};
  for (const [category, written] of Object.entries(ledger)) {
    for (const [item, writtenValue] of Object.entries(written)) {
      const baselineValue = baseline[category]?.[item];
      const currentValue = current[category]?.[item];
      if (baselineValue === undefined || sameValue(currentValue, baselineValue)) continue;
      if (!sameValue(currentValue, writtenValue)) continue;
      payload[category] = { ...payload[category], [item]: baselineValue };
    }
  }
  return payload;
};
