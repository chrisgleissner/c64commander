/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  getDeveloperModeEnabled,
  setDeveloperModeEnabled,
  subscribeDeveloperMode,
} from '@/lib/config/developerModeStore';

describe('developerModeStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getDeveloperModeEnabled returns false when not set', () => {
    expect(getDeveloperModeEnabled()).toBe(false);
  });

  it('setDeveloperModeEnabled(true) stores "1" and fires event', () => {
    const events: boolean[] = [];
    const unsub = subscribeDeveloperMode((d) => events.push(d.enabled));
    setDeveloperModeEnabled(true);
    unsub();
    expect(localStorage.getItem('c64u_dev_mode_enabled')).toBe('1');
    expect(getDeveloperModeEnabled()).toBe(true);
    expect(events).toEqual([true]);
  });

  it('setDeveloperModeEnabled(false) stores "0" and fires event (line 17 FALSE branch)', () => {
    // Pre-set to true so we can verify it changes to false
    localStorage.setItem('c64u_dev_mode_enabled', '1');
    const events: boolean[] = [];
    const unsub = subscribeDeveloperMode((d) => events.push(d.enabled));
    setDeveloperModeEnabled(false);
    unsub();
    expect(localStorage.getItem('c64u_dev_mode_enabled')).toBe('0');
    expect(getDeveloperModeEnabled()).toBe(false);
    expect(events).toEqual([false]);
  });
});
