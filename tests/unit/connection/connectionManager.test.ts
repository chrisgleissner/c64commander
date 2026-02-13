/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logging from '../../../src/lib/logging';
import { getFuzzMockBaseUrl, isFuzzModeEnabled } from '../../../src/lib/fuzz/fuzzMode';
import { loadAutomaticDemoModeEnabled, loadDiscoveryProbeTimeoutMs, loadStartupDiscoveryWindowMs } from '../../../src/lib/config/appSettings';
import { isSmokeModeEnabled, recordSmokeStatus } from '../../../src/lib/smoke/smokeMode';

vi.mock('../../../src/lib/config/appSettings', () => ({
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadDebugLoggingEnabled: vi.fn(() => false),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 600),
}));

vi.mock('../../../src/lib/fuzz/fuzzMode', () => ({
  applyFuzzModeDefaults: vi.fn(),
  isFuzzModeEnabled: vi.fn(() => false),
  getFuzzMockBaseUrl: vi.fn(() => null),
}));

vi.mock('../../../src/lib/smoke/smokeMode', () => ({
  initializeSmokeMode: vi.fn(async () => null),
  getSmokeConfig: vi.fn(() => null),
  isSmokeModeEnabled: vi.fn(() => false),
  isSmokeReadOnlyEnabled: vi.fn(() => true),
  recordSmokeStatus: vi.fn(async () => undefined),
}));

vi.mock('../../../src/lib/c64api', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/c64api')>('../../../src/lib/c64api');
  return {
    ...actual,
    applyC64APIRuntimeConfig: vi.fn(),
  };
});

vi.mock('../../../src/lib/secureStorage', () => ({
  getPassword: vi.fn(async () => null),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

const startMockServer = vi.fn(async () => {
  throw new Error('Mock C64U server is only available on native platforms.');
});
const stopMockServer = vi.fn(async () => undefined);
const getActiveMockBaseUrl = vi.fn(() => null);
const getActiveMockFtpPort = vi.fn(() => null);

vi.mock('../../../src/lib/mock/mockServer', () => ({
  startMockServer,
  stopMockServer,
  getActiveMockBaseUrl,
  getActiveMockFtpPort,
}));

const ensureStorage = () => {
  const createMemoryStorage = () => {
    let store = new Map<string, string>();
    return {
      getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store = new Map();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };
  };

  const attachStorage = (key: 'localStorage' | 'sessionStorage') => {
    if (key in globalThis && globalThis[key as keyof typeof globalThis]) return;
    Object.defineProperty(globalThis, key, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  };

  attachStorage('localStorage');
  attachStorage('sessionStorage');
};

describe('connectionManager', () => {
  beforeEach(() => {
    ensureStorage();
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    vi.mocked(isFuzzModeEnabled).mockReturnValue(false);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue(null);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(loadDiscoveryProbeTimeoutMs).mockReturnValue(2500);
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
    } = await import('../../../src/lib/connection/connectionManager');

    // Force an unreachable URL so probes always fail quickly.
    localStorage.setItem('c64u_device_host', '127.0.0.1:1');
    localStorage.removeItem('c64u_has_password');

    await initializeConnectionManager();
    expect(getConnectionSnapshot().state).toBe('UNKNOWN');

    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(true);

    // Dismiss, then manual discovery should not show again in same session.
    const { dismissDemoInterstitial } = await import('../../../src/lib/connection/connectionManager');
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
    const { isFuzzModeEnabled, getFuzzMockBaseUrl } = await import('../../../src/lib/fuzz/fuzzMode');
    vi.mocked(isFuzzModeEnabled).mockReturnValue(true);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue('http://127.0.0.1:9999');

    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } = await import('../../../src/lib/c64api');
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('../../../src/lib/connection/connectionManager');

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
      await import('../../../src/lib/connection/connectionManager');

    localStorage.setItem('c64u_base_url', 'http://127.0.0.1:9999');
    localStorage.removeItem('c64u_device_host');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe('REAL_CONNECTED');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(localStorage.getItem('c64u_device_host')).toBe('127.0.0.1:9999');
  });

  it('records smoke status transitions when enabled', async () => {
    const { discoverConnection, initializeConnectionManager } = await import('../../../src/lib/connection/connectionManager');
    const { isSmokeModeEnabled, recordSmokeStatus } = await import('../../../src/lib/smoke/smokeMode');

    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(50);

    expect(recordSmokeStatus).toHaveBeenCalledWith(expect.objectContaining({
      state: 'REAL_CONNECTED',
      mode: 'real',
    }));
  });

  it('logs when discovery probe JSON parsing fails', async () => {
    const addLogSpy = vi.spyOn(logging, 'addLog');
    const { probeOnce } = await import('../../../src/lib/connection/connectionManager');

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    vi.mocked(fetch).mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const ok = await probeOnce();

    expect(ok).toBe(false);
    expect(addLogSpy).toHaveBeenCalledWith(
      'warn',
      'Discovery probe JSON parse failed',
      expect.objectContaining({
        error: expect.any(String),
      }),
    );
    addLogSpy.mockRestore();
  });

  it('does not fall back to demo mode after real connection is sticky', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, isRealDeviceStickyLockEnabled } =
      await import('../../../src/lib/connection/connectionManager');

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe('REAL_CONNECTED');
    expect(isRealDeviceStickyLockEnabled()).toBe(true);

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    void discoverConnection('manual');
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe('OFFLINE_NO_DEMO');
    expect(startMockServer).not.toHaveBeenCalled();
  });

  it('accepts healthy probe payload without product field', async () => {
    const { probeOnce } = await import('../../../src/lib/connection/connectionManager');
    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(probeOnce()).resolves.toBe(true);
  });

  it('returns false when probe exceeds timeout', async () => {
    const { probeOnce } = await import('../../../src/lib/connection/connectionManager');
    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_: RequestInfo, init?: RequestInit) => {
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
    });

    const resultPromise = probeOnce({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBe(false);
  });

  it('uses configured probe timeout when not provided', async () => {
    const { probeOnce } = await import('../../../src/lib/connection/connectionManager');
    vi.mocked(loadDiscoveryProbeTimeoutMs).mockReturnValue(40);
    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_: RequestInfo, init?: RequestInit) => {
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
    });

    const resultPromise = probeOnce();
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBe(false);
  });

  it('connects to real device before discovery window expires', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('../../../src/lib/connection/connectionManager');

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe('REAL_CONNECTED');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it('discovery timeout falls back to demo even if a probe is still in flight', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('../../../src/lib/connection/connectionManager');

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() =>
      new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }));
        }, 500);
      }),
    );

    await initializeConnectionManager();
    void discoverConnection('startup');

    await vi.advanceTimersByTimeAsync(250);
    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');

    await vi.advanceTimersByTimeAsync(400);
    expect(getConnectionSnapshot().state).toBe('DEMO_ACTIVE');
  });

  it('switches from demo to real device on background probe success', async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import('../../../src/lib/connection/connectionManager');

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchStub = vi.mocked(fetch);
    fetchStub
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['offline'] }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ product: 'C64 Ultimate', errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

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
      await import('../../../src/lib/connection/connectionManager');

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: ['Device unreachable'] }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection('startup');
    await vi.advanceTimersByTimeAsync(300);

    expect(getConnectionSnapshot().state).toBe('OFFLINE_NO_DEMO');
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it('demo fallback applies mock routing details when available', async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import('../../../src/lib/connection/connectionManager');
    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } = await import('../../../src/lib/c64api');

    startMockServer.mockResolvedValue({ baseUrl: 'http://127.0.0.1:7777', ftpPort: 21 });
    getActiveMockBaseUrl.mockReturnValue('http://127.0.0.1:7777');

    localStorage.setItem('c64u_device_host', '127.0.0.1:9999');
    localStorage.removeItem('c64u_has_password');

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: ['Device unreachable'] }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );

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

