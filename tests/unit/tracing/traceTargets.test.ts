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
});
