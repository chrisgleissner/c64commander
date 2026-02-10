/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ControlKind = 'password' | 'checkbox' | 'slider' | 'select' | 'text';

export interface MenuItemDescriptor {
  name: string;
  category?: string;
  currentValue: string | number;
  possibleValues?: string[];
}

export interface CheckboxMapping {
  checkedValue: string;
  uncheckedValue: string;
}

const norm = (v: string) => v.trim().toLowerCase();
const normalizeOption = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
const numericWithUnitPattern = /^\s*[+-]?\d+(?:\.\d+)?\s*(db|mhz|khz|hz|%|ms|s)?\s*$/i;
const maxSliderOptions = 40;

const getNormalizedOptions = (values: string[] | undefined) =>
  (values ?? []).map((v) => normalizeOption(String(v)));

const isNumericLike = (value: string) => numericWithUnitPattern.test(value);

const isAllNumericLike = (values: string[]) => values.length > 0 && values.every(isNumericLike);

const isOffLowMediumHigh = (values: string[]) => {
  const normalized = new Set(values.map(normalizeOption));
  return (
    normalized.size === 4 &&
    normalized.has('off') &&
    normalized.has('low') &&
    normalized.has('medium') &&
    normalized.has('high')
  );
};

const isLeftRightCenter = (values: string[]) => {
  const normalized = values.map((value) => normalizeOption(value));
  const hasCenter = normalized.some((value) => value === 'center' || value === 'centre');
  const hasLeft = normalized.some((value) => value.startsWith('left'));
  const hasRight = normalized.some((value) => value.startsWith('right'));
  return hasCenter && hasLeft && hasRight;
};

const isAudioMixerVolume = (name: string, category?: string) => {
  const normalizedName = normalizeOption(name);
  const normalizedCategory = category ? normalizeOption(category) : '';
  if (normalizedCategory === 'audio mixer' && normalizedName.startsWith('vol ')) return true;
  return normalizedName.includes('volume') || normalizedName.startsWith('vol ');
};

const shouldUseSlider = (item: MenuItemDescriptor) => {
  const possibleValues = (item.possibleValues ?? []).map(String);
  if (possibleValues.length < 2 || possibleValues.length > maxSliderOptions) return false;

  if (isAudioMixerVolume(item.name, item.category)) return true;

  const normalizedOptions = getNormalizedOptions(possibleValues);
  if (isOffLowMediumHigh(normalizedOptions)) return true;

  if (isLeftRightCenter(normalizedOptions)) return true;

  if (isAllNumericLike(possibleValues)) return true;

  const hasMhz = normalizedOptions.some((opt) => opt.includes('mhz'));
  if (hasMhz && isAllNumericLike(possibleValues)) return true;

  return false;
};

export function getCheckboxMapping(possibleValues: string[] | undefined): CheckboxMapping | undefined {
  const values = (possibleValues ?? []).map(String);
  if (values.length === 0) return undefined;

  const normalizedDistinct = Array.from(
    new Set(values.map((v) => norm(v))),
  );

  const isEnabledDisabled =
    normalizedDistinct.length === 2 &&
    normalizedDistinct.includes('enabled') &&
    normalizedDistinct.includes('disabled');
  if (isEnabledDisabled) {
    const enabled = values.find((v) => norm(v) === 'enabled') ?? 'enabled';
    const disabled = values.find((v) => norm(v) === 'disabled') ?? 'disabled';
    return { checkedValue: enabled, uncheckedValue: disabled };
  }

  const isOnOff =
    normalizedDistinct.length === 2 && normalizedDistinct.includes('on') && normalizedDistinct.includes('off');
  if (isOnOff) {
    const on = values.find((v) => norm(v) === 'on') ?? 'on';
    const off = values.find((v) => norm(v) === 'off') ?? 'off';
    return { checkedValue: on, uncheckedValue: off };
  }

  return undefined;
}

export function inferControlKind(item: MenuItemDescriptor): ControlKind {
  // Rule 1: password field (highest priority)
  if (item.name.toLowerCase().includes('password')) return 'password';

  // Rule 2: checkbox for Enabled/Disabled or On/Off (case-insensitive)
  const checkbox = getCheckboxMapping(item.possibleValues);
  if (checkbox) return 'checkbox';

  // Rule 3: slider for volume, Off/Low/Medium/High, numeric lists, and MHz values
  if (shouldUseSlider(item)) return 'slider';

  // Rule 4: combo box for 2+ values
  const possibleValues = (item.possibleValues ?? []).map(String);
  if (possibleValues.length >= 2) return 'select';

  // Rule 5: text field fallback
  return 'text';
}

