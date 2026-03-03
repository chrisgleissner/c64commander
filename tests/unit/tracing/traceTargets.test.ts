/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const connectionSnapshotMock = vi.fn();
const stickyLockMock = vi.fn();
const apiConfigSnapshotMock = vi.fn();
const activeMockBaseUrlMock = vi.fn();

vi.mock('@/lib/connection/connectionManager', () => ({
  getConnectionSnapshot: () => connectionSnapshotMock(),
  isRealDeviceStickyLockEnabled: () => stickyLockMock(),
}));

vi.mock('@/lib/c64api', () => ({
  getC64APIConfigSnapshot: () => apiConfigSnapshotMock(),
}));

vi.mock('@/lib/mock/mockServer', () => ({
  getActiveMockBaseUrl: () => activeMockBaseUrlMock(),
}));

import { resolveBackendTarget } from '@/lib/tracing/traceTargets';

describe('traceTargets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl;
    stickyLockMock.mockReset();
  });

  it('uses internal mock when demo mode is active', () => {
    stickyLockMock.mockReturnValue(false);
    connectionSnapshotMock.mockReturnValue({ state: 'DEMO_ACTIVE' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://device' });
    activeMockBaseUrlMock.mockReturnValue(null);

    expect(resolveBackendTarget()).toEqual({ target: 'internal-mock', reason: 'demo-mode' });
  });

  it('uses external mock when test probes match base URL', () => {
    stickyLockMock.mockReturnValue(false);
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
    (window as { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = 'http://mock';
    connectionSnapshotMock.mockReturnValue({ state: 'REAL_CONNECTED' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://mock/api' });
    activeMockBaseUrlMock.mockReturnValue(null);

    expect(resolveBackendTarget()).toEqual({ target: 'external-mock', reason: 'test-mode' });
  });

  it('falls back to real device when offline without demo', () => {
    stickyLockMock.mockReturnValue(false);
    connectionSnapshotMock.mockReturnValue({ state: 'OFFLINE_NO_DEMO' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://device' });
    activeMockBaseUrlMock.mockReturnValue(null);

    expect(resolveBackendTarget()).toEqual({ target: 'real-device', reason: 'fallback' });
  });

  it('forces real-device target when sticky lock is enabled', () => {
    stickyLockMock.mockReturnValue(true);
    connectionSnapshotMock.mockReturnValue({ state: 'DEMO_ACTIVE' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://mock' });
    activeMockBaseUrlMock.mockReturnValue('http://mock');

    expect(resolveBackendTarget()).toEqual({ target: 'real-device', reason: 'reachable' });
  });

  it('uses fallback reason when sticky and offline', () => {
    stickyLockMock.mockReturnValue(true);
    connectionSnapshotMock.mockReturnValue({ state: 'OFFLINE_NO_DEMO' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://device' });
    activeMockBaseUrlMock.mockReturnValue(null);

    expect(resolveBackendTarget()).toEqual({ target: 'real-device', reason: 'fallback' });
  });

  it('uses internal mock when activeMockUrl matches runtimeBaseUrl (BRDA:51)', () => {
    stickyLockMock.mockReturnValue(false);
    connectionSnapshotMock.mockReturnValue({ state: 'REAL_CONNECTED' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://mockserver/api' });
    activeMockBaseUrlMock.mockReturnValue('http://mockserver/');

    expect(resolveBackendTarget()).toEqual({ target: 'internal-mock', reason: 'demo-mode' });
  });

  it('handles invalid URL in normalizeUrl gracefully (BRDA:29)', () => {
    stickyLockMock.mockReturnValue(false);
    connectionSnapshotMock.mockReturnValue({ state: 'REAL_CONNECTED' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'not-a-valid-url' });
    activeMockBaseUrlMock.mockReturnValue(null);

    const result = resolveBackendTarget('not-a-valid-url');
    expect(result.target).toBe('real-device');
  });

  it('uses __c64uMockServerBaseUrl as test base URL fallback when __c64uExpectedBaseUrl absent (BRDA:38)', () => {
    stickyLockMock.mockReturnValue(false);
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
    delete (window as { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl;
    (window as { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = 'http://mock/';
    connectionSnapshotMock.mockReturnValue({ state: 'REAL_CONNECTED' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://mock/api' });
    activeMockBaseUrlMock.mockReturnValue(null);

    const result = resolveBackendTarget();
    expect(result.target).toBe('external-mock');
    delete (window as { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl;
  });

  it('enables test probes via __c64uTestProbeEnabled flag (BRDA:19)', () => {
    stickyLockMock.mockReturnValue(false);
    (window as { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    (window as { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = 'http://probe/';
    connectionSnapshotMock.mockReturnValue({ state: 'REAL_CONNECTED' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://probe/api' });
    activeMockBaseUrlMock.mockReturnValue(null);

    const result = resolveBackendTarget();
    expect(result.target).toBe('external-mock');
    delete (window as { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
  });

  it('resolves real-device when test probes enabled but no test URL globals set (BRDA:38,17)', () => {
    stickyLockMock.mockReturnValue(false);
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
    // Neither __c64uExpectedBaseUrl nor __c64uMockServerBaseUrl is set → ?? null evaluated
    delete (window as { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl;
    delete (window as { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl;
    connectionSnapshotMock.mockReturnValue({ state: 'REAL_CONNECTED' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://device' });
    activeMockBaseUrlMock.mockReturnValue(null);

    const result = resolveBackendTarget();
    expect(result.target).toBe('real-device');
    expect(result.reason).toBe('reachable');
  });

  it('skips window probe check when window is not defined (BRDA:16)', () => {
    // Covers: if (typeof window !== 'undefined') false branch in isTestProbeEnabled
    stickyLockMock.mockReturnValue(false);
    connectionSnapshotMock.mockReturnValue({ state: 'REAL_CONNECTED' });
    apiConfigSnapshotMock.mockReturnValue({ baseUrl: 'http://device' });
    activeMockBaseUrlMock.mockReturnValue(null);

    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
    try {
      const result = resolveBackendTarget();
      expect(result.target).toBe('real-device');
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'window', original);
      }
    }
  });
});
