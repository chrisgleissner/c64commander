/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createAppConfigEntry,
  getActiveBaseUrl,
  loadAppConfigs,
  loadHasChanges,
  loadInitialSnapshot,
  saveAppConfigs,
  saveInitialSnapshot,
  updateHasChanges,
  listAppConfigs,
} from '@/lib/config/appConfigStore';

vi.mock('@/lib/c64api', () => ({
  buildBaseUrlFromDeviceHost: (host?: string) => `http://${host ?? 'c64u'}`,
  resolveDeviceHostFromStorage: () => localStorage.getItem('c64u_device_host') || 'c64u',
}));

describe('appConfigStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses stored base url or default', () => {
    expect(getActiveBaseUrl()).toBe('http://c64u');
    localStorage.setItem('c64u_device_host', 'custom-host');
    expect(getActiveBaseUrl()).toBe('http://custom-host');
  });

  it('stores and loads initial snapshots', () => {
    const snapshot = { savedAt: 'now', data: { Audio: { errors: [] as string[] } } };
    expect(loadInitialSnapshot('http://device')).toBeNull();
    saveInitialSnapshot('http://device', snapshot);
    expect(loadInitialSnapshot('http://device')).toEqual(snapshot);
  });

  it('stores and updates has-changes flag with event dispatch', () => {
    const handler = vi.fn();
    window.addEventListener('c64u-has-changes', handler as EventListener);

    expect(loadHasChanges('http://device')).toBe(false);
    updateHasChanges('http://device', true);
    expect(loadHasChanges('http://device')).toBe(true);
    expect(handler).toHaveBeenCalled();

    updateHasChanges('http://device', false);
    expect(loadHasChanges('http://device')).toBe(false);

    window.removeEventListener('c64u-has-changes', handler as EventListener);
  });

  it('creates, saves, and lists app configs sorted by saved time', () => {
    const entryA = createAppConfigEntry('http://device', 'Config A', { Audio: { errors: [] } });
    const entryB = createAppConfigEntry('http://device', 'Config B', { Audio: { errors: [] } });
    const entryOther = createAppConfigEntry('http://other', 'Other', { Audio: { errors: [] } });

    saveAppConfigs([entryA, entryOther, entryB]);
    const listed = listAppConfigs('http://device');

    expect(listed).toHaveLength(2);
    expect(listed[0].savedAt >= listed[1].savedAt).toBe(true);
  });

  it('loads empty configs when storage is invalid', () => {
    localStorage.setItem('c64u_app_configs', 'not-json');
    expect(loadAppConfigs()).toEqual([]);
  });
});
