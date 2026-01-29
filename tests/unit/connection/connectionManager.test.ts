import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFuzzMockBaseUrl, isFuzzModeEnabled } from '@/lib/fuzz/fuzzMode';
import { loadAutomaticDemoModeEnabled, loadStartupDiscoveryWindowMs } from '@/lib/config/appSettings';
import { isSmokeModeEnabled, recordSmokeStatus } from '@/lib/smoke/smokeMode';

vi.mock('@/lib/config/appSettings', () => ({
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadStartupDiscoveryWindowMs: vi.fn(() => 600),
}));

vi.mock('@/lib/fuzz/fuzzMode', () => ({
  applyFuzzModeDefaults: vi.fn(),
  isFuzzModeEnabled: vi.fn(() => false),
  getFuzzMockBaseUrl: vi.fn(() => null),
}));

vi.mock('@/lib/smoke/smokeMode', () => ({
  initializeSmokeMode: vi.fn(async () => null),
  getSmokeConfig: vi.fn(() => null),
  isSmokeModeEnabled: vi.fn(() => false),
  isSmokeReadOnlyEnabled: vi.fn(() => true),
  recordSmokeStatus: vi.fn(async () => undefined),
}));

vi.mock('@/lib/c64api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/c64api')>('@/lib/c64api');
  return {
    ...actual,
    applyC64APIRuntimeConfig: vi.fn(),
  };
});

const startMockServer = vi.fn(async () => {
  throw new Error('Mock C64U server is only available on native platforms.');
});
const stopMockServer = vi.fn(async () => undefined);
const getActiveMockBaseUrl = vi.fn(() => null);
const getActiveMockFtpPort = vi.fn(() => null);

vi.mock('@/lib/mock/mockServer', () => ({
  startMockServer,
  stopMockServer,
  getActiveMockBaseUrl,
  getActiveMockFtpPort,
}));

describe('connectionManager', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.mocked(isFuzzModeEnabled).mockReturnValue(false);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue(null);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(600);
    vi.mocked(isSmokeModeEnabled).mockReturnValue(false);
    vi.mocked(recordSmokeStatus).mockResolvedValue(undefined);
    startMockServer.mockClear();
    stopMockServer.mockClear();
    getActiveMockBaseUrl.mockClear();
    getActiveMockFtpPort.mockClear();
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

  it('connects to real device when legacy base url is reachable', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('@/lib/connection/connectionManager');

    localStorage.setItem('c64u_base_url', 'http://127.0.0.1:9999');
    localStorage.removeItem('c64u_device_host');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe('REAL_CONNECTED');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(localStorage.getItem('c64u_device_host')).toBe('127.0.0.1:9999');
  });

  it('records smoke status transitions when enabled', async () => {
    const { discoverConnection, initializeConnectionManager } = await import('@/lib/connection/connectionManager');
    const { isSmokeModeEnabled, recordSmokeStatus } = await import('@/lib/smoke/smokeMode');

    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(50);

    expect(recordSmokeStatus).toHaveBeenCalledWith(expect.objectContaining({
      state: 'REAL_CONNECTED',
      mode: 'real',
    }));
  });

  it('accepts healthy probe payload without product field', async () => {
    const { probeOnce } = await import('@/lib/connection/connectionManager');
    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await expect(probeOnce()).resolves.toBe(true);
  });

  it('returns false when probe exceeds timeout', async () => {
    const { probeOnce } = await import('@/lib/connection/connectionManager');
    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn((_: RequestInfo, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        setTimeout(() => {
          resolve(new Response(JSON.stringify({ errors: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }));
        }, 200);
      });
    }));

    const resultPromise = probeOnce({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBe(false);
  });

  it('connects to real device before discovery window expires', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('@/lib/connection/connectionManager');

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe('REAL_CONNECTED');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it('probe success after discovery timeout does not revert fallback', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('@/lib/connection/connectionManager');

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn(() =>
      new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }));
        }, 500);
      }),
    ));

    await initializeConnectionManager();
    void discoverConnection('startup');

    await vi.advanceTimersByTimeAsync(250);
    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');

    await vi.advanceTimersByTimeAsync(400);
    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');
  });

  it('switches from demo to real device on background probe success', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('@/lib/connection/connectionManager');

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['offline'] }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(250);

    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');

    await discoverConnection('background');
    await vi.runAllTimersAsync();

    expect(getConnectionSnapshot().state).toBe('REAL_CONNECTED');
  });

  it('does not auto-enable demo when automatic demo mode is disabled', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('@/lib/connection/connectionManager');

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: ['Device unreachable'] }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(300);

    expect(getConnectionSnapshot().state).toBe('OFFLINE_NO_DEMO');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it('demo fallback applies mock routing details when available', async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import('@/lib/connection/connectionManager');
    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } = await import('@/lib/c64api');

    startMockServer.mockResolvedValue({ baseUrl: 'http://127.0.0.1:7777', ftpPort: 21 });
    getActiveMockBaseUrl.mockReturnValue('http://127.0.0.1:7777');

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.setItem('c64u_password', '');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: ['Device unreachable'] }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(700);

    expect(vi.mocked(applyC64APIRuntimeConfig)).toHaveBeenCalledWith(
      'http://127.0.0.1:7777',
      undefined,
      getDeviceHostFromBaseUrl('http://127.0.0.1:7777'),
    );
  });
});

