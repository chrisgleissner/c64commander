/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Display-only value formatters referenced by `formatterId` from the menu mapping.
 *
 * These transform how an option/value is SHOWN; they MUST NOT alter the value sent
 * back to REST (option identity is preserved for write-back). Existing helpers are
 * reused verbatim — only the genuinely new CPU-speed `MHz` formatter is added here.
 */

import { formatDbValue, formatPanValue } from "@/lib/ui/sliderValueFormat";
import { formatAddressValue } from "@/lib/config/sidDetails";

/** Known formatter ids. Keep in sync with the association `formatter:` values. */
export type MenuFormatterId = "db" | "pan" | "address" | "cpuSpeedMhz";

const parseLeadingNumber = (value: string): number | null => {
  const match = String(value)
    .trim()
    .match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

/**
 * CPU-speed display: REST options are bare, space-padded digits (" 1", " 2", …)
 * but the device menu shows "1 MHz". Append the unit for display while the raw
 * padded value is preserved for write-back (see c64api CPU-Speed padding guard).
 */
export const formatCpuSpeedMhz = (value: string): string => {
  const numeric = parseLeadingNumber(value);
  if (numeric === null) return String(value).trim();
  return `${numeric} MHz`;
};

const FORMATTERS: Record<MenuFormatterId, (value: string) => string> = {
  db: formatDbValue,
  pan: formatPanValue,
  address: formatAddressValue,
  cpuSpeedMhz: formatCpuSpeedMhz,
};

/**
 * Resolve a formatter function by id, or `undefined` when no/unknown id is given.
 * Pass the result to `ConfigItemRow`'s `formatOptionLabel` prop.
 */
export const getMenuValueFormatter = (formatterId?: string): ((value: string) => string) | undefined => {
  if (!formatterId) return undefined;
  return FORMATTERS[formatterId as MenuFormatterId];
};

/** All known formatter ids (used by the compile-time drift checker). */
export const MENU_FORMATTER_IDS: readonly MenuFormatterId[] = ["db", "pan", "address", "cpuSpeedMhz"];
