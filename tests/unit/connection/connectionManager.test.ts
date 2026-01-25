import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config/appSettings', () => ({
  loadAutomaticDemoModeEnabled: () => true,
  loadStartupDiscoveryWindowMs: () => 600,
}));

vi.mock('@/lib/mock/mockServer', () => ({
  startMockServer: async () => {
    throw new Error('Mock C64U server is only available on native platforms.');
  },
  stopMockServer: async () => undefined,
}));

describe('connectionManager', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
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
});

