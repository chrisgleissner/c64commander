/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';

export type SidChipKey = 'socket1' | 'socket2' | 'ultiSid1' | 'ultiSid2';

export type SidDetailEntry = {
  key: SidChipKey;
  label: string;
  volume: string;
  pan: string;
  address: string;
  addressRaw: string | number | undefined;
};

export type SidControlEntry = SidDetailEntry & {
  volumeItem: string;
  panItem: string;
  addressItem: string;
  volumeOptions: string[];
  panOptions: string[];
  addressOptions: string[];
};

type SidConfigDescriptor = {
  key: SidChipKey;
  label: string;
  volumeItem: string;
  panItem: string;
  addressItem: string;
};

const SID_LAYOUT: SidConfigDescriptor[] = [
  {
    key: 'socket1',
    label: 'SID Socket 1',
    volumeItem: 'Vol Socket 1',
    panItem: 'Pan Socket 1',
    addressItem: 'SID Socket 1 Address',
  },
  {
    key: 'socket2',
    label: 'SID Socket 2',
    volumeItem: 'Vol Socket 2',
    panItem: 'Pan Socket 2',
    addressItem: 'SID Socket 2 Address',
  },
  {
    key: 'ultiSid1',
    label: 'UltiSID 1',
    volumeItem: 'Vol UltiSid 1',
    panItem: 'Pan UltiSID 1',
    addressItem: 'UltiSID 1 Address',
  },
  {
    key: 'ultiSid2',
    label: 'UltiSID 2',
    volumeItem: 'Vol UltiSid 2',
    panItem: 'Pan UltiSID 2',
    addressItem: 'UltiSID 2 Address',
  },
];

const getCategoryItems = (payload: unknown, categoryName: string) => {
  const record = payload as Record<string, unknown> | undefined;
  const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
  return (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
};

const getItemValue = (payload: unknown, categoryName: string, itemName: string) => {
  const items = getCategoryItems(payload, categoryName);
  if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
  return normalizeConfigItem(items[itemName]).value;
};

const getItemOptions = (payload: unknown, categoryName: string, itemName: string) => {
  const items = getCategoryItems(payload, categoryName);
  if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return [];
  return normalizeConfigItem(items[itemName]).options ?? [];
};

const formatTextValue = (value: unknown) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || '—';
};

const formatAddressValue = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Unmapped';
  if (/^unmapped$/i.test(raw)) return 'Unmapped';
  if (/^\$?[0-9a-f]{4}$/i.test(raw)) {
    return `$${raw.replace(/^\$/, '').toUpperCase()}`;
  }
  return raw;
};

export const parseSidBaseAddress = (value: unknown): number | null => {
  const formatted = formatAddressValue(value);
  if (formatted === 'Unmapped') return null;
  const hex = formatted.replace(/^\$/, '');
  if (!/^[0-9A-F]{4}$/i.test(hex)) return null;
  return Number.parseInt(hex, 16);
};

export const buildSidDetailEntries = (
  audioMixerCategory?: Record<string, unknown>,
  sidAddressingCategory?: Record<string, unknown>,
): SidDetailEntry[] =>
  buildSidControlEntries(audioMixerCategory, sidAddressingCategory).map((entry) => ({
    key: entry.key,
    label: entry.label,
    volume: entry.volume,
    pan: entry.pan,
    address: entry.address,
    addressRaw: entry.addressRaw,
  }));

export const buildSidControlEntries = (
  audioMixerCategory?: Record<string, unknown>,
  sidAddressingCategory?: Record<string, unknown>,
): SidControlEntry[] =>
  SID_LAYOUT.map((entry) => {
    const volume = getItemValue(audioMixerCategory, 'Audio Mixer', entry.volumeItem);
    const pan = getItemValue(audioMixerCategory, 'Audio Mixer', entry.panItem);
    const addressRaw = getItemValue(sidAddressingCategory, 'SID Addressing', entry.addressItem);
    return {
      key: entry.key,
      label: entry.label,
      volumeItem: entry.volumeItem,
      panItem: entry.panItem,
      addressItem: entry.addressItem,
      volumeOptions: getItemOptions(audioMixerCategory, 'Audio Mixer', entry.volumeItem),
      panOptions: getItemOptions(audioMixerCategory, 'Audio Mixer', entry.panItem),
      addressOptions: getItemOptions(sidAddressingCategory, 'SID Addressing', entry.addressItem),
      volume: formatTextValue(volume),
      pan: formatTextValue(pan),
      address: formatAddressValue(addressRaw),
      addressRaw,
    };
  });
