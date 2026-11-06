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

export const CONFIG_PULSE_OVERLAP_WATCH = { durationMs: 1500, intervalMs: 250 };

/**
 * A second app whose probe starts inside this one's pulse reads the pulse value as its original and writes it back
 * when it reverts, after this probe's own revert decision. Watching briefly for the pulse value to return lets this
 * probe undo that; otherwise the device keeps the pulse value.
 */
export const watchForReturnedPulseValue = async (
  tempValue: number,
  readValue: () => Promise<number | null>,
  wait: (ms: number) => Promise<void>,
  watch = CONFIG_PULSE_OVERLAP_WATCH,
): Promise<boolean> => {
  const deadline = Date.now() + watch.durationMs;
  while (Date.now() < deadline) {
    await wait(watch.intervalMs);
    if ((await readValue()) === tempValue) return true;
  }
  return false;
};
