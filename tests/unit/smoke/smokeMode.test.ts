/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSmokeMode, getSmokeConfig, isSmokeModeEnabled, isSmokeReadOnlyEnabled, recordSmokeStatus } from '@/lib/smoke/smokeMode';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { addLog } from '@/lib/logging';
import { saveDebugLoggingEnabled } from '@/lib/config/appSettings';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
  },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('@/lib/logging', () => ({
  addLog: vi.fn(),
}));

vi.mock('@/lib/config/appSettings', () => ({
  saveDebugLoggingEnabled: vi.fn(),
}));

describe('smokeMode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(addLog).mockClear();
    vi.mocked(saveDebugLoggingEnabled).mockClear();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Filesystem.readFile).mockReset();
    vi.mocked(Filesystem.writeFile).mockReset();
  });

  it('initializes from storage and persists host + logging', async () => {
    localStorage.setItem('c64u_smoke_config', JSON.stringify({
      target: 'real',
      host: 'http://Example.com',
      readOnly: false,
      debugLogging: true,
    }));

    const config = await initializeSmokeMode();

    expect(config).toEqual({
      target: 'real',
      host: 'example.com',
      readOnly: false,
      debugLogging: true,
    });
    expect(getSmokeConfig()).toEqual(config);
    expect(isSmokeModeEnabled()).toBe(true);
    expect(isSmokeReadOnlyEnabled()).toBe(false);
    expect(localStorage.getItem('c64u_device_host')).toBe('example.com');
    expect(localStorage.getItem('c64u_smoke_mode_enabled')).toBe('1');
    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
    expect(addLog).toHaveBeenCalledWith('info', 'Smoke mode enabled', expect.any(Object));
  });

  it('loads config from native storage when local storage is empty', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Filesystem.readFile).mockResolvedValue({
      data: JSON.stringify({
        target: 'mock',
        readOnly: true,
        debugLogging: false,
      }),
    });

    const config = await initializeSmokeMode();

    expect(config).toEqual({
      target: 'mock',
      host: undefined,
      readOnly: true,
      debugLogging: false,
    });
    expect(saveDebugLoggingEnabled).not.toHaveBeenCalled();
  });

  it('records smoke status on native platforms', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem('c64u_smoke_config', JSON.stringify({
      target: 'real',
      readOnly: true,
      debugLogging: false,
    }));

    await initializeSmokeMode();
    await recordSmokeStatus({ state: 'DEMO_ACTIVE', mode: 'demo' });

    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: 'c64u-smoke-status.json',
      directory: Directory.Data,
      data: expect.stringContaining('DEMO_ACTIVE'),
      encoding: Encoding.UTF8,
    });
  });
});
