/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Extracts a scalar config value from a raw config response node.
 *
 * The C64U API returns config items in several shapes depending on the firmware
 * version and category type:
 *   - Plain primitive  → used as-is
 *   - { selected, options, details }  → selected is the current value
 *   - { value }        → value is the current value
 *   - { current }      → current is the current value
 *   - { current_value }
 *   - { currentValue }
 *   - { default }      → default is the current value (read-only items)
 *   - { default_value }
 *
 * Returns "" if nothing matches, matching the API's empty-string sentinel.
 */
export const extractConfigValue = (raw: unknown): string | number => {
  if (raw === null || raw === undefined) {
    return "";
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    // Plain primitive (string, number, boolean) or array — return as-is if scalar, else ""
    if (typeof raw === "string" || typeof raw === "number") {
      return raw;
    }
    return "";
  }

  const cfg = raw as Record<string, unknown>;
  const value =
    cfg.selected ??
    cfg.value ??
    cfg.current ??
    cfg.current_value ??
    cfg.currentValue ??
    cfg.default ??
    cfg.default_value ??
    "";

  return value as string | number;
};
