/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { mergeAudioMixerOptions } from "@/lib/config/audioMixer";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";

export type AudioMixerItem = {
  name: string;
  value: string | number;
  options?: string[];
};

export const extractAudioMixerItems = (payload: Record<string, unknown> | undefined): AudioMixerItem[] => {
  if (!payload) return [];
  const categoryData = (payload as Record<string, any>)["Audio Mixer"] ?? payload;
  const itemsData = (categoryData as Record<string, any>)?.items ?? categoryData;
  if (!itemsData || typeof itemsData !== "object") return [];
  return Object.entries(itemsData)
    .filter(([key]) => key !== "errors")
    .map(([name, config]) => {
      const normalized = normalizeConfigItem(config);
      return {
        name,
        value: normalized.value,
        options: mergeAudioMixerOptions(normalized.options, normalized.details?.presets),
      };
    });
};
