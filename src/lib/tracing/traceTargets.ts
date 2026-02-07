import type { BackendDecisionReason, BackendTarget } from '@/lib/tracing/types';
import { getConnectionSnapshot, isRealDeviceStickyLockEnabled } from '@/lib/connection/connectionManager';
import { getC64APIConfigSnapshot } from '@/lib/c64api';
import { getActiveMockBaseUrl } from '@/lib/mock/mockServer';

const isTestProbeEnabled = () => {
  const env = (import.meta as ImportMeta).env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
  if (env?.VITE_ENABLE_TEST_PROBES === '1') return true;
  if (typeof window !== 'undefined') {
    const win = window as Window & { __c64uTestProbeEnabled?: boolean };
    if (win.__c64uTestProbeEnabled) return true;
  }
  if (typeof process !== 'undefined' && process.env?.VITE_ENABLE_TEST_PROBES === '1') return true;
  return false;
};

const normalizeUrl = (value?: string | null) => {
  if (!value) return '';
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
};

const resolveTestBaseUrl = () => {
  if (typeof window === 'undefined' || !isTestProbeEnabled()) return null;
  const win = window as Window & { __c64uExpectedBaseUrl?: string; __c64uMockServerBaseUrl?: string };
  return normalizeUrl(win.__c64uExpectedBaseUrl ?? win.__c64uMockServerBaseUrl ?? null) || null;
};

export const resolveBackendTarget = (baseUrl?: string | null): { target: BackendTarget; reason: BackendDecisionReason } => {
  const snapshot = getConnectionSnapshot();
  const runtimeBaseUrl = normalizeUrl(baseUrl ?? getC64APIConfigSnapshot().baseUrl);
  const activeMockUrl = normalizeUrl(getActiveMockBaseUrl());
  const testBaseUrl = resolveTestBaseUrl();

  if (isRealDeviceStickyLockEnabled()) {
    return { target: 'real-device', reason: snapshot.state === 'OFFLINE_NO_DEMO' ? 'fallback' : 'reachable' };
  }

  if (snapshot.state === 'DEMO_ACTIVE' || (activeMockUrl && runtimeBaseUrl && runtimeBaseUrl.startsWith(activeMockUrl))) {
    return { target: 'internal-mock', reason: 'demo-mode' };
  }

  if (testBaseUrl && runtimeBaseUrl && runtimeBaseUrl.startsWith(testBaseUrl)) {
    return { target: 'external-mock', reason: 'test-mode' };
  }

  return { target: 'real-device', reason: snapshot.state === 'OFFLINE_NO_DEMO' ? 'fallback' : 'reachable' };
};
