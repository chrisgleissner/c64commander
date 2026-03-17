/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { extractConfigValue } from "./configValueExtractor";

export type NormalizedConfigItem = {
  value: string | number;
  options?: string[];
  details?: {
    min?: number;
    max?: number;
    format?: string;
    presets?: string[];
  };
};

export const normalizeConfigItem = (config: unknown): NormalizedConfigItem => {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return { value: config as string | number };
  }

  const cfg = config as Record<string, unknown>;
  const selected = extractConfigValue(config);

  const optionsCandidate = cfg.options ?? cfg.values ?? cfg.choices;
  const details = cfg.details as Record<string, unknown> | undefined;
  const presetsCandidate = details?.presets ?? cfg.presets ?? cfg.values ?? cfg.choices;
  const options = Array.isArray(optionsCandidate) ? (optionsCandidate as string[]) : undefined;
  const presets = Array.isArray(presetsCandidate) ? (presetsCandidate as string[]) : undefined;

  const min = (details?.min ?? cfg.min ?? cfg.minimum) as number | undefined;
  const max = (details?.max ?? cfg.max ?? cfg.maximum) as number | undefined;
  const format = (details?.format ?? cfg.format) as string | undefined;

  const detailsOut =
    min !== undefined || max !== undefined || format || presets ? { min, max, format, presets } : undefined;

  return { value: selected, options, details: detailsOut };
};
