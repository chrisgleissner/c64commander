import {
  C64API,
  applyC64APIConfigFromStorage,
  applyC64APIRuntimeConfig,
  buildBaseUrlFromDeviceHost,
  getDeviceHostFromBaseUrl,
  resolveDeviceHostFromStorage,
} from '@/lib/c64api';
import { clearRuntimeFtpPortOverride, setRuntimeFtpPortOverride } from '@/lib/ftp/ftpConfig';
import { getActiveMockBaseUrl, getActiveMockFtpPort, startMockServer, stopMockServer } from '@/lib/mock/mockServer';
import {
  loadAutomaticDemoModeEnabled,
  loadStartupDiscoveryWindowMs,
} from '@/lib/config/appSettings';
import { applyFuzzModeDefaults, getFuzzMockBaseUrl, isFuzzModeEnabled } from '@/lib/fuzz/fuzzMode';
import { addLog } from '@/lib/logging';
import { getSmokeConfig, initializeSmokeMode, isSmokeModeEnabled, recordSmokeStatus } from '@/lib/smoke/smokeMode';

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

const STARTUP_PROBE_INTERVAL_MS = 500;
const PROBE_REQUEST_TIMEOUT_MS = 2500;

const isLocalProxy = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
};

const loadPersistedConnectionConfig = () => {
  const passwordRaw = localStorage.getItem('c64u_password');
  const password = passwordRaw ? passwordRaw : undefined;
  const deviceHost = resolveDeviceHostFromStorage();
  const baseUrl = buildBaseUrlFromDeviceHost(deviceHost);
  return { baseUrl, password, deviceHost };
};

const buildProbeHeaders = (config: { baseUrl: string; password?: string; deviceHost: string }) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.password) headers['X-Password'] = config.password;
  if (config.deviceHost && isLocalProxy(config.baseUrl)) headers['X-C64U-Host'] = config.deviceHost;
  return headers;
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

const isNativePlatform = () => {
  try {
    return Boolean((window as any)?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
};

export async function probeOnce(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean> {
  const config = loadPersistedConnectionConfig();
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/info`;
  const timeoutMs = options.timeoutMs ?? PROBE_REQUEST_TIMEOUT_MS;
  const outerSignal = options.signal;

  if (isNativePlatform()) {
    if (outerSignal?.aborted) return false;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
    }, timeoutMs);
    try {
      const api = new C64API(config.baseUrl, config.password, config.deviceHost);
      const response = await api.getInfo();
      if (timedOut) return false;
      return isProbePayloadHealthy(response);
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  const requestController = new AbortController();
  const abort = () => requestController.abort();
  if (outerSignal) {
    if (outerSignal.aborted) abort();
    else outerSignal.addEventListener('abort', abort, { once: true });
  }
  const timeoutId = window.setTimeout(() => requestController.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildProbeHeaders(config),
      signal: requestController.signal,
    });
    if (!response.ok) return false;
    const payload = (await response.json().catch(() => null)) as unknown;
    return isProbePayloadHealthy(payload);
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
    if (outerSignal) outerSignal.removeEventListener('abort', abort);
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

export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissDemoInterstitial() {
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
    applyC64APIConfigFromStorage();
  }
};

const transitionTo = (state: ConnectionState, trigger: DiscoveryTrigger | null) => {
  setSnapshot({
    state,
    lastDiscoveryTrigger: trigger,
    lastTransitionAtMs: Date.now(),
  });
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
  await stopDemoServer();
  applyC64APIConfigFromStorage();
  addLog('info', 'Connection switched to real device', { trigger });
  transitionTo('REAL_CONNECTED', trigger);
  logDiscoveryDecision('REAL_CONNECTED', trigger, { mode: 'real' });
};

const transitionToOfflineNoDemo = async (trigger: DiscoveryTrigger) => {
  cancelActiveDiscovery();
  dismissDemoInterstitial();
  await stopDemoServer();
  applyC64APIConfigFromStorage();
  addLog('info', 'Connection switched to offline', { trigger });
  transitionTo('OFFLINE_NO_DEMO', trigger);
  logDiscoveryDecision('OFFLINE_NO_DEMO', trigger, { mode: 'offline' });
};

const shouldShowDemoInterstitial = (trigger: DiscoveryTrigger) =>
  trigger !== 'background' && !demoInterstitialShownThisSession;

const transitionToDemoActive = async (trigger: DiscoveryTrigger) => {
  cancelActiveDiscovery();
  transitionTo('DEMO_ACTIVE', trigger);
  logDiscoveryDecision('DEMO_ACTIVE', trigger, { mode: 'demo' });

  if (isFuzzModeEnabled()) {
    const fuzzBaseUrl = getFuzzMockBaseUrl();
    if (fuzzBaseUrl) {
      const mockHost = getDeviceHostFromBaseUrl(fuzzBaseUrl);
      applyC64APIRuntimeConfig(fuzzBaseUrl, undefined, mockHost);
      addLog('info', 'Fuzz mode using forced mock base URL', { trigger, baseUrl: fuzzBaseUrl });
      return;
    }
  }

  if (!demoServerStartedThisSession) {
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
    const fallbackHost = 'localhost';
    const fallbackBaseUrl = buildBaseUrlFromDeviceHost(fallbackHost);
    applyC64APIRuntimeConfig(fallbackBaseUrl, undefined, fallbackHost);
    addLog('info', 'Demo mode using localhost fallback', { trigger, baseUrl: fallbackBaseUrl });
  }

  if (shouldShowDemoInterstitial(trigger)) {
    demoInterstitialShownThisSession = true;
    sessionStorage.setItem(DEMO_INTERSTITIAL_SESSION_KEY, '1');
    setSnapshot({ demoInterstitialVisible: true });
  }
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
    activeDiscovery = { abort, cancel: () => {} };
    setSnapshot({ lastDiscoveryTrigger: trigger });
    const ok = await probeOnce({ signal: abort.signal });
    setSnapshot({ lastProbeAtMs: Date.now() });
    if (ok) {
      setSnapshot({ lastProbeSucceededAtMs: Date.now(), lastProbeError: null });
      addLog('info', 'Discovery probe succeeded', { trigger });
      if (isSmokeModeEnabled()) {
        console.info('C64U_PROBE_OK', JSON.stringify({ trigger }));
      }
      if (snapshot.state !== 'DEMO_ACTIVE') {
        await transitionToRealConnected(trigger);
      } else {
        addLog('info', 'Real device detected during demo mode', { trigger });
      }
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
  const windowTimer = window.setTimeout(() => {
    void (async () => {
      if (cancelled) return;
      cancelled = true;
      window.clearInterval(probeTimer);
      cancelActiveDiscovery();
      if (autoDemoEnabled) {
        await transitionToDemoActive(trigger);
      } else {
        await transitionToOfflineNoDemo(trigger);
      }
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
      window.clearTimeout(windowTimer);
      window.clearInterval(probeTimer);
      await transitionToRealConnected(trigger);
    } else {
      setSnapshot({ lastProbeFailedAtMs: Date.now() });
      if (isSmokeModeEnabled()) {
        console.warn('C64U_PROBE_FAILED', JSON.stringify({ trigger }));
      }
    }
  };

  // First probe immediately, then at fixed interval.
  void runProbe();
  const probeTimer = window.setInterval(runProbe, STARTUP_PROBE_INTERVAL_MS);

  activeDiscovery = {
    abort,
    cancel: () => {
      cancelled = true;
      window.clearTimeout(windowTimer);
      window.clearInterval(probeTimer);
    },
  };
}

export async function initializeConnectionManager() {
  cancelActiveDiscovery();
  applyFuzzModeDefaults();
  await initializeSmokeMode();
  demoInterstitialShownThisSession = sessionStorage.getItem(DEMO_INTERSTITIAL_SESSION_KEY) === '1';
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

  // Ensure outcomes never persist across cold starts.
  await stopDemoServer().catch(() => {});
  applyC64APIConfigFromStorage();
}

export const CONNECTION_CONSTANTS = {
  STARTUP_PROBE_INTERVAL_MS,
  PROBE_REQUEST_TIMEOUT_MS,
};

