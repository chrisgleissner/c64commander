/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { clearMockConfigLoader, getMockConfigPayload, setMockConfigLoader } from '@/lib/mock/mockConfig';

describe('mockConfig', () => {
  beforeEach(() => {
    setMockConfigLoader(() => `
config:
  general:
    base_url: http://mock
    rest_api_version: '1.0'
    device_type: U64
    firmware_version: 3.12a
    fetched_at: now
  categories:
    Audio:
      items:
        Volume:
          selected: '+6 dB'
          options: ['+6 dB', '0 dB']
          details:
            min: '0'
            max: 10
            format: db
            presets: ['0', '6']
`);
  });

  it('builds and caches payload from yaml', async () => {
    const payload = await getMockConfigPayload();
    expect(payload.general.baseUrl).toBe('http://mock');
    expect(payload.general.restApiVersion).toBe('1.0');
    expect(payload.categories.Audio.Volume.value).toBe('+6 dB');
    expect(payload.categories.Audio.Volume.options).toEqual(['+6 dB', '0 dB']);
    expect(payload.categories.Audio.Volume.details).toEqual({ min: 0, max: 10, format: 'db', presets: ['0', '6'] });

    const cached = await getMockConfigPayload();
    expect(cached).toBe(payload);
  });

  it('resets cache when loader changes', async () => {
    const first = await getMockConfigPayload();
    setMockConfigLoader(() => ({ config: { general: { base_url: 'http://other' } } }));
    const second = await getMockConfigPayload();
    expect(second.general.baseUrl).toBe('http://other');
    expect(second).not.toBe(first);
  });

  it('falls back to defaults when loader throws', async () => {
    setMockConfigLoader(() => {
      throw new Error('boom');
    });

    const payload = await getMockConfigPayload();
    expect(payload.general.baseUrl).toBe('http://c64u');
    expect(payload.general.deviceType).toBe('Ultimate 64 Elite');
    expect(Object.keys(payload.categories).length).toBeGreaterThan(0);
  });

  it('falls back to bundled yaml when asset fetch fails', async () => {
    clearMockConfigLoader();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('nope'));

    const payload = await getMockConfigPayload();

    expect(payload.general.deviceType).toBe('Ultimate 64 Elite');
    expect(Object.keys(payload.categories).length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });
});
