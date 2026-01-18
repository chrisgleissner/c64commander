import { describe, expect, it } from 'vitest';
import { getCheckboxMapping, inferControlKind } from './controlType';

describe('inferControlKind (strict rule ordering)', () => {
  it('renders password field when name contains "password" (case-insensitive) and ignores possible values', () => {
    expect(
      inferControlKind({
        name: 'Network Password',
        currentValue: 'secret',
        possibleValues: ['Enabled', 'Disabled'],
      }),
    ).toBe('password');
  });

  it('renders checkbox only for Enabled/Disabled (any casing) and nothing else', () => {
    expect(getCheckboxMapping(['Enabled', 'Disabled'])).toEqual({
      checkedValue: 'Enabled',
      uncheckedValue: 'Disabled',
    });
    expect(
      inferControlKind({
        name: 'Drive',
        currentValue: 'Enabled',
        possibleValues: ['Enabled', 'Disabled'],
      }),
    ).toBe('checkbox');

    expect(getCheckboxMapping(['enabled', 'disabled', 'ENABLED'])).toEqual({
      checkedValue: 'enabled',
      uncheckedValue: 'disabled',
    });
  });

  it('renders checkbox only for On/Off (any casing) and nothing else', () => {
    expect(getCheckboxMapping(['On', 'Off'])).toEqual({
      checkedValue: 'On',
      uncheckedValue: 'Off',
    });
    expect(
      inferControlKind({
        name: 'Power',
        currentValue: 'On',
        possibleValues: ['On', 'Off'],
      }),
    ).toBe('checkbox');
  });

  it('does NOT render checkbox for other boolean-ish pairs', () => {
    expect(getCheckboxMapping(['Yes', 'No'])).toBeUndefined();
    expect(getCheckboxMapping(['True', 'False'])).toBeUndefined();
    expect(getCheckboxMapping(['Enabled', 'Disabled', 'Auto'])).toBeUndefined();
    expect(getCheckboxMapping(['Enabled', 'Disabled', ''])).toBeUndefined();
  });

  it('renders select for 2+ possible values when not a checkbox', () => {
    expect(
      inferControlKind({
        name: 'Video mode',
        currentValue: 'PAL',
        possibleValues: ['PAL', 'NTSC'],
      }),
    ).toBe('select');
  });

  it('renders text for all remaining cases', () => {
    expect(
      inferControlKind({
        name: 'Hostname',
        currentValue: 'c64u',
        possibleValues: [],
      }),
    ).toBe('text');

    expect(
      inferControlKind({
        name: 'Hostname',
        currentValue: 'c64u',
        possibleValues: ['OnlyOne'],
      }),
    ).toBe('text');
  });
});

