/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { isSidVolumeName } from "@/lib/config/audioMixerSolo";

export type SidVolumeItem = {
  name: string;
  value: string | number;
  options?: string[];
};

export type SidEnablement = {
  socket1?: boolean;
  socket2?: boolean;
  ultiSid1?: boolean;
  ultiSid2?: boolean;
};

export type SidVolumeOption = {
  option: string;
  label: string;
  numeric: number | null;
  isOff: boolean;
};

const normalizeToken = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const isOffOption = (value: string) => {
  const normalized = normalizeToken(value);
  return normalized === "off" || normalized === "mute" || normalized === "muted";
};

export const isSidVolumeOffValue = (value: string | number | undefined) =>
  typeof value === "string" ? isOffOption(value) : false;

const isExplicitMutedVolumeOption = (value: string) => normalizeToken(value) === "-42 db";

const parseNumericOption = (option: string) => {
  const match = option.trim().match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const valuesEqual = (left: string | number | undefined, right: string | number | undefined) => {
  if (left === undefined || right === undefined) return false;
  if (typeof left === "number" || typeof right === "number") {
    return String(left).trim() === String(right).trim();
  }
  return normalizeToken(left) === normalizeToken(right);
};

const resolveEnabledValue = (value: string | number | undefined, disabledTokens: string[]) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return true;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeToken(trimmed);
  if (disabledTokens.includes(normalized)) return false;
  return true;
};

const getCategoryItemValue = (payload: Record<string, unknown> | undefined, categoryName: string, itemName: string) => {
  if (!payload) return undefined;
  const categoryData = (payload as Record<string, any>)[categoryName] ?? payload;
  const itemsData = (categoryData as Record<string, any>)?.items ?? categoryData;
  if (!itemsData || typeof itemsData !== "object") return undefined;
  const itemConfig = (itemsData as Record<string, any>)[itemName];
  if (itemConfig === undefined) return undefined;
  return normalizeConfigItem(itemConfig).value;
};

export const buildSidEnablement = (
  sidSocketsCategory?: Record<string, unknown>,
  sidAddressingCategory?: Record<string, unknown>,
): SidEnablement => {
  const socket1Value = getCategoryItemValue(sidSocketsCategory, "SID Sockets Configuration", "SID Socket 1");
  const socket2Value = getCategoryItemValue(sidSocketsCategory, "SID Sockets Configuration", "SID Socket 2");
  const ultiSid1Value = getCategoryItemValue(sidAddressingCategory, "SID Addressing", "UltiSID 1 Address");
  const ultiSid2Value = getCategoryItemValue(sidAddressingCategory, "SID Addressing", "UltiSID 2 Address");

  return {
    socket1: resolveEnabledValue(socket1Value, ["disabled", "off", "false"]),
    socket2: resolveEnabledValue(socket2Value, ["disabled", "off", "false"]),
    ultiSid1: resolveEnabledValue(ultiSid1Value, ["unmapped", "disabled", "off"]),
    ultiSid2: resolveEnabledValue(ultiSid2Value, ["unmapped", "disabled", "off"]),
  };
};

export const buildSidVolumeSteps = (options: string[]): SidVolumeOption[] => {
  if (!options.length) return [];
  const offOption = options.find((option) => isOffOption(option));
  const numericOptions = options
    .map((option) => ({
      option,
      label: option.trim(),
      numeric: parseNumericOption(option),
      isOff: isOffOption(option),
    }))
    .filter((entry): entry is SidVolumeOption => entry.numeric !== null && !entry.isOff)
    .sort((a, b) => (a.numeric ?? 0) - (b.numeric ?? 0));

  const steps: SidVolumeOption[] = [];
  if (offOption) {
    steps.push({
      option: offOption,
      label: offOption.trim(),
      numeric: null,
      isOff: true,
    });
  }
  steps.push(...numericOptions);
  return steps;
};

export const resolveSidMutedVolumeOption = (options?: string[]) => {
  const explicitMuted = options?.find((option) => isExplicitMutedVolumeOption(option));
  if (explicitMuted) return explicitMuted;
  return "-42 dB";
};

export const isSidEnabledForName = (name: string, enablement: SidEnablement) => {
  if (!isSidVolumeName(name)) return true;
  const match = normalizeToken(name).match(/^vol\s+(ultisid|socket)\s+([12])$/i);
  if (!match) return true;
  const type = match[1];
  const index = Number(match[2]);
  const key = type === "socket" ? (index === 1 ? "socket1" : "socket2") : index === 1 ? "ultiSid1" : "ultiSid2";
  const enabled = enablement[key];
  return enabled !== false;
};

export const filterEnabledSidVolumeItems = (items: SidVolumeItem[], enablement: SidEnablement) =>
  items.filter((item) => isSidEnabledForName(item.name, enablement));

export const buildEnabledSidVolumeSnapshot = (items: SidVolumeItem[], enablement: SidEnablement) => {
  const snapshot: Record<string, string | number> = {};
  filterEnabledSidVolumeItems(items, enablement).forEach((item) => {
    snapshot[item.name] = item.value;
  });
  return snapshot;
};

export const buildEnabledSidMuteUpdates = (items: SidVolumeItem[], enablement: SidEnablement) => {
  const updates: Record<string, string | number> = {};
  const muteTargetByName = new Map<string, string | number>();
  filterEnabledSidVolumeItems(items, enablement).forEach((item) => {
    const muteTarget = resolveSidMutedVolumeOption(item.options);
    muteTargetByName.set(item.name, muteTarget);
    if (isSidVolumeOffValue(item.value)) {
      return;
    }
    if (valuesEqual(item.value, muteTarget)) {
      return;
    }
    updates[item.name] = muteTarget;
  });
  return updates;
};

export const buildEnabledSidMutedToTargetUpdates = (
  items: SidVolumeItem[],
  enablement: SidEnablement,
  target: string,
) => {
  const updates: Record<string, string | number> = {};
  filterEnabledSidVolumeItems(items, enablement).forEach((item) => {
    const muteTarget = resolveSidMutedVolumeOption(item.options);
    if (!valuesEqual(item.value, muteTarget)) {
      return;
    }
    if (valuesEqual(item.value, target)) {
      return;
    }
    updates[item.name] = target;
  });
  return updates;
};

export const buildEnabledSidUnmuteUpdates = (
  snapshot: Record<string, string | number> | null | undefined,
  enablement: SidEnablement,
) => {
  if (!snapshot) return {};
  const updates: Record<string, string | number> = {};
  Object.entries(snapshot).forEach(([name, value]) => {
    if (!isSidEnabledForName(name, enablement)) return;
    updates[name] = value;
  });
  return updates;
};

export const buildEnabledSidRestoreUpdates = (
  items: SidVolumeItem[],
  enablement: SidEnablement,
  snapshot: Record<string, string | number> | null | undefined,
  fallbackTarget?: string | null,
) => {
  const snapshotUpdates = buildEnabledSidUnmuteUpdates(snapshot, enablement);
  if (Object.keys(snapshotUpdates).length) return snapshotUpdates;
  if (fallbackTarget) {
    return buildEnabledSidVolumeUpdates(items, enablement, fallbackTarget);
  }
  return {};
};

export const buildEnabledSidVolumeUpdates = (items: SidVolumeItem[], enablement: SidEnablement, target: string) => {
  const updates: Record<string, string | number> = {};
  filterEnabledSidVolumeItems(items, enablement).forEach((item) => {
    updates[item.name] = target;
  });
  return updates;
};
