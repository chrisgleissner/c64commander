import { afterEach, describe, expect, it, vi } from 'vitest';

const capacitorMocks = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'android'),
  isNativePlatform: vi.fn(() => true),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorMocks,
}));

describe('platform helpers', () => {
  afterEach(() => {
    delete (window as Window & { __c64uPlatformOverride?: string }).__c64uPlatformOverride;
    vi.unstubAllEnvs();
  });

  it('uses Capacitor platform helpers when no override is set', async () => {
    const { getPlatform, isNativePlatform } = await import('@/lib/native/platform');

    expect(getPlatform()).toBe('android');
    expect(isNativePlatform()).toBe(true);
  });

  it('honors platform override when test probes are enabled', async () => {
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
    (window as Window & { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'ios';

    const { getPlatform, isNativePlatform } = await import('@/lib/native/platform');

    expect(getPlatform()).toBe('ios');
    expect(isNativePlatform()).toBe(true);

    (window as Window & { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'web';
    expect(getPlatform()).toBe('web');
    expect(isNativePlatform()).toBe(false);
  });
});
