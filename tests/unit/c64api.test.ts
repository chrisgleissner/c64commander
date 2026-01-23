import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64API, getC64API, updateC64APIConfig, C64_DEFAULTS } from '@/lib/c64api';
import { addErrorLog, addLog } from '@/lib/logging';
import { CapacitorHttp } from '@capacitor/core';

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    request: vi.fn(),
  },
}));

const addErrorLogMock = vi.mocked(addErrorLog);
const addLogMock = vi.mocked(addLog);
const capacitorRequestMock = vi.mocked(CapacitorHttp.request);

describe('c64api', () => {
  beforeEach(() => {
    localStorage.clear();
    addErrorLogMock.mockReset();
    addLogMock.mockReset();
    capacitorRequestMock.mockReset();
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = undefined;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('adds auth headers for password and local proxy host', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = new C64API('http://127.0.0.1:8787', 'secret', 'c64u-device');
    await api.getInfo();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Password']).toBe('secret');
    expect(headers['X-C64U-Host']).toBe('c64u-device');
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

  it('uses CapacitorHttp on native platforms', async () => {
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    capacitorRequestMock.mockResolvedValue({ status: 200, data: JSON.stringify({ errors: [] }) });

    const api = new C64API('http://c64u');
    const result = await api.getInfo();
    expect(result.errors).toEqual([]);
    expect(capacitorRequestMock).toHaveBeenCalled();
  });

  it('updates config and dispatches connection change', () => {
    const handler = vi.fn();
    window.addEventListener('c64u-connection-change', handler as EventListener);

    updateC64APIConfig('http://device', 'pw', 'host');
    expect(localStorage.getItem('c64u_base_url')).toBe('http://device');
    expect(localStorage.getItem('c64u_password')).toBe('pw');
    expect(localStorage.getItem('c64u_device_host')).toBe('host');
    expect(handler).toHaveBeenCalled();

    window.removeEventListener('c64u-connection-change', handler as EventListener);
  });

  it('clears stored password and device host when omitted', () => {
    updateC64APIConfig('http://device', 'pw', 'host');
    updateC64APIConfig('http://device');
    expect(localStorage.getItem('c64u_password')).toBeNull();
    expect(localStorage.getItem('c64u_device_host')).toBeNull();
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

  it('reuses singleton C64 API instance', () => {
    localStorage.setItem('c64u_base_url', C64_DEFAULTS.DEFAULT_BASE_URL);
    const api1 = getC64API();
    const api2 = getC64API();
    expect(api1).toBe(api2);
  });
});
