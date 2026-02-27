/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildBaseUrlFromDeviceHost = vi.fn((host: string) => `http://${host}`);
const getC64APIConfigSnapshot = vi.fn(() => ({ password: 'pw' }));
const updateC64APIConfig = vi.fn();
const discoverConnection = vi.fn();
const dismissDemoInterstitial = vi.fn();
const addLog = vi.fn();

vi.mock('@/lib/c64api', () => ({
  buildBaseUrlFromDeviceHost: (...args: unknown[]) => buildBaseUrlFromDeviceHost(args[0] as string),
  getC64APIConfigSnapshot: () => getC64APIConfigSnapshot(),
  updateC64APIConfig: (...args: unknown[]) => updateC64APIConfig(...args),
}));

vi.mock('@/lib/connection/connectionManager', () => ({
  discoverConnection: (...args: unknown[]) => discoverConnection(...args),
  dismissDemoInterstitial: (...args: unknown[]) => dismissDemoInterstitial(...args),
}));

vi.mock('@/lib/logging', () => ({
  addLog: (...args: unknown[]) => addLog(...args),
}));

import { getConfiguredHost, normalizeConfiguredHost, saveConfiguredHostAndRetry } from '@/lib/connection/hostEdit';

describe('hostEdit', () => {
  beforeEach(() => {
    buildBaseUrlFromDeviceHost.mockClear();
    getC64APIConfigSnapshot.mockClear();
    updateC64APIConfig.mockClear();
    discoverConnection.mockClear();
    dismissDemoInterstitial.mockClear();
    addLog.mockClear();
    localStorage.clear();
  });

  it('normalizes host input with fallback', () => {
    expect(normalizeConfiguredHost(' 192.168.0.1 ', 'c64u')).toBe('192.168.0.1');
    expect(normalizeConfiguredHost('   ', 'c64u')).toBe('c64u');
    expect(normalizeConfiguredHost('', 'c64u')).toBe('c64u');
  });

  it('reads configured host from localStorage', () => {
    localStorage.setItem('c64u_device_host', '10.0.0.5');
    expect(getConfiguredHost()).toBe('10.0.0.5');
  });

  it('returns default host and logs when localStorage read fails', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      expect(getConfiguredHost()).toBe('c64u');
      expect(addLog).toHaveBeenCalledWith('warn', 'Failed to read configured host from storage', expect.any(Object));
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it('saves host and retries with default trigger', () => {
    const host = saveConfiguredHostAndRetry(' 10.0.0.7 ', 'c64u');
    expect(host).toBe('10.0.0.7');
    expect(updateC64APIConfig).toHaveBeenCalledWith('http://10.0.0.7', 'pw', '10.0.0.7');
    expect(discoverConnection).toHaveBeenCalledWith('settings');
    expect(dismissDemoInterstitial).not.toHaveBeenCalled();
  });

  it('can dismiss interstitial and use explicit trigger', () => {
    saveConfiguredHostAndRetry('', 'c64u', { dismissInterstitial: true, trigger: 'manual' });
    expect(updateC64APIConfig).toHaveBeenCalledWith('http://c64u', 'pw', 'c64u');
    expect(dismissDemoInterstitial).toHaveBeenCalled();
    expect(discoverConnection).toHaveBeenCalledWith('manual');
  });
});
