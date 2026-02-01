import { setTraceDeviceContext } from '@/lib/tracing/traceContext';
import type { ConnectionState } from '@/lib/connection/connectionManager';

export type DeviceState = 'UNKNOWN' | 'DISCOVERING' | 'CONNECTING' | 'READY' | 'BUSY' | 'ERROR';

export type DeviceStateSnapshot = Readonly<{
  state: DeviceState;
  connectionState: ConnectionState | null;
  busyCount: number;
  lastUpdatedAtMs: number;
  lastErrorMessage: string | null;
  lastSuccessAtMs: number | null;
  circuitOpenUntilMs: number | null;
}>;

let connectionState: ConnectionState | null = null;
let busyCount = 0;
let lastErrorMessage: string | null = null;
let lastSuccessAtMs: number | null = null;
let circuitOpenUntilMs: number | null = null;
let hasSuccessfulRequest = false;
let snapshot: DeviceStateSnapshot = Object.freeze({
  state: 'UNKNOWN',
  connectionState: null,
  busyCount: 0,
  lastUpdatedAtMs: Date.now(),
  lastErrorMessage: null,
  lastSuccessAtMs: null,
  circuitOpenUntilMs: null,
});

const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const resolveBaseState = (): DeviceState => {
  if (!connectionState) return 'UNKNOWN';
  if (connectionState === 'UNKNOWN') return 'UNKNOWN';
  if (connectionState === 'DISCOVERING') return 'DISCOVERING';
  if (connectionState === 'OFFLINE_NO_DEMO') return 'ERROR';
  if (connectionState === 'REAL_CONNECTED' || connectionState === 'DEMO_ACTIVE') {
    return hasSuccessfulRequest ? 'READY' : 'CONNECTING';
  }
  return 'UNKNOWN';
};

const computeState = (): DeviceState => {
  const now = Date.now();
  if (circuitOpenUntilMs && now < circuitOpenUntilMs) return 'ERROR';
  const base = resolveBaseState();
  if ((base === 'READY' || base === 'CONNECTING') && busyCount > 0) return 'BUSY';
  return base;
};

const updateSnapshot = (note?: string) => {
  const state = computeState();
  snapshot = Object.freeze({
    state,
    connectionState,
    busyCount,
    lastUpdatedAtMs: Date.now(),
    lastErrorMessage,
    lastSuccessAtMs,
    circuitOpenUntilMs,
  });
  setTraceDeviceContext({
    deviceId: null,
    connectionState: state,
  });
  emit();
};

export const getDeviceStateSnapshot = () => snapshot;

export const subscribeDeviceState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const updateDeviceConnectionState = (next: ConnectionState) => {
  const previous = connectionState;
  connectionState = next;
  if (next !== previous && (next === 'REAL_CONNECTED' || next === 'DEMO_ACTIVE')) {
    hasSuccessfulRequest = false;
  }
  if (next === 'UNKNOWN' || next === 'DISCOVERING' || next === 'OFFLINE_NO_DEMO') {
    hasSuccessfulRequest = false;
  }
  updateSnapshot('connection-transition');
};

export const markDeviceRequestStart = () => {
  busyCount += 1;
  updateSnapshot('request-start');
};

export const markDeviceRequestEnd = (result: { success: boolean; errorMessage?: string | null }) => {
  busyCount = Math.max(0, busyCount - 1);
  if (result.success) {
    hasSuccessfulRequest = true;
    lastSuccessAtMs = Date.now();
    lastErrorMessage = null;
  } else if (result.errorMessage) {
    lastErrorMessage = result.errorMessage;
  }
  updateSnapshot(result.success ? 'request-success' : 'request-failure');
};

export const setCircuitOpenUntil = (untilMs: number | null, reason?: string) => {
  circuitOpenUntilMs = untilMs;
  if (untilMs) {
    lastErrorMessage = reason ?? lastErrorMessage;
  }
  updateSnapshot('circuit-change');
};
