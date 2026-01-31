import { afterEach, describe, expect, it, vi } from 'vitest';

const getPlatformMock = vi.fn();

const loadGetPlatform = async (override?: { Capacitor?: Record<string, unknown> }) => {
  vi.resetModules();
  vi.doMock('@capacitor/core', () =>
    override ?? {
      Capacitor: {
        getPlatform: (...args: unknown[]) => getPlatformMock(...args),
      },
    },
  );
  const module = await import('@/lib/native/platform');
  return module.getPlatform;
};

describe('platform', () => {
  afterEach(() => {
    getPlatformMock.mockReset();
    delete (window as { __c64uPlatformOverride?: string }).__c64uPlatformOverride;
    vi.unstubAllEnvs();
  });

  it('returns override when test probes are enabled', () => {
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
    (window as { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'android';

    return loadGetPlatform().then((getPlatform) => {
      expect(getPlatform()).toBe('android');
    });
  });

  it('falls back to Capacitor when override is disabled', () => {
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '0');
    getPlatformMock.mockReturnValue('ios');

    return loadGetPlatform().then((getPlatform) => {
      expect(getPlatform()).toBe('ios');
    });
  });

  it('returns web when Capacitor getPlatform is unavailable', async () => {
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '0');
    const getPlatform = await loadGetPlatform({ Capacitor: {} });
    expect(getPlatform()).toBe('web');
  });
});
