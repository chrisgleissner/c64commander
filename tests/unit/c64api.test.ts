/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapacitorHttp } from '@capacitor/core';
import {
  C64API,
  getC64API,
  updateC64APIConfig,
  applyC64APIRuntimeConfig,
  C64_DEFAULTS,
  resolveDeviceHostFromStorage,
} from '@/lib/c64api';
import { clearPassword as clearStoredPassword, setPassword as storePassword } from '@/lib/secureStorage';
import { addErrorLog, addLog } from '@/lib/logging';
import { resetConfigWriteThrottle } from '@/lib/config/configWriteThrottle';
import { saveConfigWriteIntervalMs } from '@/lib/config/appSettings';
import { isFuzzModeEnabled, isFuzzSafeBaseUrl } from '@/lib/fuzz/fuzzMode';
import { isSmokeModeEnabled, isSmokeReadOnlyEnabled } from '@/lib/smoke/smokeMode';
import { getDeviceStateSnapshot } from '@/lib/deviceInteraction/deviceStateStore';

const ensureWindow = () => {
  if (typeof window !== 'undefined') return;
  const target = new EventTarget();
  const windowMock = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) =>
      target.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) =>
      target.removeEventListener(type, listener, options),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    location: { origin: 'http://localhost' },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  Object.defineProperty(globalThis, 'window', {
    value: windowMock,
    configurable: true,
  });
  if (typeof (globalThis as { CustomEvent?: typeof CustomEvent }).CustomEvent === 'undefined') {
    class CustomEventShim<T = any> extends Event {
      detail?: T;
      constructor(type: string, params?: CustomEventInit<T>) {
        super(type, params);
        this.detail = params?.detail;
      }
    }
    Object.defineProperty(globalThis, 'CustomEvent', {
      value: CustomEventShim,
      configurable: true,
    });
  }
};

const ensureLocalStorage = () => {
  if (typeof localStorage !== 'undefined') return;
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
};

ensureWindow();
ensureLocalStorage();

const fetchMock = vi.fn();
Object.defineProperty(globalThis, 'fetch', {
  value: fetchMock,
  configurable: true,
});

const getFetchMock = () => fetchMock as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details?: Record<string, unknown>) => ({
    ...details,
    error: error.message,
  })),
}));

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    request: vi.fn(),
  },
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock('@/lib/fuzz/fuzzMode', () => ({
  isFuzzModeEnabled: vi.fn(() => false),
  isFuzzSafeBaseUrl: vi.fn(() => true),
}));

vi.mock('@/lib/smoke/smokeMode', () => ({
  isSmokeModeEnabled: vi.fn(() => false),
  isSmokeReadOnlyEnabled: vi.fn(() => true),
}));

vi.mock('@/lib/deviceInteraction/deviceStateStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/deviceInteraction/deviceStateStore')>();
  return {
    ...actual,
    getDeviceStateSnapshot: vi.fn(() => ({
      state: 'READY',
      connectionState: 'REAL_CONNECTED',
      busyCount: 0,
      lastUpdatedAtMs: Date.now(),
      lastErrorMessage: null,
      lastSuccessAtMs: null,
      circuitOpenUntilMs: null,
    })),
  };
});

vi.mock('@/lib/secureStorage', () => ({
  setPassword: vi.fn(async () => {
    localStorage.setItem('c64u_has_password', '1');
  }),
  getPassword: vi.fn(async () => null),
  clearPassword: vi.fn(async () => {
    localStorage.removeItem('c64u_has_password');
  }),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

const addErrorLogMock = addErrorLog as unknown as ReturnType<typeof vi.fn>;
const addLogMock = addLog as unknown as ReturnType<typeof vi.fn>;
const fuzzEnabledMock = isFuzzModeEnabled as unknown as ReturnType<typeof vi.fn>;
const fuzzSafeMock = isFuzzSafeBaseUrl as unknown as ReturnType<typeof vi.fn>;
const smokeEnabledMock = isSmokeModeEnabled as unknown as ReturnType<typeof vi.fn>;
const smokeReadOnlyMock = isSmokeReadOnlyEnabled as unknown as ReturnType<typeof vi.fn>;
const deviceStateSnapshotMock = getDeviceStateSnapshot as unknown as ReturnType<typeof vi.fn>;
const storePasswordMock = storePassword as unknown as ReturnType<typeof vi.fn>;
const clearPasswordMock = clearStoredPassword as unknown as ReturnType<typeof vi.fn>;
const capacitorHttpMock = CapacitorHttp.request as unknown as ReturnType<typeof vi.fn>;

describe('c64api', () => {
  beforeEach(() => {
    localStorage.clear();
    addErrorLogMock.mockReset();
    addLogMock.mockReset();
    capacitorHttpMock.mockReset();
    fuzzEnabledMock.mockReset();
    fuzzSafeMock.mockReset();
    smokeEnabledMock.mockReset();
    smokeReadOnlyMock.mockReset();
    fetchMock.mockReset();
    fuzzEnabledMock.mockReturnValue(false);
    fuzzSafeMock.mockReturnValue(true);
    smokeEnabledMock.mockReturnValue(false);
    smokeReadOnlyMock.mockReturnValue(true);
    deviceStateSnapshotMock.mockReturnValue({
      state: 'READY',
      connectionState: 'REAL_CONNECTED',
      busyCount: 0,
      lastUpdatedAtMs: Date.now(),
      lastErrorMessage: null,
      lastSuccessAtMs: null,
      circuitOpenUntilMs: null,
    });
    (globalThis as { __c64uAllowNativePlatform?: boolean }).__c64uAllowNativePlatform = false;
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = undefined;
    resetConfigWriteThrottle();
    saveConfigWriteIntervalMs(0);
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = false;
    storePasswordMock.mockReset();
    clearPasswordMock.mockReset();
  });

  afterAll(() => {
    const handles = (process as { _getActiveHandles?: () => any[] })._getActiveHandles?.() ?? [];
    if (process.env.C64U_DEBUG_HANDLES === '1') {
      const summary = handles.map((handle) => {
        const type = handle?.constructor?.name ?? 'unknown';
        const hasRef = typeof handle?.hasRef === 'function' ? handle.hasRef() : undefined;
        const idleTimeout = typeof handle?._idleTimeout === 'number' ? handle._idleTimeout : undefined;
        const fd = typeof handle?.fd === 'number' ? handle.fd : undefined;
        const socketInfo = type === 'Socket'
          ? {
            localAddress: handle.localAddress,
            localPort: handle.localPort,
            remoteAddress: handle.remoteAddress,
            remotePort: handle.remotePort,
          }
          : undefined;
        return { type, hasRef, idleTimeout, fd, socketInfo };
      });
      console.log('c64api.test active handles:', summary);
    }
    handles.forEach((handle) => {
      if (handle?.constructor?.name === 'Timeout') {
        try {
          clearTimeout(handle);
          clearInterval(handle);
        } catch {
          // ignore cleanup errors
        }
      }
    });
  });

  it('adds auth headers for password', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://c64u-device', 'secret', 'c64u-device');
    await api.getInfo();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Password']).toBe('secret');
    expect(headers['X-C64U-Host']).toBeUndefined();
  });

  it('handles non-json responses gracefully', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    const api = new C64API('http://c64u');
    const result = await api.getVersion();
    expect(result.errors).toEqual([]);
    expect(addLogMock).toHaveBeenCalledWith('debug', 'C64 API request', expect.objectContaining({
      method: 'GET',
      path: '/v1/version',
      status: 200,
    }));
  });

  it('logs and throws on http errors', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response('fail', { status: 500, statusText: 'Server Error' }),
    );

    const api = new C64API('http://c64u');
    await expect(api.getInfo()).rejects.toThrow('HTTP 500');
    expect(addErrorLogMock).toHaveBeenCalled();
    expect(addLogMock).toHaveBeenCalledWith('debug', 'C64 API request', expect.objectContaining({
      method: 'GET',
      path: '/v1/info',
      status: 500,
    }));
  });

  it('blocks requests in fuzz mode for non-local base urls', async () => {
    const fetchMock = getFetchMock();
    fuzzEnabledMock.mockReturnValue(true);
    fuzzSafeMock.mockReturnValue(false);

    const api = new C64API('http://example.com');
    await expect(api.getInfo()).rejects.toThrow('Fuzz mode blocked request');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addErrorLogMock).toHaveBeenCalledWith('Fuzz mode blocked real device request', expect.any(Object));
    expect(addErrorLogMock).toHaveBeenCalledTimes(1);
  });

  it('allows requests in fuzz mode for safe base urls', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    fuzzEnabledMock.mockReturnValue(true);
    fuzzSafeMock.mockReturnValue(true);

    const api = new C64API('http://127.0.0.1');
    await expect(api.getInfo()).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('blocks mutating requests in smoke read-only mode', async () => {
    const fetchMock = getFetchMock();
    smokeEnabledMock.mockReturnValue(true);
    smokeReadOnlyMock.mockReturnValue(true);

    const api = new C64API('http://c64u');
    await expect(api.saveConfig()).rejects.toThrow('Smoke mode blocked mutating request');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addErrorLogMock).toHaveBeenCalledWith('Smoke mode blocked mutating request', expect.any(Object));
  });

  it('uses patched fetch on native platforms', async () => {
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://c64u');
    const result = await api.getInfo();
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
    expect(capacitorHttpMock).not.toHaveBeenCalled();
  });

  it('does not persist runtime config updates', async () => {
    localStorage.setItem('c64u_has_password', '1');
    localStorage.setItem('c64u_device_host', 'saved-host');

    applyC64APIRuntimeConfig('http://runtime', 'runtime-pass', 'runtime-host');

    expect(localStorage.getItem('c64u_base_url')).toBeNull();
    expect(localStorage.getItem('c64u_password')).toBeNull();
    expect(localStorage.getItem('c64u_has_password')).toBe('1');
    expect(localStorage.getItem('c64u_device_host')).toBe('saved-host');
  });

  it('migrates legacy base url into device host storage', () => {
    localStorage.setItem('c64u_base_url', 'http://192.168.1.55');

    const resolvedHost = resolveDeviceHostFromStorage();

    expect(resolvedHost).toBe('192.168.1.55');
    expect(localStorage.getItem('c64u_device_host')).toBe('192.168.1.55');
    expect(localStorage.getItem('c64u_base_url')).toBeNull();
  });

  it('handles non-string payloads on native platforms', async () => {
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://c64u');
    const result = await api.getVersion();
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('logs parse failures for invalid json responses', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response('bad-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const api = new C64API('http://c64u');
    const result = await api.getInfo();
    expect(result.errors).toEqual([]);
    expect(addErrorLogMock).toHaveBeenCalledWith('C64 API parse failed', expect.any(Object));
  });

  it('throws for native http errors', async () => {
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: ['bad'] }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://c64u');
    await expect(api.getInfo()).rejects.toThrow('HTTP 400');
    expect(addErrorLogMock).toHaveBeenCalled();
  });

  it('updates config and dispatches connection change', async () => {
    const handler = vi.fn();
    window.addEventListener('c64u-connection-change', handler as EventListener);

    updateC64APIConfig('http://host', 'pw', 'host');
    await storePasswordMock.mock.results[0]?.value;
    expect(localStorage.getItem('c64u_base_url')).toBeNull();
    expect(localStorage.getItem('c64u_password')).toBeNull();
    expect(storePasswordMock).toHaveBeenCalledWith('pw');
    expect(localStorage.getItem('c64u_device_host')).toBe('host');
    expect(storePasswordMock).toHaveBeenCalledWith('pw');
    expect(handler).toHaveBeenCalled();

    window.removeEventListener('c64u-connection-change', handler as EventListener);
  });

  it('clears stored password when omitted and derives device host', () => {
    updateC64APIConfig('http://host', 'pw', 'host');
    updateC64APIConfig('http://device');
    expect(localStorage.getItem('c64u_password')).toBeNull();
    expect(localStorage.getItem('c64u_has_password')).toBeNull();
    expect(localStorage.getItem('c64u_device_host')).toBe('device');
    expect(localStorage.getItem('c64u_base_url')).toBeNull();
    expect(clearPasswordMock).toHaveBeenCalled();
  });

  it('avoids localhost fallback when device host is stored', () => {
    localStorage.setItem('c64u_device_host', 'real-device');
    updateC64APIConfig('http://localhost');
    expect(localStorage.getItem('c64u_device_host')).toBe('real-device');

    applyC64APIRuntimeConfig('http://localhost');
    const snapshot = getC64API().getDeviceHost();
    expect(snapshot).toBe('real-device');
  });

  it('uploads cartridge files and handles upload failures', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://c64u');
    const payload = new Blob(['CRT'], { type: 'application/octet-stream' });
    const result = await api.runCartridgeUpload(payload);
    expect(result.errors).toEqual([]);

    fetchMock.mockResolvedValueOnce(new Response('fail', { status: 500, statusText: 'Server Error' }));
    await expect(api.runCartridgeUpload(payload)).rejects.toThrow('HTTP 500');
    expect(addErrorLogMock).toHaveBeenCalledWith('CRT upload failed', expect.any(Object));
  });

  it('maps failed fetch in SID uploads to host unreachable', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const api = new C64API('http://c64u');
    const payload = new Blob(['SID'], { type: 'application/octet-stream' });

    await expect(api.playSidUpload(payload)).rejects.toThrow('Host unreachable');
  });

  it('maps unknown host errors in SID uploads to DNS unreachable', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockRejectedValue(new TypeError('Unknown host'));

    const api = new C64API('http://c64u');
    const payload = new Blob(['SID'], { type: 'application/octet-stream' });

    await expect(api.playSidUpload(payload)).rejects.toThrow('Host unreachable (DNS)');
  });

  it('maps timed out control requests to host unreachable', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockRejectedValueOnce(new Error('Request timed out'));

    const api = new C64API('http://c64u');
    await expect(api.machineReset()).rejects.toThrow('Host unreachable');
  });

  it('retries one idle GET request after a network failure', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = getFetchMock();
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ errors: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      deviceStateSnapshotMock.mockReturnValue({
        state: 'READY',
        connectionState: 'REAL_CONNECTED',
        busyCount: 0,
        lastUpdatedAtMs: Date.now() - 15000,
        lastErrorMessage: null,
        lastSuccessAtMs: Date.now() - 15000,
        circuitOpenUntilMs: null,
      });

      const api = new C64API('http://c64u');
      const pending = api.getInfo();
      await vi.advanceTimersByTimeAsync(200);
      await expect(pending).resolves.toEqual(expect.objectContaining({ errors: [] }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(addLogMock).toHaveBeenCalledWith(
        'warn',
        'C64 API retry scheduled after idle failure',
        expect.objectContaining({ wasIdle: true }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts idle retry backoff immediately when caller aborts the request', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = getFetchMock();
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ errors: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      deviceStateSnapshotMock.mockReturnValue({
        state: 'READY',
        connectionState: 'REAL_CONNECTED',
        busyCount: 0,
        lastUpdatedAtMs: Date.now() - 15000,
        lastErrorMessage: null,
        lastSuccessAtMs: Date.now() - 15000,
        circuitOpenUntilMs: null,
      });

      const api = new C64API('http://c64u');
      const controller = new AbortController();
      const pending = api.getInfo({ signal: controller.signal });
      void pending.catch(() => {});

      await Promise.resolve();
      controller.abort();
      await vi.runAllTimersAsync();

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds request urls for config writes and machine actions', async () => {
    const fetchMock = getFetchMock();
    const okResponse = () =>
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    fetchMock.mockImplementation(() => Promise.resolve(okResponse()));

    const api = new C64API('http://c64u');
    await api.setConfigValue('Audio Mixer', 'Vol UltiSid 1', '+6 dB');
    await api.saveConfig();
    await api.loadConfig();
    await api.resetConfig();
    await api.updateConfigBatch({ Audio: { Volume: '0 dB' } });
    await api.machineReset();
    await api.machineReboot();
    await api.machinePause();
    await api.machineResume();
    await api.machinePowerOff();
    await api.machineMenuButton();

    const calls = fetchMock.mock.calls.map((call) => call[0]);
    expect(calls).toContain('http://c64u/v1/configs/Audio%20Mixer/Vol%20UltiSid%201?value=%2B6%20dB');
    expect(calls).toContain('http://c64u/v1/configs:save_to_flash');
    expect(calls).toContain('http://c64u/v1/machine:resume');
  });

  it('encodes joystick swap config writes with the expected category and item', async () => {
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://c64u');
    await api.setConfigValue('U64 Specific Settings', 'Joystick Swapper', 'Swapped');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://c64u/v1/configs/U64%20Specific%20Settings/Joystick%20Swapper?value=Swapped',
      expect.objectContaining({
        method: 'PUT',
      }),
    );
  });

  it('covers reads, writes, and drive endpoints', async () => {
    const fetchMock = getFetchMock();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: btoa('ABC') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [1, 2, 3] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const okResponse = () =>
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    fetchMock.mockImplementation(() => Promise.resolve(okResponse()));

    const api = new C64API('http://c64u');
    expect(Array.from(await api.readMemory('0400', 3))).toEqual([65, 66, 67]);
    expect(Array.from(await api.readMemory('0400', 3))).toEqual([1, 2, 3]);

    await api.writeMemory('0400', new Uint8Array([0, 15, 255]));
    await api.writeMemoryBlock('1000', new Uint8Array([1, 2, 3, 4]));
    await api.mountDrive('a', '/path/my disk.d64', '1541', 'readonly');
    await api.unmountDrive('a');
    await api.resetDrive('a');
    await api.driveOn('a');
    await api.driveOff('a');
    await api.setDriveMode('a', '1581');

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toContain('http://c64u/v1/machine:writemem?address=0400&data=000fff');
    expect(urls).toContain('http://c64u/v1/drives/a:mount?image=%2Fpath%2Fmy%20disk.d64&type=1541&mode=readonly');
    const writeBlockCall = fetchMock.mock.calls.find((call) => call[0] === 'http://c64u/v1/machine:writemem?address=1000');
    expect(writeBlockCall?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });

  it('uploads drives and runner files with auth headers', async () => {
    const fetchMock = getFetchMock();
    const okResponse = () =>
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(okResponse()))
      .mockImplementationOnce(() => Promise.resolve(new Response('fail', { status: 500, statusText: 'Server Error' })))
      .mockImplementation(() => Promise.resolve(okResponse()));

    const api = new C64API('http://127.0.0.1:8787', 'pw', 'device-host');
    await api.mountDriveUpload('a', new Blob(['disk']), '1541', 'readwrite');
    await expect(api.mountDriveUpload('a', new Blob(['disk']))).rejects.toThrow('HTTP 500');

    const sidFile = new Blob(['PSID'], { type: 'application/octet-stream' });
    const sslFile = new Blob(['SSL'], { type: 'application/octet-stream' });
    await api.playSidUpload(sidFile, 2, sslFile);
    await api.playModUpload(new Blob(['MOD']));
    await api.runPrgUpload(new Blob(['PRG']));
    await api.loadPrgUpload(new Blob(['PRG']));

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Password']).toBe('pw');
    expect(headers['X-C64U-Host']).toBeUndefined();
    expect(addErrorLogMock).toHaveBeenCalledWith('Drive mount upload failed', expect.any(Object));
  });

  it('uses fetch for binary uploads on native platforms', async () => {
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    const fetchMock = getFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://c64u');
    await api.mountDriveUpload('a', new Blob(['disk'], { type: 'application/octet-stream' }));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://c64u/v1/drives/a:mount',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('covers runner and drive request helpers', async () => {
    const fetchMock = getFetchMock();
    const okResponse = () =>
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    fetchMock.mockImplementation(() => Promise.resolve(okResponse()));

    const api = new C64API('http://c64u');
    await api.getCategories();
    await api.getCategory('Audio Mixer');
    await api.getConfigItem('Audio Mixer', 'Vol UltiSid 1');
    await api.getDrives();
    await api.playSid('/music/test.sid', 7);
    await api.playMod('/music/test.mod');
    await api.runPrg('/programs/test.prg');
    await api.loadPrg('/programs/test.prg');
    await api.runCartridge('/cartridges/test.crt');

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toContain('http://c64u/v1/runners:sidplay?file=%2Fmusic%2Ftest.sid&songnr=7');
    expect(urls).toContain('http://c64u/v1/runners:run_crt?file=%2Fcartridges%2Ftest.crt');
  });

  it('reuses singleton C64 API instance', () => {
    localStorage.setItem('c64u_device_host', C64_DEFAULTS.DEFAULT_DEVICE_HOST);
    const api1 = getC64API();
    const api2 = getC64API();
    expect(api1).toBe(api2);
  });
});
