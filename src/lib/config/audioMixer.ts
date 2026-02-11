/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ConfigResponse, getC64API } from '@/lib/c64api';
import { addLog } from '@/lib/logging';

const normalizeOption = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const parseNumeric = (option: string) => {
  const match = option.trim().match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

export const normalizeAudioMixerValue = (value: string | number | undefined) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  const normalized = normalizeOption(trimmed);
  if (normalized === 'center') return 'center';
  const numeric = parseNumeric(trimmed);
  return numeric ?? normalized;
};

export const isAudioMixerValueEqual = (
  left: string | number | undefined,
  right: string | number | undefined,
) => normalizeAudioMixerValue(left) === normalizeAudioMixerValue(right);

export const mergeAudioMixerOptions = (options?: string[], presets?: string[]) => {
  const merged = [...(options ?? []), ...(presets ?? [])].map((value) => String(value));
  const seen = new Set<string>();
  const result: string[] = [];
  merged.forEach((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(value);
  });
  return result;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const extractOptions = (response: ConfigResponse, category: string, item: string) => {
  const payload = response as Record<string, unknown>;
  const categoryBlock = payload[category] ?? payload;
  const categoryRecord = asRecord(categoryBlock);
  const itemBlock =
    (asRecord(categoryRecord?.items ?? categoryBlock) ?? {})[item] ??
    payload[item] ??
    payload['item'] ??
    payload['value'] ??
    payload;

  const itemRecord = asRecord(itemBlock);
  if (!itemRecord) return [] as string[];

  const optionsCandidate = itemRecord.options ?? itemRecord.values ?? itemRecord.choices ?? [];
  const detailsRecord = asRecord(itemRecord.details);
  const presetsCandidate = detailsRecord?.presets ?? itemRecord.presets ?? [];
  const optionsList = Array.isArray(optionsCandidate) ? optionsCandidate : [];
  const presetsList = Array.isArray(presetsCandidate) ? presetsCandidate : [];
  return mergeAudioMixerOptions(optionsList.map(String), presetsList.map(String));
};

export const resolveAudioMixerResetValue = async (
  category: string,
  itemName: string,
  itemOptions?: string[],
): Promise<string | number | undefined> => {
  let options = itemOptions ?? [];
  if (!options.length) {
    try {
      const api = getC64API();
      const response = await api.getConfigItem(category, itemName);
      options = extractOptions(response, category, itemName);
    } catch (error) {
      addLog('warn', 'Failed to fetch audio mixer options', {
        category,
        itemName,
        error,
      });
    }
  }

  if (itemName.startsWith('Vol ')) {
    const zeroOption = options.find((option) => {
      const normalized = normalizeOption(option);
      return normalized === '0 db' || normalized === '0db' || parseNumeric(option) === 0;
    });
    return zeroOption ?? 0;
  }

  if (itemName.startsWith('Pan ')) {
    const centerOption = options.find((option) => normalizeOption(option) === 'center');
    return centerOption ?? 'Center';
  }

  return undefined;
};
