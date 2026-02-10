/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';

const getPlatformMock = vi.fn();
const isNativePlatformMock = vi.fn();
let restoreWindow: (() => void) | null = null;

const ensureWindow = () => {
  if (typeof window !== 'undefined') return () => undefined;
  const globalWithWindow = globalThis as typeof globalThis & { window?: Window };
  const previous = globalWithWindow.window;
  globalWithWindow.window = {} as Window;
  return () => {
    if (previous) {
      globalWithWindow.window = previous;
    } else {
      delete globalWithWindow.window;
    }
  };
};

const envRestores: Array<() => void> = [];

const setEnv = (key: string, value: string) => {
  const previous = process.env[key];
  process.env[key] = value;
  const metaEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (metaEnv) metaEnv[key] = value;
  envRestores.push(() => {
    if (previous === undefined) {
      delete process.env[key];
      if (metaEnv) delete metaEnv[key];
    } else {
      process.env[key] = previous;
      if (metaEnv) metaEnv[key] = previous;
    }
  });
};

const restoreEnvs = () => {
  while (envRestores.length) {
    const restore = envRestores.pop();
    restore?.();
  }
};

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: (...args: unknown[]) => getPlatformMock(...args),
    isNativePlatform: (...args: unknown[]) => isNativePlatformMock(...args),
  },
}));

describe('platform', () => {
  beforeEach(() => {
    restoreWindow = ensureWindow();
  });

  afterEach(() => {
    getPlatformMock.mockReset();
    isNativePlatformMock.mockReset();
    if (typeof window !== 'undefined') {
      delete (window as { __c64uPlatformOverride?: string }).__c64uPlatformOverride;
    }
    restoreEnvs();
    restoreWindow?.();
  });

  it('returns override when test probes are enabled', () => {
    setEnv('VITE_ENABLE_TEST_PROBES', '1');
    (window as { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'android';

    expect(getPlatform()).toBe('android');
    expect(isNativePlatform()).toBe(true);
  });

  it('falls back to Capacitor when override is disabled', () => {
    setEnv('VITE_ENABLE_TEST_PROBES', '0');
    getPlatformMock.mockReturnValue('ios');
    isNativePlatformMock.mockReturnValue(true);

    expect(getPlatform()).toBe('ios');
    expect(isNativePlatform()).toBe(true);
  });

  it('returns web when Capacitor getPlatform is unavailable', async () => {
    setEnv('VITE_ENABLE_TEST_PROBES', '0');
    isNativePlatformMock.mockReturnValue(false);
    const { Capacitor } = await import('@capacitor/core');
    const previous = (Capacitor as { getPlatform?: () => string }).getPlatform;
    (Capacitor as { getPlatform?: () => string }).getPlatform = undefined;
    expect(getPlatform()).toBe('web');
    expect(isNativePlatform()).toBe(false);
    (Capacitor as { getPlatform?: () => string }).getPlatform = previous;
  });

  it('treats web override as non-native', async () => {
    setEnv('VITE_ENABLE_TEST_PROBES', '1');
    (window as { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'web';
    expect(isNativePlatform()).toBe(false);
  });
});
