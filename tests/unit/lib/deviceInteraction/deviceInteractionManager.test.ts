import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceSafetyConfig } from '@/lib/config/deviceSafetySettings';
import type { DeviceState } from '@/lib/deviceInteraction/deviceStateStore';
import type { TraceActionContext } from '@/lib/tracing/types';

const createConfig = (): DeviceSafetyConfig => ({
  mode: 'BALANCED',
  restMaxConcurrency: 1,
  ftpMaxConcurrency: 1,
  infoCacheMs: 300,
  configsCacheMs: 0,
  configsCooldownMs: 0,
  drivesCooldownMs: 0,
  ftpListCooldownMs: 150,
  backoffBaseMs: 100,
  backoffMaxMs: 400,
  backoffFactor: 2,
  circuitBreakerThreshold: 2,
  circuitBreakerCooldownMs: 500,
  discoveryProbeIntervalMs: 400,
  allowUserOverrideCircuit: true,
});

let config: DeviceSafetyConfig = createConfig();
let deviceStateValue: DeviceState = 'READY';

const loadDeviceSafetyConfig = vi.fn(() => config);
const subscribeDeviceSafetyUpdates = vi.fn(() => () => undefined);

const getDeviceStateSnapshot = vi.fn(() => ({
  state: deviceStateValue,
  connectionState: 'REAL_CONNECTED',
  busyCount: 0,
  lastUpdatedAtMs: Date.now(),
  lastErrorMessage: null,
  lastSuccessAtMs: null,
  circuitOpenUntilMs: null,
}));
const markDeviceRequestStart = vi.fn();
const markDeviceRequestEnd = vi.fn();
const setCircuitOpenUntil = vi.fn();

const recordDeviceGuard = vi.fn();
const addLog = vi.fn();
const addErrorLog = vi.fn();

vi.mock('@/lib/config/deviceSafetySettings', () => ({
  loadDeviceSafetyConfig,
  subscribeDeviceSafetyUpdates,
}));

vi.mock('@/lib/deviceInteraction/deviceStateStore', () => ({
  getDeviceStateSnapshot,
  markDeviceRequestStart,
  markDeviceRequestEnd,
  setCircuitOpenUntil,
}));

vi.mock('@/lib/tracing/traceSession', () => ({
  recordDeviceGuard,
}));

vi.mock('@/lib/logging', () => ({
  addLog,
  addErrorLog,
}));

const makeAction = (name = 'test-action'): TraceActionContext => ({
  correlationId: 'trace-1',
  origin: 'system',
  name,
  componentName: null,
});

const applyNonTestEnv = () => {
  const previousVitest = process.env.VITEST;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.VITEST = 'false';
  process.env.NODE_ENV = 'production';
  return () => {
    process.env.VITEST = previousVitest;
    process.env.NODE_ENV = previousNodeEnv;
  };
};

describe('deviceInteractionManager', () => {
  let restoreEnv: (() => void) | null = null;

  beforeEach(() => {
    restoreEnv = applyNonTestEnv();
    config = createConfig();
    deviceStateValue = 'READY';
    recordDeviceGuard.mockClear();
    addErrorLog.mockClear();
    addLog.mockClear();
    markDeviceRequestStart.mockClear();
    markDeviceRequestEnd.mockClear();
    setCircuitOpenUntil.mockClear();
    vi.useRealTimers();
  });

  afterEach(() => {
    restoreEnv?.();
    vi.useRealTimers();
  });

  it('coalesces inflight REST requests and caches responses', async () => {
    const { withRestInteraction, resetInteractionState } = await import('@/lib/deviceInteraction/deviceInteractionManager');
    resetInteractionState('test');

    const action = makeAction('rest-info');
    const meta = {
      action,
      method: 'GET',
      path: '/v1/info',
      normalizedUrl: 'http://device/v1/info',
      intent: 'system' as const,
      baseUrl: 'http://device',
    };

    let resolveHandler: ((value: { status: string }) => void) | null = null;
    const handler = vi.fn(() => new Promise<{ status: string }>((resolve) => {
      resolveHandler = resolve;
    }));

    const first = withRestInteraction(meta, handler);
    const second = withRestInteraction(meta, handler);

    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    resolveHandler?.({ status: 'ok' });

    await expect(first).resolves.toEqual({ status: 'ok' });
    await expect(second).resolves.toEqual({ status: 'ok' });

    const cached = await withRestInteraction(meta, handler);
    expect(cached).toEqual({ status: 'ok' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(recordDeviceGuard).toHaveBeenCalledWith(action, expect.objectContaining({ decision: 'coalesce' }));
    expect(recordDeviceGuard).toHaveBeenCalledWith(action, expect.objectContaining({ decision: 'cache' }));
  });

  it('blocks REST calls when device is in error state', async () => {
    const { withRestInteraction, resetInteractionState } = await import('@/lib/deviceInteraction/deviceInteractionManager');
    resetInteractionState('test');

    deviceStateValue = 'ERROR';
    config = {
      ...createConfig(),
      allowUserOverrideCircuit: false,
    };

    const action = makeAction('rest-error');
    const meta = {
      action,
      method: 'GET',
      path: '/v1/configs',
      normalizedUrl: 'http://device/v1/configs',
      intent: 'background' as const,
      baseUrl: 'http://device',
    };

    await expect(withRestInteraction(meta, vi.fn())).rejects.toThrow('Device not ready for requests');
    expect(recordDeviceGuard).toHaveBeenCalledWith(action, expect.objectContaining({ decision: 'block', reason: 'state' }));
  });

  it('applies backoff and opens circuit after critical failures', async () => {
    const { withRestInteraction, resetInteractionState } = await import('@/lib/deviceInteraction/deviceInteractionManager');
    resetInteractionState('test');

    config = {
      ...createConfig(),
      backoffBaseMs: 100,
      backoffMaxMs: 200,
      backoffFactor: 2,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 500,
      allowUserOverrideCircuit: false,
    };

    const action = makeAction('rest-backoff');
    const meta = {
      action,
      method: 'GET',
      path: '/v1/drives',
      normalizedUrl: 'http://device/v1/drives',
      intent: 'system' as const,
      baseUrl: 'http://device',
    };

    const handler = vi.fn().mockRejectedValue(new Error('Network timed out'));

    await expect(withRestInteraction(meta, handler)).rejects.toThrow('Network timed out');

    const second = withRestInteraction(meta, handler);
    await expect(second).rejects.toThrow('Network timed out');

    await expect(withRestInteraction(meta, handler)).rejects.toThrow('Device circuit open');
    expect(recordDeviceGuard).toHaveBeenCalledWith(action, expect.objectContaining({ decision: 'defer', reason: 'backoff' }));
    expect(setCircuitOpenUntil).toHaveBeenCalled();
  });

  it('logs FTP failures and coalesces inflight operations', async () => {
    const { withFtpInteraction, resetInteractionState } = await import('@/lib/deviceInteraction/deviceInteractionManager');
    resetInteractionState('test');

    const action = makeAction('ftp-list');
    const meta = {
      action,
      operation: 'list',
      path: '/root',
      intent: 'system' as const,
    };

    let resolveHandler: (() => void) | null = null;
    const handler = vi.fn(() => new Promise<void>((resolve) => {
      resolveHandler = resolve;
    }));

    const first = withFtpInteraction(meta, handler);
    const second = withFtpInteraction(meta, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    resolveHandler?.();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();

    const failingHandler = vi.fn().mockRejectedValue(new Error('FTP failed'));
    await expect(withFtpInteraction(meta, failingHandler)).rejects.toThrow('FTP failed');
    expect(addErrorLog).toHaveBeenCalledWith('FTP request failed', expect.objectContaining({ operation: 'list', path: '/root' }));
  });
});
