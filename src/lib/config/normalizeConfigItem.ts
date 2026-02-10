/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { value: config as string | number };
  }

  const cfg = config as Record<string, any>;
  const selected =
    cfg.selected ??
    cfg.value ??
    cfg.current ??
    cfg.current_value ??
    cfg.currentValue ??
    cfg.default ??
    cfg.default_value ??
    '';

  const optionsCandidate = cfg.options ?? cfg.values ?? cfg.choices;
  const presetsCandidate = cfg.details?.presets ?? cfg.presets ?? cfg.values ?? cfg.choices;
  const options = Array.isArray(optionsCandidate) ? optionsCandidate : undefined;
  const presets = Array.isArray(presetsCandidate) ? presetsCandidate : undefined;

  const min = cfg.details?.min ?? cfg.min ?? cfg.minimum;
  const max = cfg.details?.max ?? cfg.max ?? cfg.maximum;
  const format = cfg.details?.format ?? cfg.format;

  const details =
    min !== undefined || max !== undefined || format || presets
      ? { min, max, format, presets }
      : undefined;

  return { value: selected, options, details };
};
