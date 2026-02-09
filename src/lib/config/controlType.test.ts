/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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

  it('renders slider for Audio Mixer volume lists', () => {
    expect(
      inferControlKind({
        name: 'Vol UltiSid 1',
        category: 'Audio Mixer',
        currentValue: 'OFF',
        possibleValues: ['OFF', '+1 dB', ' 0 dB', '-1 dB'],
      }),
    ).toBe('slider');
  });

  it('renders slider for Off/Low/Medium/High lists', () => {
    expect(
      inferControlKind({
        name: 'Drive Speed',
        currentValue: 'Medium',
        possibleValues: ['Off', 'Low', 'Medium', 'High'],
      }),
    ).toBe('slider');
  });

  it('renders slider for Left/Center/Right lists', () => {
    expect(
      inferControlKind({
        name: 'Pan Test',
        category: 'Audio Mixer',
        currentValue: 'Center',
        possibleValues: ['Left 5', 'Left 4', 'Center', 'Right 4', 'Right 5'],
      }),
    ).toBe('slider');
  });

  it('renders slider for numeric lists (including MHz)', () => {
    expect(
      inferControlKind({
        name: 'Clock Rate',
        currentValue: '8 MHz',
        possibleValues: ['1 MHz', '2 MHz', '4 MHz', '8 MHz'],
      }),
    ).toBe('slider');

    expect(
      inferControlKind({
        name: 'Buffer Size',
        currentValue: '64',
        possibleValues: ['16', '32', '64', '128'],
      }),
    ).toBe('slider');
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

