/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { resolveToggleOption } from '@/pages/home/utils/uiLogic';

describe('resolveToggleOption', () => {
  it('resolves explicit boolean tokens', () => {
    const options = ['Disabled', 'Enabled'];
    expect(resolveToggleOption(options, true)).toBe('Enabled');
    expect(resolveToggleOption(options, false)).toBe('Disabled');
  });

  it('resolves joystick swap options to swapped/normal values', () => {
    const options = ['Normal', 'Swapped'];
    expect(resolveToggleOption(options, true, {
      enabled: ['Swapped', 'Swap'],
      disabled: ['Normal'],
    })).toBe('Swapped');
    expect(resolveToggleOption(options, false, {
      enabled: ['Swapped', 'Swap'],
      disabled: ['Normal'],
    })).toBe('Normal');
  });

  it('falls back to first/last provided option when no token matches', () => {
    const options = ['Primary', 'Secondary'];
    expect(resolveToggleOption(options, true)).toBe('Primary');
    expect(resolveToggleOption(options, false)).toBe('Secondary');
  });
});
