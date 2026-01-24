import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import { isSidVolumeName, resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';

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

const normalizeToken = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const resolveEnabledValue = (value: string | number | undefined, disabledTokens: string[]) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return true;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeToken(trimmed);
  if (disabledTokens.includes(normalized)) return false;
  return true;
};

const getCategoryItemValue = (
  payload: Record<string, unknown> | undefined,
  categoryName: string,
  itemName: string,
) => {
  if (!payload) return undefined;
  const categoryData = (payload as Record<string, any>)[categoryName] ?? payload;
  const itemsData = (categoryData as Record<string, any>)?.items ?? categoryData;
  if (!itemsData || typeof itemsData !== 'object') return undefined;
  const itemConfig = (itemsData as Record<string, any>)[itemName];
  if (itemConfig === undefined) return undefined;
  return normalizeConfigItem(itemConfig).value;
};

export const buildSidEnablement = (
  sidSocketsCategory?: Record<string, unknown>,
  sidAddressingCategory?: Record<string, unknown>,
): SidEnablement => {
  const socket1Value = getCategoryItemValue(sidSocketsCategory, 'SID Sockets Configuration', 'SID Socket 1');
  const socket2Value = getCategoryItemValue(sidSocketsCategory, 'SID Sockets Configuration', 'SID Socket 2');
  const ultiSid1Value = getCategoryItemValue(sidAddressingCategory, 'SID Addressing', 'UltiSID 1 Address');
  const ultiSid2Value = getCategoryItemValue(sidAddressingCategory, 'SID Addressing', 'UltiSID 2 Address');

  return {
    socket1: resolveEnabledValue(socket1Value, ['disabled', 'off', 'false']),
    socket2: resolveEnabledValue(socket2Value, ['disabled', 'off', 'false']),
    ultiSid1: resolveEnabledValue(ultiSid1Value, ['unmapped', 'disabled', 'off']),
    ultiSid2: resolveEnabledValue(ultiSid2Value, ['unmapped', 'disabled', 'off']),
  };
};

export const isSidEnabledForName = (name: string, enablement: SidEnablement) => {
  if (!isSidVolumeName(name)) return true;
  const match = normalizeToken(name).match(/^vol\s+(ultisid|socket)\s+([12])$/i);
  if (!match) return true;
  const type = match[1];
  const index = Number(match[2]);
  const key =
    type === 'socket'
      ? index === 1
        ? 'socket1'
        : 'socket2'
      : index === 1
        ? 'ultiSid1'
        : 'ultiSid2';
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
  filterEnabledSidVolumeItems(items, enablement).forEach((item) => {
    updates[item.name] = resolveAudioMixerMuteValue(item.options);
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

export const buildEnabledSidVolumeUpdates = (
  items: SidVolumeItem[],
  enablement: SidEnablement,
  target: string,
) => {
  const updates: Record<string, string | number> = {};
  filterEnabledSidVolumeItems(items, enablement).forEach((item) => {
    const muteValue = resolveAudioMixerMuteValue(item.options);
    if (item.value === muteValue) return;
    updates[item.name] = target;
  });
  return updates;
};
