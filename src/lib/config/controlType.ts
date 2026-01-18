export type ControlKind = 'password' | 'checkbox' | 'select' | 'text';

export interface MenuItemDescriptor {
  name: string;
  currentValue: string | number;
  possibleValues?: string[];
}

export interface CheckboxMapping {
  checkedValue: string;
  uncheckedValue: string;
}

const norm = (v: string) => v.trim().toLowerCase();

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

  // Rule 3: combo box for 2+ values
  const possibleValues = (item.possibleValues ?? []).map(String);
  if (possibleValues.length >= 2) return 'select';

  // Rule 4: text field fallback
  return 'text';
}

