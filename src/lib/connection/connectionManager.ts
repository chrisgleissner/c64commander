/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  C64API,
  applyC64APIConfigFromStorage,
  applyC64APIRuntimeConfig,
  buildBaseUrlFromDeviceHost,
  getC64APIConfigSnapshot,
  getDeviceHostFromBaseUrl,
  resolveDeviceHostFromStorage,
} from '@/lib/c64api';
import { getPassword as loadStoredPassword } from '@/lib/secureStorage';
import { clearRuntimeFtpPortOverride, setRuntimeFtpPortOverride } from '@/lib/ftp/ftpConfig';
import { getActiveMockBaseUrl, getActiveMockFtpPort, startMockServer, stopMockServer } from '@/lib/mock/mockServer';
import {
  loadAutomaticDemoModeEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadStartupDiscoveryWindowMs,
} from '@/lib/config/appSettings';
import { loadDeviceSafetyConfig } from '@/lib/config/deviceSafetySettings';
import { applyFuzzModeDefaults, getFuzzMockBaseUrl, isFuzzModeEnabled } from '@/lib/fuzz/fuzzMode';
import { addLog } from '@/lib/logging';
import { getSmokeConfig, initializeSmokeMode, isSmokeModeEnabled, recordSmokeStatus } from '@/lib/smoke/smokeMode';
import { resetInteractionState } from '@/lib/deviceInteraction/deviceInteractionManager';
import { updateDeviceConnectionState } from '@/lib/deviceInteraction/deviceStateStore';

export type ConnectionState = 'UNKNOWN' | 'DISCOVERING' | 'REAL_CONNECTED' | 'DEMO_ACTIVE' | 'OFFLINE_NO_DEMO';
export type DiscoveryTrigger = 'startup' | 'manual' | 'settings' | 'background';

export type ConnectionSnapshot = Readonly<{
  state: ConnectionState;
  lastDiscoveryTrigger: DiscoveryTrigger | null;
  lastTransitionAtMs: number;
  lastProbeAtMs: number | null;
  lastProbeSucceededAtMs: number | null;
  lastProbeFailedAtMs: number | null;
  lastProbeError: string | null;
  demoInterstitialVisible: boolean;
}>;

const STARTUP_PROBE_INTERVAL_MS = 700;
const PROBE_REQUEST_TIMEOUT_MS = 2500;

const isTestProbeEnabled = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1') return true;
  if (typeof window !== 'undefined') {
    const win = window as Window & { __c64uTestProbeEnabled?: boolean };
    if (win.__c64uTestProbeEnabled) return true;
  }
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

const isRuntimeUsingTestTarget = (runtimeBaseUrl: string) => {
  const testBaseUrl = resolveTestBaseUrl();
  return Boolean(testBaseUrl && runtimeBaseUrl.startsWith(testBaseUrl));
};

const loadPersistedConnectionConfig = async () => {
  const password = await loadStoredPassword();
  const deviceHost = resolveDeviceHostFromStorage();
  const baseUrl = buildBaseUrlFromDeviceHost(deviceHost);
  return { baseUrl, password: password ?? undefined, deviceHost };
};


const isProbePayloadHealthy = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return false;
  const maybeErrors = (payload as { errors?: unknown }).errors;
  if (Array.isArray(maybeErrors) && maybeErrors.length > 0) return false;
  const product = (payload as { product?: unknown }).product;
  if (typeof product === 'string') {
    return product.trim().length > 0;
  }
  return true;
};

const parseProbePayload = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
};

const probeWithFetch = async (
  baseUrl: string,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<boolean> => {
  const timeoutMs = options.timeoutMs ?? loadDiscoveryProbeTimeoutMs();
  const outerSignal = options.signal;
  const controller = timeoutMs ? new AbortController() : null;
  const abortFromOuter = () => controller?.abort();
  if (outerSignal && controller) {
    if (outerSignal.aborted) {
      controller.abort();
    } else {
      outerSignal.addEventListener('abort', abortFromOuter, { once: true });
    }
  }
  const timeoutId = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${baseUrl}/v1/info`, {
      ...(controller ? { signal: controller.signal } : outerSignal ? { signal: outerSignal } : {}),
    });
    const payload = await parseProbePayload(response);
    if (!response.ok) return false;
    return isProbePayloadHealthy(payload);
  } catch {
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (outerSignal && controller) {
      outerSignal.removeEventListener('abort', abortFromOuter);
    }
  }
};

export async function probeOnce(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean> {
  const config = await loadPersistedConnectionConfig();
  const timeoutMs = options.timeoutMs ?? loadDiscoveryProbeTimeoutMs();
  const outerSignal = options.signal;
  const isTestEnv = typeof process !== 'undefined'
    && (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test');

  if (isTestEnv) {
    return probeWithFetch(config.baseUrl, { signal: outerSignal, timeoutMs });
  }

  try {
    const api = new C64API(config.baseUrl, config.password, config.deviceHost);
    const response = await api.getInfo({
      timeoutMs,
      signal: outerSignal,
      __c64uIntent: 'system',
      __c64uAllowDuringDiscovery: true,
      __c64uBypassCache: true,
      __c64uBypassCooldown: true,
      __c64uBypassBackoff: true,
    });
    return isProbePayloadHealthy(response);
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? '';
    if (/^HTTP\s+\d+/.test(message)) {
      return false;
    }
    try {
      return await probeWithFetch(config.baseUrl, { signal: outerSignal, timeoutMs });
    } catch {
      return false;
    }
  }
}

let snapshot: ConnectionSnapshot = {
  state: 'UNKNOWN',
  lastDiscoveryTrigger: null,
  lastTransitionAtMs: Date.now(),
  lastProbeAtMs: null,
  lastProbeSucceededAtMs: null,
  lastProbeFailedAtMs: null,
  lastProbeError: null,
  demoInterstitialVisible: false,
};

const listeners = new Set<() => void>();
let activeDiscovery: { abort: AbortController; cancel: () => void } | null = null;
let demoInterstitialShownThisSession = false;
let demoServerStartedThisSession = false;
const DEMO_INTERSTITIAL_SESSION_KEY = 'c64u_demo_interstitial_shown';
let stickyRealDeviceLock = false;

const emit = () => {
  listeners.forEach((listener) => listener());
};

const setSnapshot = (patch: Partial<ConnectionSnapshot>) => {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  emit();
};

export function getConnectionSnapshot(): ConnectionSnapshot {
  return snapshot;
}

export const isRealDeviceStickyLockEnabled = () => stickyRealDeviceLock;

export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissDemoInterstitial() {
  demoInterstitialShownThisSession = true;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(DEMO_INTERSTITIAL_SESSION_KEY, '1');
    } catch (error) {
      addLog('warn', 'Failed to persist demo interstitial session marker', {
        error: (error as Error).message,
      });
    }
  }
  setSnapshot({ demoInterstitialVisible: false });
}

const cancelActiveDiscovery = () => {
  if (!activeDiscovery) return;
  try {
    activeDiscovery.abort.abort();
  } catch {
    // ignore
  }
  activeDiscovery.cancel();
  activeDiscovery = null;
};

const stopDemoServer = async () => {
  try {
    await stopMockServer();
  } finally {
    demoServerStartedThisSession = false;
    clearRuntimeFtpPortOverride();
    await applyC64APIConfigFromStorage();
  }
};

const transitionTo = (state: ConnectionState, trigger: DiscoveryTrigger | null) => {
  setSnapshot({
    state,
    lastDiscoveryTrigger: trigger,
    lastTransitionAtMs: Date.now(),
  });
  updateDeviceConnectionState(state);
};

const logDiscoveryDecision = (state: ConnectionState, trigger: DiscoveryTrigger | null, details?: Record<string, unknown>) => {
  addLog('info', 'Discovery decision', { state, trigger, ...details });
  if (isSmokeModeEnabled()) {
    console.info('C64U_DISCOVERY_DECISION', JSON.stringify({ state, trigger, ...details }));
    void recordSmokeStatus({
      state,
      mode: typeof details?.mode === 'string' ? details.mode : undefined,
      baseUrl: typeof details?.baseUrl === 'string' ? details.baseUrl : undefined,
    });
  }
};

const transitionToRealConnected = async (trigger: DiscoveryTrigger) => {
  cancelActiveDiscovery();
  dismissDemoInterstitial();
  resetInteractionState('transition-real-connected');
  transitionTo('REAL_CONNECTED', trigger);
  logDiscoveryDecision('REAL_CONNECTED', trigger, { mode: 'real' });
  await stopDemoServer();
  await applyC64APIConfigFromStorage();
  const runtimeBaseUrl = normalizeUrl(getC64APIConfigSnapshot().baseUrl);
  const activeMockUrl = normalizeUrl(getActiveMockBaseUrl());
  if (!activeMockUrl && runtimeBaseUrl && !isRuntimeUsingTestTarget(runtimeBaseUrl)) {
    stickyRealDeviceLock = true;
  }
  addLog('info', 'Connection switched to real device', { trigger });
};

const transitionToOfflineNoDemo = async (trigger: DiscoveryTrigger) => {
  cancelActiveDiscovery();
  dismissDemoInterstitial();
  resetInteractionState('transition-offline');
  transitionTo('OFFLINE_NO_DEMO', trigger);
  logDiscoveryDecision('OFFLINE_NO_DEMO', trigger, { mode: 'offline' });
  await stopDemoServer();
  await applyC64APIConfigFromStorage();
  addLog('info', 'Connection switched to offline', { trigger });
};

const shouldShowDemoInterstitial = (trigger: DiscoveryTrigger) =>
  trigger !== 'background' && !demoInterstitialShownThisSession;

const transitionToDemoActive = async (trigger: DiscoveryTrigger) => {
  if (stickyRealDeviceLock) {
    addLog('warn', 'Sticky real-device lock active; skipping demo mode transition', { trigger });
    await transitionToOfflineNoDemo(trigger);
    return;
  }
  cancelActiveDiscovery();
  resetInteractionState('transition-demo-active');
  transitionTo('DEMO_ACTIVE', trigger);
  logDiscoveryDecision('DEMO_ACTIVE', trigger, { mode: 'demo' });

  const shouldShowInterstitial = shouldShowDemoInterstitial(trigger);
  if (shouldShowInterstitial) {
    demoInterstitialShownThisSession = true;
    sessionStorage.setItem(DEMO_INTERSTITIAL_SESSION_KEY, '1');
    setSnapshot({ demoInterstitialVisible: true });
  }

  if (isFuzzModeEnabled()) {
    const fuzzBaseUrl = getFuzzMockBaseUrl();
    if (fuzzBaseUrl) {
      const mockHost = getDeviceHostFromBaseUrl(fuzzBaseUrl);
      applyC64APIRuntimeConfig(fuzzBaseUrl, undefined, mockHost);
      addLog('info', 'Fuzz mode using forced mock base URL', { trigger, baseUrl: fuzzBaseUrl });
      return;
    }
  }

  const hasMockServerOverride = typeof window !== 'undefined'
    && Boolean((window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl);
  const shouldStartDemoServer = !demoServerStartedThisSession && (!isTestProbeEnabled() || hasMockServerOverride);

  if (shouldStartDemoServer) {
    try {
      const { baseUrl, ftpPort } = await startMockServer();
      demoServerStartedThisSession = true;
      const mockHost = getDeviceHostFromBaseUrl(baseUrl);
      applyC64APIRuntimeConfig(baseUrl, undefined, mockHost);
      if (ftpPort) setRuntimeFtpPortOverride(ftpPort);
    } catch (error) {
      // On non-native platforms the internal demo servers may be unavailable.
      // Still enter DEMO_ACTIVE for deterministic UI/state behavior.
      setSnapshot({ lastProbeError: (error as Error).message });
      addLog('info', 'Demo mode mock server unavailable', {
        error: (error as Error).message,
      });
    }
  }

  const activeMockUrl = getActiveMockBaseUrl();
  if (activeMockUrl) {
    const mockHost = getDeviceHostFromBaseUrl(activeMockUrl);
    applyC64APIRuntimeConfig(activeMockUrl, undefined, mockHost);
    const activeFtpPort = getActiveMockFtpPort();
    if (activeFtpPort) setRuntimeFtpPortOverride(activeFtpPort);
    addLog('info', 'Demo mode using mock C64U', { trigger, baseUrl: activeMockUrl });
  } else {
    const fallbackHost = resolveDeviceHostFromStorage();
    const fallbackBaseUrl = buildBaseUrlFromDeviceHost(fallbackHost);
    applyC64APIRuntimeConfig(fallbackBaseUrl, undefined, fallbackHost);
    addLog('info', 'Demo mode using stored device host', { trigger, baseUrl: fallbackBaseUrl });
  }

  // Interstitial is already surfaced above to avoid waiting on mock server startup.
};

const transitionToSmokeMockConnected = async (trigger: DiscoveryTrigger) => {
  cancelActiveDiscovery();
  dismissDemoInterstitial();
  const { baseUrl, ftpPort } = await startMockServer();
  demoServerStartedThisSession = true;
  const mockHost = getDeviceHostFromBaseUrl(baseUrl);
  applyC64APIRuntimeConfig(baseUrl, undefined, mockHost);
  if (ftpPort) setRuntimeFtpPortOverride(ftpPort);
  setSnapshot({
    lastProbeAtMs: Date.now(),
    lastProbeSucceededAtMs: Date.now(),
    lastProbeFailedAtMs: null,
    lastProbeError: null,
    demoInterstitialVisible: false,
  });
  transitionTo('REAL_CONNECTED', trigger);
  logDiscoveryDecision('REAL_CONNECTED', trigger, { mode: 'mock', baseUrl });
  if (isSmokeModeEnabled()) {
    console.info('C64U_SMOKE_MOCK_CONNECTED', JSON.stringify({ baseUrl, host: mockHost }));
  }
};

/**
 * Centralized discovery entry point used for:
 * - App startup
 * - Manual icon-triggered switching
 * - Background rediscovery
 * - Settings-triggered rediscovery
 */
export async function discoverConnection(trigger: DiscoveryTrigger): Promise<void> {
  cancelActiveDiscovery();

  const smokeConfig = getSmokeConfig();
  if (smokeConfig) {
    addLog('info', 'Smoke discovery override active', { target: smokeConfig.target, host: smokeConfig.host });
    if (isSmokeModeEnabled()) {
      console.info('C64U_SMOKE_DISCOVERY_OVERRIDE', JSON.stringify({ target: smokeConfig.target, host: smokeConfig.host }));
    }
  }
  if (smokeConfig?.target === 'mock') {
    await transitionToSmokeMockConnected(trigger);
    return;
  }

  if (isFuzzModeEnabled()) {
    await transitionToDemoActive(trigger);
    return;
  }

  if (trigger === 'background') {
    if (snapshot.state !== 'DEMO_ACTIVE' && snapshot.state !== 'OFFLINE_NO_DEMO') return;
    const abort = new AbortController();
    activeDiscovery = { abort, cancel: () => { } };
    setSnapshot({ lastDiscoveryTrigger: trigger });
    const ok = await probeOnce({ signal: abort.signal });
    setSnapshot({ lastProbeAtMs: Date.now() });
    if (ok) {
      setSnapshot({ lastProbeSucceededAtMs: Date.now(), lastProbeError: null });
      addLog('info', 'Discovery probe succeeded', { trigger });
      if (isSmokeModeEnabled()) {
        console.info('C64U_PROBE_OK', JSON.stringify({ trigger }));
      }
      if (snapshot.state === 'DEMO_ACTIVE') {
        addLog('info', 'Real device detected during demo mode', { trigger });
      }
      await transitionToRealConnected(trigger);
    } else {
      setSnapshot({ lastProbeFailedAtMs: Date.now() });
      addLog('warn', 'Discovery probe failed', { trigger });
      if (isSmokeModeEnabled()) {
        console.warn('C64U_PROBE_FAILED', JSON.stringify({ trigger }));
      }
    }
    activeDiscovery = null;
    return;
  }

  transitionTo('DISCOVERING', trigger);

  const abort = new AbortController();
  let cancelled = false;
  let probeInFlight = false;
  const autoDemoEnabled = loadAutomaticDemoModeEnabled() && !isSmokeModeEnabled();

  const windowMs = loadStartupDiscoveryWindowMs();
  let windowExpired = false;
  const handleWindowExpiry = async () => {
    if (cancelled) return;
    cancelled = true;
    globalThis.clearInterval(probeTimer);
    cancelActiveDiscovery();
    if (autoDemoEnabled) {
      await transitionToDemoActive(trigger);
    } else {
      await transitionToOfflineNoDemo(trigger);
    }
  };
  const windowTimer = globalThis.setTimeout(() => {
    void (async () => {
      if (cancelled) return;
      windowExpired = true;
      await handleWindowExpiry();
    })();
  }, windowMs);

  const runProbe = async () => {
    if (cancelled || probeInFlight) return;
    probeInFlight = true;
    setSnapshot({ lastProbeAtMs: Date.now() });
    const ok = await probeOnce({ signal: abort.signal });
    probeInFlight = false;
    if (cancelled) return;
    if (ok) {
      setSnapshot({ lastProbeSucceededAtMs: Date.now(), lastProbeError: null });
      addLog('info', 'Discovery probe succeeded', { trigger });
      if (isSmokeModeEnabled()) {
        console.info('C64U_PROBE_OK', JSON.stringify({ trigger }));
      }
      cancelled = true;
      globalThis.clearTimeout(windowTimer);
      globalThis.clearInterval(probeTimer);
      await transitionToRealConnected(trigger);
    } else {
      if (windowExpired) {
        await handleWindowExpiry();
        return;
      }
      setSnapshot({ lastProbeFailedAtMs: Date.now() });
      if (isSmokeModeEnabled()) {
        console.warn('C64U_PROBE_FAILED', JSON.stringify({ trigger }));
      }
    }
  };

  // First probe immediately, then at fixed interval.
  void runProbe();
  const probeTimer = globalThis.setInterval(() => {
    void runProbe();
  }, loadDeviceSafetyConfig().discoveryProbeIntervalMs);

  activeDiscovery = {
    abort,
    cancel: () => {
      cancelled = true;
      globalThis.clearTimeout(windowTimer);
      globalThis.clearInterval(probeTimer);
    },
  };
}

export async function initializeConnectionManager() {
  cancelActiveDiscovery();
  applyFuzzModeDefaults();
  await initializeSmokeMode();
  demoInterstitialShownThisSession = sessionStorage.getItem(DEMO_INTERSTITIAL_SESSION_KEY) === '1';
  stickyRealDeviceLock = false;
  setSnapshot({
    state: 'UNKNOWN',
    lastDiscoveryTrigger: null,
    lastTransitionAtMs: Date.now(),
    lastProbeAtMs: null,
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
    lastProbeError: null,
    demoInterstitialVisible: false,
  });
  updateDeviceConnectionState('UNKNOWN');

  // Ensure outcomes never persist across cold starts.
  await stopDemoServer().catch(() => { });
  await applyC64APIConfigFromStorage();
}

export const CONNECTION_CONSTANTS = {
  STARTUP_PROBE_INTERVAL_MS,
  PROBE_REQUEST_TIMEOUT_MS,
};

