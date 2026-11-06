/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ConfigPulseRevertDecision = "revert" | "external-write" | "not-applied" | "unknown";

/** Another client may share the device, so only a value that still reads as the probe's own is reverted. */
export const decideConfigPulseRevert = (values: {
  originalValue: number;
  tempValue: number;
  readBackValue: number | null;
  preRevertValue: number | null;
}): ConfigPulseRevertDecision => {
  const { originalValue, tempValue, readBackValue, preRevertValue } = values;
  if (preRevertValue === tempValue) return "revert";
  if (preRevertValue === null) return "unknown";
  if (preRevertValue === originalValue && readBackValue !== tempValue) return "not-applied";
  return "external-write";
};
