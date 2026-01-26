import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFuzzMockBaseUrl, isFuzzModeEnabled } from '@/lib/fuzz/fuzzMode';

vi.mock('@/lib/config/appSettings', () => ({
  loadAutomaticDemoModeEnabled: () => true,
  loadStartupDiscoveryWindowMs: () => 600,
}));

vi.mock('@/lib/fuzz/fuzzMode', () => ({
  applyFuzzModeDefaults: vi.fn(),
  isFuzzModeEnabled: vi.fn(() => false),
  getFuzzMockBaseUrl: vi.fn(() => null),
}));

vi.mock('@/lib/c64api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/c64api')>('@/lib/c64api');
  return {
    ...actual,
    applyC64APIRuntimeConfig: vi.fn(),
  };
});

vi.mock('@/lib/mock/mockServer', () => ({
  startMockServer: async () => {
    throw new Error('Mock C64U server is only available on native platforms.');
  },
  stopMockServer: async () => undefined,
  getActiveMockBaseUrl: () => null,
  getActiveMockFtpPort: () => null,
}));

describe('connectionManager', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.mocked(isFuzzModeEnabled).mockReturnValue(false);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue(null);
  });

  it('shows demo interstitial at most once per session (manual/startup), never for background', async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import('@/lib/connection/connectionManager');

    // Force an unreachable URL so probes always fail quickly.
    localStorage.setItem('c64u_device_host', '127.0.0.1:1');
    localStorage.setItem('c64u_password', '');

    await initializeConnectionManager();
    expect(getConnectionSnapshot().state).toBe('UNKNOWN');

    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(true);

    // Dismiss, then manual discovery should not show again in same session.
    const { dismissDemoInterstitial } = await import('@/lib/connection/connectionManager');
    dismissDemoInterstitial();
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);

    void discoverConnection('manual');
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);

    // Background rediscovery must never show interstitial.
    void discoverConnection('background');
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it('forces demo mode in fuzz mode and applies forced mock base URL', async () => {
    const { isFuzzModeEnabled, getFuzzMockBaseUrl } = await import('@/lib/fuzz/fuzzMode');
    vi.mocked(isFuzzModeEnabled).mockReturnValue(true);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue('http://127.0.0.1:9999');

    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } = await import('@/lib/c64api');
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('@/lib/connection/connectionManager');

    await initializeConnectionManager();
    await discoverConnection('startup');

    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');
    expect(vi.mocked(applyC64APIRuntimeConfig)).toHaveBeenCalledWith(
      'http://127.0.0.1:9999',
      undefined,
      getDeviceHostFromBaseUrl('http://127.0.0.1:9999'),
    );
  });
});

