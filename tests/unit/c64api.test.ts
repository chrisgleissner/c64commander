import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  C64API,
  getC64API,
  updateC64APIConfig,
  applyC64APIRuntimeConfig,
  C64_DEFAULTS,
  resolveDeviceHostFromStorage,
} from '@/lib/c64api';
import { addErrorLog, addLog } from '@/lib/logging';
import { CapacitorHttp } from '@capacitor/core';
import { resetConfigWriteThrottle } from '@/lib/config/configWriteThrottle';
import { saveConfigWriteIntervalMs } from '@/lib/config/appSettings';
import { isFuzzModeEnabled, isFuzzSafeBaseUrl } from '@/lib/fuzz/fuzzMode';

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    request: vi.fn(),
  },
}));

vi.mock('@/lib/fuzz/fuzzMode', () => ({
  isFuzzModeEnabled: vi.fn(() => false),
  isFuzzSafeBaseUrl: vi.fn(() => true),
}));

const addErrorLogMock = vi.mocked(addErrorLog);
const addLogMock = vi.mocked(addLog);
const capacitorRequestMock = vi.mocked(CapacitorHttp.request);
const fuzzEnabledMock = vi.mocked(isFuzzModeEnabled);
const fuzzSafeMock = vi.mocked(isFuzzSafeBaseUrl);

describe('c64api', () => {
  beforeEach(() => {
    localStorage.clear();
    addErrorLogMock.mockReset();
    addLogMock.mockReset();
    capacitorRequestMock.mockReset();
    fuzzEnabledMock.mockReset();
    fuzzSafeMock.mockReset();
    fuzzEnabledMock.mockReturnValue(false);
    fuzzSafeMock.mockReturnValue(true);
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = undefined;
    vi.stubGlobal('fetch', vi.fn());
    resetConfigWriteThrottle();
    saveConfigWriteIntervalMs(0);
  });

  it('adds auth headers for password', async () => {
    const fetchMock = vi.mocked(fetch);
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
    const fetchMock = vi.mocked(fetch);
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
    const fetchMock = vi.mocked(fetch);
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
    const fetchMock = vi.mocked(fetch);
    fuzzEnabledMock.mockReturnValue(true);
    fuzzSafeMock.mockReturnValue(false);

    const api = new C64API('http://example.com');
    await expect(api.getInfo()).rejects.toThrow('Fuzz mode blocked request');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addErrorLogMock).toHaveBeenCalledWith('Fuzz mode blocked real device request', expect.any(Object));
    expect(addErrorLogMock).toHaveBeenCalledTimes(1);
  });

  it('allows requests in fuzz mode for safe base urls', async () => {
    const fetchMock = vi.mocked(fetch);
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

  it('uses CapacitorHttp on native platforms', async () => {
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    capacitorRequestMock.mockResolvedValue({
      status: 200,
      data: JSON.stringify({ errors: [] }),
      headers: {},
      url: 'http://c64u/v1/info',
    });

    const api = new C64API('http://c64u');
    const result = await api.getInfo();
    expect(result.errors).toEqual([]);
    expect(capacitorRequestMock).toHaveBeenCalled();
  });

  it('does not persist runtime config updates', async () => {
    localStorage.setItem('c64u_password', 'saved-pass');
    localStorage.setItem('c64u_device_host', 'saved-host');

    applyC64APIRuntimeConfig('http://runtime', 'runtime-pass', 'runtime-host');

    expect(localStorage.getItem('c64u_base_url')).toBeNull();
    expect(localStorage.getItem('c64u_password')).toBe('saved-pass');
    expect(localStorage.getItem('c64u_device_host')).toBe('saved-host');
  });

  it('migrates legacy base url into device host storage', () => {
    localStorage.setItem('c64u_base_url', 'http://192.168.1.55');

    const resolvedHost = resolveDeviceHostFromStorage();

    expect(resolvedHost).toBe('192.168.1.55');
    expect(localStorage.getItem('c64u_device_host')).toBe('192.168.1.55');
    expect(localStorage.getItem('c64u_base_url')).toBeNull();
  });

  it('handles CapacitorHttp non-string payloads', async () => {
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    capacitorRequestMock.mockResolvedValue({
      status: 200,
      data: { errors: [] },
      headers: {},
      url: 'http://c64u/v1/version',
    });

    const api = new C64API('http://c64u');
    const result = await api.getVersion();
    expect(result.errors).toEqual([]);
  });

  it('logs parse failures for invalid json responses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response('bad-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const api = new C64API('http://c64u');
    const result = await api.getInfo();
    expect(result.errors).toEqual([]);
    expect(addErrorLogMock).toHaveBeenCalledWith('C64 API parse failed', expect.any(Object));
  });

  it('throws for native http errors', async () => {
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    capacitorRequestMock.mockResolvedValue({
      status: 400,
      data: { errors: ['bad'] },
      headers: {},
      url: 'http://c64u/v1/info',
    });

    const api = new C64API('http://c64u');
    await expect(api.getInfo()).rejects.toThrow('HTTP 400');
    expect(addErrorLogMock).toHaveBeenCalled();
  });

  it('updates config and dispatches connection change', () => {
    const handler = vi.fn();
    window.addEventListener('c64u-connection-change', handler as EventListener);

    updateC64APIConfig('http://host', 'pw', 'host');
    expect(localStorage.getItem('c64u_base_url')).toBeNull();
    expect(localStorage.getItem('c64u_password')).toBe('pw');
    expect(localStorage.getItem('c64u_device_host')).toBe('host');
    expect(handler).toHaveBeenCalled();

    window.removeEventListener('c64u-connection-change', handler as EventListener);
  });

  it('clears stored password when omitted and derives device host', () => {
    updateC64APIConfig('http://host', 'pw', 'host');
    updateC64APIConfig('http://device');
    expect(localStorage.getItem('c64u_password')).toBeNull();
    expect(localStorage.getItem('c64u_device_host')).toBe('device');
    expect(localStorage.getItem('c64u_base_url')).toBeNull();
  });

  it('uploads cartridge files and handles upload failures', async () => {
    const fetchMock = vi.mocked(fetch);
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

  it('builds request urls for config writes and machine actions', async () => {
    const fetchMock = vi.mocked(fetch);
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

  it('covers reads, writes, and drive endpoints', async () => {
    const fetchMock = vi.mocked(fetch);
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
    const fetchMock = vi.mocked(fetch);
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

  it('covers runner and drive request helpers', async () => {
    const fetchMock = vi.mocked(fetch);
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
