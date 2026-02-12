/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { C64API } from '@/lib/c64api';
import { CapacitorHttp } from '@capacitor/core';

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

describe('C64API playSidUpload', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete (window as any).Capacitor;
  });

  it('uses fetch for multipart uploads even on native platforms', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ errors: [] }), { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    (window as any).Capacitor = {
      isNativePlatform: () => true,
    };

    const requestSpy = vi.spyOn(CapacitorHttp, 'request');

    const api = new C64API('http://127.0.0.1:1234', undefined, '127.0.0.1:1234');
    const sidFile = new Blob([new Uint8Array([0x50, 0x53, 0x49, 0x44])], { type: 'audio/sid' });

    await api.playSidUpload(sidFile);

    expect(requestSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/v1/runners:sidplay');
    expect((options as RequestInit)?.method).toBe('POST');
  });

  it('retries transient network failures up to success', async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const api = new C64API('http://127.0.0.1:1234', undefined, '127.0.0.1:1234');
    const sidFile = new Blob([new Uint8Array([0x50, 0x53, 0x49, 0x44])], { type: 'audio/sid' });

    await api.playSidUpload(sidFile);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries retryable 503 responses and succeeds on final attempt', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(new Response('busy', { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const api = new C64API('http://127.0.0.1:1234', undefined, '127.0.0.1:1234');
    const sidFile = new Blob([new Uint8Array([0x50, 0x53, 0x49, 0x44])], { type: 'audio/sid' });

    await api.playSidUpload(sidFile);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent 4xx failures', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad request', { status: 400, statusText: 'Bad Request' }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const api = new C64API('http://127.0.0.1:1234', undefined, '127.0.0.1:1234');
    const sidFile = new Blob([new Uint8Array([0x50, 0x53, 0x49, 0x44])], { type: 'audio/sid' });

    await expect(api.playSidUpload(sidFile)).rejects.toThrow('HTTP 400');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
