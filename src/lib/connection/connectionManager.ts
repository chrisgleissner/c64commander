/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  C64API,
  type DeviceInfo,
  applyC64APIConfigFromStorage,
  applyC64APIRuntimeConfig,
  buildBaseUrlFromDeviceHost,
  getC64APIConfigSnapshot,
  getDeviceHostFromBaseUrl,
  resolveDeviceHostFromStorage,
} from "@/lib/c64api";
import { buildDeviceHostWithHttpPort, getDeviceHostHttpPort, stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { getPassword as loadStoredPassword } from "@/lib/secureStorage";
import { clearRuntimeFtpPortOverride, setRuntimeFtpPortOverride } from "@/lib/ftp/ftpConfig";
import { getActiveMockBaseUrl, getActiveMockFtpPort, startMockServer, stopMockServer } from "@/lib/mock/mockServer";
import {
  loadAutomaticDemoModeEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadStartupDiscoveryWindowMs,
} from "@/lib/config/appSettings";
import { featureFlagManager } from "@/lib/config/featureFlags";
import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";
import { applyFuzzModeDefaults, getFuzzMockBaseUrl, isFuzzModeEnabled } from "@/lib/fuzz/fuzzMode";
import { addLog } from "@/lib/logging";
import { getSmokeConfig, initializeSmokeMode, isSmokeModeEnabled, recordSmokeStatus } from "@/lib/smoke/smokeMode";
import { resetInteractionState } from "@/lib/deviceInteraction/deviceInteractionManager";
import { updateDeviceConnectionState } from "@/lib/deviceInteraction/deviceStateStore";
import { isBareHostname, isMdnsAvailable, resolveMdnsHost } from "@/lib/native/mdnsResolver";
import { normalizeTransportError } from "@/lib/c64api/transportErrors";
import { clearConnectivityErrorToastsForHost } from "@/lib/uiErrors";
import { registerReachabilityListener, type ReachabilitySource } from "@/lib/connection/reachabilityEvents";
import {
  completeSavedDeviceVerification,
  getSavedDevicesSnapshot,
  getSelectedSavedDevice,
  resolveCanonicalProductFamilyCode,
} from "@/lib/savedDevices/store";

export type ConnectionState = "UNKNOWN" | "DISCOVERING" | "REAL_CONNECTED" | "DEMO_ACTIVE" | "OFFLINE_NO_DEMO";
export type DiscoveryTrigger = "startup" | "manual" | "settings" | "background" | "switch" | "resume";

export type ProbeInfoResult = {
  ok: boolean;
  deviceInfo: DeviceInfo | null;
  error: string | null;
  resolvedAddress?: string | null;
};

export type ConnectionSnapshot = Readonly<{
  state: ConnectionState;
  lastDiscoveryTrigger: DiscoveryTrigger | null;
  lastTransitionAtMs: number;
  lastProbeAtMs: number | null;
  lastProbeSucceededAtMs: number | null;
  lastProbeFailedAtMs: number | null;
  lastProbeError: string | null;
  deviceInfo: DeviceInfo | null;
  demoInterstitialVisible: boolean;
}>;

const STARTUP_PROBE_INTERVAL_MS = 700;
const PROBE_REQUEST_TIMEOUT_MS = 2500;

const isTestProbeEnabled = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return true;
  if (typeof window !== "undefined") {
    const win = window as Window & { __c64uTestProbeEnabled?: boolean };
    if (win.__c64uTestProbeEnabled) return true;
  }
  return false;
};

const normalizeUrl = (value?: string | null) => {
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch (error) {
    addLog("warn", "Invalid URL encountered while normalizing", {
      value,
      error: (error as Error).message,
    });
    return value;
  }
};

const resolveTestBaseUrl = () => {
  if (typeof window === "undefined" || !isTestProbeEnabled()) return null;
  const win = window as Window & {
    __c64uExpectedBaseUrl?: string;
    __c64uMockServerBaseUrl?: string;
  };
  return normalizeUrl(win.__c64uExpectedBaseUrl ?? win.__c64uMockServerBaseUrl ?? null) || null;
};

const isRuntimeUsingTestTarget = (runtimeBaseUrl: string) => {
  const testBaseUrl = resolveTestBaseUrl();
  return Boolean(testBaseUrl && runtimeBaseUrl.startsWith(testBaseUrl));
};

const isDemoModeAvailable = () => featureFlagManager.getSnapshot().flags.demo_mode_enabled;

const isDemoModeRequested = () => isDemoModeAvailable() && loadAutomaticDemoModeEnabled() && !isSmokeModeEnabled();

const mdnsResolutionCache = new Map<string, { ip: string; expiresAtMs: number }>();

const resolveDeviceHostForProbe = async (deviceHost: string): Promise<string> => {
  if (!isMdnsAvailable()) return deviceHost;
  if (!isBareHostname(deviceHost)) return deviceHost;

  const cached = mdnsResolutionCache.get(deviceHost);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.ip;
  }

  try {
    const resolved = await resolveMdnsHost(deviceHost, { timeoutMs: 1500 });
    mdnsResolutionCache.set(deviceHost, {
      ip: resolved.ip,
      expiresAtMs: Date.now() + Math.max(1000, resolved.ttlMs),
    });
    addLog("info", "Resolved bare hostname via mDNS", {
      host: deviceHost,
      resolvedHost: resolved.resolvedHost,
      ip: resolved.ip,
    });
    return resolved.ip;
  } catch (error) {
    const failure = normalizeTransportError(error, { host: deviceHost });
    addLog("warn", "mDNS resolution failed; falling back to system DNS", {
      host: deviceHost,
      class: failure.class,
      message: failure.userMessage,
      raw: failure.rawMessage,
    });
    return deviceHost;
  }
};

const loadPersistedConnectionConfig = async () => {
  const password = await loadStoredPassword();
  const deviceHost = resolveDeviceHostFromStorage();
  const probeHost = await resolveDeviceHostForProbe(deviceHost);
  const baseUrl = buildBaseUrlFromDeviceHost(probeHost === deviceHost ? deviceHost : probeHost);
  return { baseUrl, password: password ?? undefined, deviceHost };
};

const loadSwitchConnectionConfig = async (options: {
  deviceHost: string;
  password?: string | null;
  preferResolvedAddress?: string | null;
}) => {
  const password = options.password ?? undefined;
  const rawDeviceHost = options.deviceHost;
  const rawHost = stripPortFromDeviceHost(rawDeviceHost);
  const httpPort = getDeviceHostHttpPort(rawDeviceHost);
  const resolvedAddress = options.preferResolvedAddress?.trim() || null;
  const probeDeviceHost = resolvedAddress
    ? buildDeviceHostWithHttpPort(resolvedAddress, httpPort)
    : await resolveDeviceHostForProbe(rawHost).then((resolvedHost) =>
        buildDeviceHostWithHttpPort(stripPortFromDeviceHost(resolvedHost), httpPort),
      );

  return {
    baseUrl: buildBaseUrlFromDeviceHost(probeDeviceHost),
    password,
    deviceHost: rawDeviceHost,
    probeDeviceHost,
    resolvedAddress:
      stripPortFromDeviceHost(probeDeviceHost) !== rawHost ? stripPortFromDeviceHost(probeDeviceHost) : null,
  };
};

const probeInfoWithConnectionConfig = async (
  config: Awaited<ReturnType<typeof loadSwitchConnectionConfig>>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeInfoResult> => {
  const timeoutMs = options.timeoutMs ?? loadDiscoveryProbeTimeoutMs();
  const outerSignal = options.signal;
  try {
    const api = new C64API(config.baseUrl, config.password, config.probeDeviceHost);
    const response = await api.getInfo({
      timeoutMs,
      signal: outerSignal,
      __c64uIntent: "system",
      __c64uAllowDuringDiscovery: true,
      __c64uAllowDuringError: true,
      __c64uBypassCache: true,
    });
    return {
      ok: isProbePayloadHealthy(response),
      deviceInfo: response,
      error: isProbePayloadHealthy(response) ? null : "Probe payload missing required identity",
      resolvedAddress: config.resolvedAddress,
    };
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? "Unknown probe failure";
    if (/^HTTP\s+\d+/.test(message)) {
      return {
        ok: false,
        deviceInfo: null,
        error: message,
        resolvedAddress: config.resolvedAddress,
      };
    }
    return {
      ok: false,
      deviceInfo: null,
      error: message,
      resolvedAddress: config.resolvedAddress,
    };
  }
};

const isProbePayloadHealthy = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return false;
  const maybeErrors = (payload as { errors?: unknown }).errors;
  if (Array.isArray(maybeErrors) && maybeErrors.length > 0) return false;
  const product = (payload as { product?: unknown }).product;
  return typeof product === "string" && product.trim().length > 0;
};

export async function probeOnce(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean> {
  const config = await loadPersistedConnectionConfig();
  const timeoutMs = options.timeoutMs ?? loadDiscoveryProbeTimeoutMs();
  const outerSignal = options.signal;

  try {
    const api = new C64API(config.baseUrl, config.password, config.deviceHost);
    const response = await api.getInfo({
      timeoutMs,
      signal: outerSignal,
      __c64uIntent: "system",
      __c64uAllowDuringDiscovery: true,
      __c64uAllowDuringError: true,
      __c64uBypassCache: true,
    });
    return isProbePayloadHealthy(response);
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? "";
    if (!/^HTTP\s+\d+/.test(message)) {
      const host = (() => {
        try {
          return new URL(config.baseUrl).hostname;
        } catch (hostError) {
          addLog("debug", "Failed to parse discovery probe base URL host", {
            baseUrl: config.baseUrl,
            error: (hostError as Error).message,
            stack: (hostError as Error).stack ?? null,
          });
          return undefined;
        }
      })();
      const failure = normalizeTransportError(error, { host });
      addLog(failure.class === "dns" ? "info" : "debug", "Discovery probe request failed", {
        baseUrl: config.baseUrl,
        class: failure.class,
        userMessage: failure.userMessage,
        error: failure.rawMessage,
      });
      setSnapshot({ lastProbeError: failure.userMessage });
    }
    return false;
  }
}

export async function probeInfoOnce(
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeInfoResult> {
  const config = await loadPersistedConnectionConfig();
  const timeoutMs = options.timeoutMs ?? loadDiscoveryProbeTimeoutMs();
  const outerSignal = options.signal;

  try {
    const api = new C64API(config.baseUrl, config.password, config.deviceHost);
    const response = await api.getInfo({
      timeoutMs,
      signal: outerSignal,
      __c64uIntent: "system",
      __c64uAllowDuringDiscovery: true,
      __c64uAllowDuringError: true,
      __c64uBypassCache: true,
    });
    return {
      ok: isProbePayloadHealthy(response),
      deviceInfo: response,
      error: isProbePayloadHealthy(response) ? null : "Probe payload missing required identity",
    };
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? "Unknown probe failure";
    if (/^HTTP\s+\d+/.test(message)) {
      return {
        ok: false,
        deviceInfo: null,
        error: message,
      };
    }
    return {
      ok: false,
      deviceInfo: null,
      error: message,
    };
  }
}

export async function verifyCurrentConnectionTarget(options?: {
  deviceHost?: string;
  password?: string | null;
  preferResolvedAddress?: string | null;
}): Promise<ProbeInfoResult> {
  clearPinnedDemoMode();
  const discoveryRun = beginDiscoveryRun("switch");
  cancelActiveDiscovery();
  transitionTo("DISCOVERING", "switch");
  setSnapshot({
    lastDiscoveryTrigger: "switch",
    lastProbeAtMs: Date.now(),
    lastProbeError: null,
    deviceInfo: null,
  });
  const switchConfig =
    typeof options?.deviceHost === "string"
      ? await loadSwitchConnectionConfig({
          deviceHost: options.deviceHost,
          password: options.password,
          preferResolvedAddress: options.preferResolvedAddress,
        })
      : null;
  const result = switchConfig
    ? await probeInfoWithConnectionConfig(switchConfig, {
        timeoutMs: Math.max(1000, loadDiscoveryProbeTimeoutMs()) + 1000,
      })
    : await probeInfoOnce({ timeoutMs: Math.max(1000, loadDiscoveryProbeTimeoutMs()) + 1000 });
  if (!discoveryRun.isCurrent()) {
    return result;
  }
  if (result.ok) {
    setSnapshot({ lastProbeSucceededAtMs: Date.now(), lastProbeError: null, deviceInfo: result.deviceInfo });
    await transitionToRealConnected(
      "switch",
      switchConfig
        ? {
            baseUrl: switchConfig.baseUrl,
            deviceHost: switchConfig.probeDeviceHost,
            password: switchConfig.password,
          }
        : undefined,
    );
    return result;
  }
  setSnapshot({
    lastProbeFailedAtMs: Date.now(),
    lastProbeError: result.error,
    deviceInfo: null,
  });
  if (isDemoModeRequested()) {
    await transitionToDemoActive("switch");
  } else {
    await transitionToOfflineNoDemo("switch");
  }
  return result;
}

let snapshot: ConnectionSnapshot = {
  state: "UNKNOWN",
  lastDiscoveryTrigger: null,
  lastTransitionAtMs: Date.now(),
  lastProbeAtMs: null,
  lastProbeSucceededAtMs: null,
  lastProbeFailedAtMs: null,
  lastProbeError: null,
  deviceInfo: null,
  demoInterstitialVisible: false,
};

const listeners = new Set<() => void>();
let activeDiscovery: { abort: AbortController; cancel: () => void } | null = null;
let demoInterstitialShownThisSession = false;
let demoServerStartedThisSession = false;
const DEMO_INTERSTITIAL_SESSION_KEY = "c64u_demo_interstitial_shown";
const DEMO_MODE_PINNED_SESSION_KEY = "c64u_demo_mode_pinned";
let stickyRealDeviceLock = false;
let discoveryRunToken = 0;
let demoModePinnedByUser = false;
let activeManualDiscovery: { trigger: DiscoveryTrigger; promise: Promise<void> } | null = null;

const emit = () => {
  listeners.forEach((listener) => listener());
};

const rememberSelectedSavedDeviceIdentity = (deviceInfo: DeviceInfo | null | undefined) => {
  const product = resolveCanonicalProductFamilyCode(deviceInfo?.product ?? null);
  if (!product) return;

  const selectedDevice = getSelectedSavedDevice();
  if (!selectedDevice) return;

  const hostname = deviceInfo?.hostname?.trim() || null;
  const uniqueId = deviceInfo?.unique_id?.trim() || null;
  const savedDevices = getSavedDevicesSnapshot();
  const summary = savedDevices.summaries[selectedDevice.id];
  const runtimeVerified = savedDevices.verifiedByDeviceId[selectedDevice.id] ?? null;

  if (
    selectedDevice.lastKnownProduct === product &&
    selectedDevice.lastKnownHostname === hostname &&
    selectedDevice.lastKnownUniqueId === uniqueId &&
    summary?.lastVerifiedProduct === product &&
    runtimeVerified?.product === product
  ) {
    return;
  }

  completeSavedDeviceVerification(selectedDevice.id, {
    product: deviceInfo?.product ?? product,
    hostname,
    unique_id: uniqueId,
  });
};

const setSnapshot = (patch: Partial<ConnectionSnapshot>) => {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  if (patch.deviceInfo) {
    rememberSelectedSavedDeviceIdentity(patch.deviceInfo);
  }
  emit();
};

const beginDiscoveryRun = (trigger: DiscoveryTrigger) => {
  const token = trigger === "background" ? discoveryRunToken : ++discoveryRunToken;
  return {
    isCurrent: () => token === discoveryRunToken,
  };
};

export function getConnectionSnapshot(): ConnectionSnapshot {
  return snapshot;
}

export const isRealDeviceStickyLockEnabled = () => stickyRealDeviceLock;

export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const normalizeReachabilityHost = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return stripPortFromDeviceHost(new URL(trimmed).host).toLowerCase();
  } catch {
    return stripPortFromDeviceHost(trimmed.replace(/^https?:\/\//, "")).toLowerCase();
  }
};

const getActiveReachabilityHosts = () => {
  const config = getC64APIConfigSnapshot();
  const hosts = [
    normalizeReachabilityHost(config.deviceHost),
    normalizeReachabilityHost(config.baseUrl),
    normalizeReachabilityHost(resolveDeviceHostFromStorage()),
  ].filter((host): host is string => host !== null);
  return new Set(hosts);
};

export const noteReachable = (host: string, source: ReachabilitySource, deviceInfo: DeviceInfo | null = null): void => {
  const normalizedHost = normalizeReachabilityHost(host);
  if (!normalizedHost) return;

  const activeHosts = getActiveReachabilityHosts();
  if (!activeHosts.has(normalizedHost)) {
    addLog("debug", "Ignoring reachable event for non-active host", {
      host: normalizedHost,
      source,
      activeHosts: Array.from(activeHosts),
    });
    return;
  }

  setSnapshot({
    lastProbeSucceededAtMs: Date.now(),
    lastProbeError: null,
    ...(deviceInfo ? { deviceInfo } : {}),
  });

  // Host recovery dismisses live connectivity-class error toasts attributed to
  // it (ERROR_POLICY §6); aliases of the active device are cleared together.
  for (const activeHost of activeHosts) {
    clearConnectivityErrorToastsForHost(activeHost);
  }

  if (snapshot.state !== "OFFLINE_NO_DEMO" && snapshot.state !== "DISCOVERING") {
    return;
  }

  const trigger = snapshot.lastDiscoveryTrigger ?? "background";
  addLog("info", "Reachable active device observed; promoting connection", {
    host: normalizedHost,
    source,
    previousState: snapshot.state,
    trigger,
  });
  void transitionToRealConnected(trigger);
};

registerReachabilityListener(noteReachable);

const installConnectionTestProbe = () => {
  if (typeof window === "undefined" || !isTestProbeEnabled()) return;
  (
    window as Window & {
      __c64uConnectionTestProbe?: {
        noteReachable: typeof noteReachable;
      };
    }
  ).__c64uConnectionTestProbe = {
    noteReachable,
  };
};

installConnectionTestProbe();

export function dismissDemoInterstitial() {
  demoInterstitialShownThisSession = true;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(DEMO_INTERSTITIAL_SESSION_KEY, "1");
    } catch (error) {
      addLog("warn", "Failed to persist demo interstitial session marker", {
        error: (error as Error).message,
      });
    }
  }
  setSnapshot({ demoInterstitialVisible: false });
}

const persistDemoModePinnedState = (pinned: boolean) => {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (pinned) {
      sessionStorage.setItem(DEMO_MODE_PINNED_SESSION_KEY, "1");
    } else {
      sessionStorage.removeItem(DEMO_MODE_PINNED_SESSION_KEY);
    }
  } catch (error) {
    addLog("warn", "Failed to persist demo mode pin state", {
      error: (error as Error).message,
      pinned,
    });
  }
};

const clearPinnedDemoMode = () => {
  demoModePinnedByUser = false;
  persistDemoModePinnedState(false);
};

export async function pinDemoModeByUserChoice() {
  demoModePinnedByUser = true;
  persistDemoModePinnedState(true);
  dismissDemoInterstitial();
  await transitionToDemoActive("manual");
}

const cancelActiveDiscovery = () => {
  if (!activeDiscovery) return;
  try {
    activeDiscovery.abort.abort();
  } catch (error) {
    addLog("warn", "Failed to abort discovery probe", {
      error: (error as Error).message,
    });
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

const logDiscoveryDecision = (
  state: ConnectionState,
  trigger: DiscoveryTrigger | null,
  details?: Record<string, unknown>,
) => {
  addLog("info", "Discovery decision", { state, trigger, ...details });
  if (isSmokeModeEnabled()) {
    console.info("C64U_DISCOVERY_DECISION", JSON.stringify({ state, trigger, ...details }));
    void recordSmokeStatus({
      state,
      mode: typeof details?.mode === "string" ? details.mode : undefined,
      baseUrl: typeof details?.baseUrl === "string" ? details.baseUrl : undefined,
    });
  }
};

let identityHealInFlight = false;

// A promotion driven by passive traffic (noteReachable) or a cancelled startup
// probe can reach REAL_CONNECTED with no device identity; without identity the
// health gate reports Degraded indefinitely, so fetch it once after connect.
const ensureDeviceIdentityAfterConnect = async () => {
  if (identityHealInFlight || snapshot.deviceInfo) return;
  identityHealInFlight = true;
  try {
    const result = await probeInfoOnce();
    if (result.ok && snapshot.state === "REAL_CONNECTED" && !snapshot.deviceInfo) {
      setSnapshot({ deviceInfo: result.deviceInfo });
    } else if (!result.ok) {
      addLog("debug", "Post-connect identity probe failed", { error: result.error });
    }
  } finally {
    identityHealInFlight = false;
  }
};

const transitionToRealConnected = async (
  trigger: DiscoveryTrigger,
  runtimeConfig?: { baseUrl: string; deviceHost: string; password?: string },
) => {
  clearPinnedDemoMode();
  cancelActiveDiscovery();
  dismissDemoInterstitial();
  resetInteractionState("transition-real-connected");
  transitionTo("REAL_CONNECTED", trigger);
  logDiscoveryDecision("REAL_CONNECTED", trigger, { mode: "real" });
  await stopDemoServer();
  if (runtimeConfig) {
    applyC64APIRuntimeConfig(runtimeConfig.baseUrl, runtimeConfig.password, runtimeConfig.deviceHost);
  } else {
    await applyC64APIConfigFromStorage();
  }
  const runtimeBaseUrl = normalizeUrl(getC64APIConfigSnapshot().baseUrl);
  const activeMockUrl = normalizeUrl(getActiveMockBaseUrl());
  if (!activeMockUrl && runtimeBaseUrl && !isRuntimeUsingTestTarget(runtimeBaseUrl)) {
    stickyRealDeviceLock = true;
  }
  addLog("info", "Connection switched to real device", { trigger });
  if (!snapshot.deviceInfo) {
    void ensureDeviceIdentityAfterConnect();
  }
};

const transitionToOfflineNoDemo = async (trigger: DiscoveryTrigger) => {
  clearPinnedDemoMode();
  cancelActiveDiscovery();
  dismissDemoInterstitial();
  resetInteractionState("transition-offline");
  transitionTo("OFFLINE_NO_DEMO", trigger);
  logDiscoveryDecision("OFFLINE_NO_DEMO", trigger, { mode: "offline" });
  await stopDemoServer();
  await applyC64APIConfigFromStorage();
  addLog("info", "Connection switched to offline", { trigger });
};

const shouldShowDemoInterstitial = (trigger: DiscoveryTrigger) =>
  trigger !== "background" && !demoInterstitialShownThisSession;

const transitionToDemoActive = async (trigger: DiscoveryTrigger) => {
  if (stickyRealDeviceLock) {
    addLog("warn", "Sticky real-device lock active; skipping demo mode transition", { trigger });
    await transitionToOfflineNoDemo(trigger);
    return;
  }
  cancelActiveDiscovery();
  resetInteractionState("transition-demo-active");

  // Show the interstitial early so the UI responds immediately while the mock
  // server is still starting up.
  const shouldShowInterstitial = shouldShowDemoInterstitial(trigger);
  if (shouldShowInterstitial) {
    demoInterstitialShownThisSession = true;
    sessionStorage.setItem(DEMO_INTERSTITIAL_SESSION_KEY, "1");
    setSnapshot({ demoInterstitialVisible: true });
  }

  // Configure the API base URL BEFORE transitioning state so that queries
  // triggered by the DEMO_ACTIVE re-render already target the mock server
  // instead of the unreachable real-device hostname.

  if (isFuzzModeEnabled()) {
    const fuzzBaseUrl = getFuzzMockBaseUrl();
    if (fuzzBaseUrl) {
      const mockHost = getDeviceHostFromBaseUrl(fuzzBaseUrl);
      applyC64APIRuntimeConfig(fuzzBaseUrl, undefined, mockHost);
      addLog("info", "Fuzz mode using forced mock base URL", {
        trigger,
        baseUrl: fuzzBaseUrl,
      });
      transitionTo("DEMO_ACTIVE", trigger);
      logDiscoveryDecision("DEMO_ACTIVE", trigger, { mode: "demo" });
      return;
    }
  }

  const hasMockServerOverride =
    typeof window !== "undefined" &&
    Boolean((window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl);
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
      addLog("info", "Demo mode mock server unavailable", {
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
    addLog("info", "Demo mode using mock C64U", {
      trigger,
      baseUrl: activeMockUrl,
    });
  } else {
    const fallbackHost = resolveDeviceHostFromStorage();
    const fallbackBaseUrl = buildBaseUrlFromDeviceHost(fallbackHost);
    applyC64APIRuntimeConfig(fallbackBaseUrl, undefined, fallbackHost);
    addLog("info", "Demo mode using stored device host", {
      trigger,
      baseUrl: fallbackBaseUrl,
    });
  }

  // Transition state AFTER the URL is configured so that React queries
  // triggered by the DEMO_ACTIVE re-render hit the correct endpoint.
  transitionTo("DEMO_ACTIVE", trigger);
  logDiscoveryDecision("DEMO_ACTIVE", trigger, { mode: "demo" });
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
  transitionTo("REAL_CONNECTED", trigger);
  logDiscoveryDecision("REAL_CONNECTED", trigger, { mode: "mock", baseUrl });
  if (isSmokeModeEnabled()) {
    console.info("C64U_SMOKE_MOCK_CONNECTED", JSON.stringify({ baseUrl, host: mockHost }));
  }
};

const handleProbeOutcome = async (
  trigger: DiscoveryTrigger,
  ok: boolean,
  autoDemoEnabled: boolean,
  isCurrentRun: () => boolean,
) => {
  if (!isCurrentRun()) return;

  if (ok) {
    setSnapshot({ lastProbeSucceededAtMs: Date.now(), lastProbeError: null });
    addLog("info", "Discovery probe succeeded", { trigger });
    if (isSmokeModeEnabled()) {
      console.info("C64U_PROBE_OK", JSON.stringify({ trigger }));
    }
    await transitionToRealConnected(trigger);
    return;
  }

  setSnapshot({ lastProbeFailedAtMs: Date.now() });
  addLog("debug", "Discovery probe failed", { trigger });
  if (isSmokeModeEnabled()) {
    console.warn("C64U_PROBE_FAILED", JSON.stringify({ trigger }));
  }
  if (autoDemoEnabled) {
    await transitionToDemoActive(trigger);
  } else {
    await transitionToOfflineNoDemo(trigger);
  }
};

const isManualDiscoveryTrigger = (trigger: DiscoveryTrigger) => trigger === "manual" || trigger === "settings";

/**
 * Centralized discovery entry point used for:
 * - App startup
 * - Manual icon-triggered switching
 * - Background rediscovery
 * - Settings-triggered rediscovery
 */
async function runDiscoverConnection(trigger: DiscoveryTrigger): Promise<void> {
  if (trigger !== "background") {
    clearPinnedDemoMode();
  }
  const discoveryRun = beginDiscoveryRun(trigger);

  if (trigger === "background") {
    if (activeDiscovery) {
      addLog("debug", "Background discovery skipped because a probe is already active");
      return;
    }
  } else {
    cancelActiveDiscovery();
  }

  const smokeConfig = getSmokeConfig();
  if (smokeConfig) {
    addLog("info", "Smoke discovery override active", {
      target: smokeConfig.target,
      host: smokeConfig.host,
    });
    if (isSmokeModeEnabled()) {
      console.info(
        "C64U_SMOKE_DISCOVERY_OVERRIDE",
        JSON.stringify({ target: smokeConfig.target, host: smokeConfig.host }),
      );
    }
  }
  if (smokeConfig?.target === "mock") {
    if (!discoveryRun.isCurrent()) return;
    await transitionToSmokeMockConnected(trigger);
    return;
  }

  if (isFuzzModeEnabled()) {
    if (!discoveryRun.isCurrent()) return;
    await transitionToDemoActive(trigger);
    return;
  }

  if (trigger === "manual") {
    transitionTo("DISCOVERING", trigger);
    const manualProbeTimeoutMs = Math.max(1000, loadDiscoveryProbeTimeoutMs()) + 1000;
    setSnapshot({ lastProbeAtMs: Date.now() });
    const ok = await Promise.race<boolean>([
      probeOnce({ timeoutMs: manualProbeTimeoutMs }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), manualProbeTimeoutMs);
      }),
    ]);
    await handleProbeOutcome(trigger, ok, isDemoModeRequested(), discoveryRun.isCurrent);
    return;
  }

  if (trigger === "background") {
    if (snapshot.state !== "DEMO_ACTIVE" && snapshot.state !== "OFFLINE_NO_DEMO") return;
    const abort = new AbortController();
    activeDiscovery = { abort, cancel: () => abort.abort() };
    try {
      setSnapshot({ lastDiscoveryTrigger: trigger });
      const ok = await probeOnce({ signal: abort.signal });
      setSnapshot({ lastProbeAtMs: Date.now() });
      if (ok) {
        if (!discoveryRun.isCurrent()) return;
        setSnapshot({
          lastProbeSucceededAtMs: Date.now(),
          lastProbeError: null,
        });
        addLog("info", "Discovery probe succeeded", { trigger });
        if (isSmokeModeEnabled()) {
          console.info("C64U_PROBE_OK", JSON.stringify({ trigger }));
        }
        if (snapshot.state === "DEMO_ACTIVE" && demoModePinnedByUser) {
          addLog("info", "Real device detected during pinned demo mode", { trigger });
          return;
        }
        if (snapshot.state === "DEMO_ACTIVE") {
          addLog("info", "Real device detected during demo mode", { trigger });
        }
        await transitionToRealConnected(trigger);
      } else {
        if (!discoveryRun.isCurrent()) return;
        setSnapshot({ lastProbeFailedAtMs: Date.now() });
        addLog("debug", "Discovery probe failed", { trigger });
        if (isSmokeModeEnabled()) {
          console.warn("C64U_PROBE_FAILED", JSON.stringify({ trigger }));
        }
      }
    } finally {
      if (activeDiscovery?.abort === abort) {
        activeDiscovery = null;
      }
    }
    return;
  }

  transitionTo("DISCOVERING", trigger);

  const abort = new AbortController();
  let cancelled = false;
  let probeInFlight = false;
  const windowMs = loadStartupDiscoveryWindowMs();
  let windowExpired = false;
  const handleWindowExpiry = async () => {
    if (cancelled) return;
    cancelled = true;
    globalThis.clearInterval(probeTimer);
    cancelActiveDiscovery();
    if (isDemoModeRequested()) {
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
      if (!discoveryRun.isCurrent()) return;
      setSnapshot({ lastProbeSucceededAtMs: Date.now(), lastProbeError: null });
      addLog("info", "Discovery probe succeeded", { trigger });
      if (isSmokeModeEnabled()) {
        console.info("C64U_PROBE_OK", JSON.stringify({ trigger }));
      }
      cancelled = true;
      globalThis.clearTimeout(windowTimer);
      globalThis.clearInterval(probeTimer);
      await transitionToRealConnected(trigger);
    } else {
      if (!discoveryRun.isCurrent()) return;
      if (windowExpired) {
        await handleWindowExpiry();
        return;
      }
      setSnapshot({ lastProbeFailedAtMs: Date.now() });
      if (isSmokeModeEnabled()) {
        console.warn("C64U_PROBE_FAILED", JSON.stringify({ trigger }));
      }
    }
  };

  // First probe immediately, then at fixed interval.
  // The probe timeout is governed by loadDiscoveryProbeTimeoutMs (default
  // 2500 ms). It must tolerate slow first-association on a cold WiFi link
  // but should not block the OFFLINE banner past the discovery window.
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

export async function discoverConnection(trigger: DiscoveryTrigger): Promise<void> {
  if (isManualDiscoveryTrigger(trigger) && activeManualDiscovery) {
    addLog("info", "Manual discovery request coalesced while another discovery is in flight", {
      activeTrigger: activeManualDiscovery.trigger,
      requestedTrigger: trigger,
    });
    return activeManualDiscovery.promise;
  }

  const promise = runDiscoverConnection(trigger);
  if (!isManualDiscoveryTrigger(trigger)) {
    return promise;
  }

  activeManualDiscovery = { trigger, promise };
  try {
    await promise;
  } finally {
    if (activeManualDiscovery?.promise === promise) {
      activeManualDiscovery = null;
    }
  }
}

export async function initializeConnectionManager() {
  cancelActiveDiscovery();
  activeManualDiscovery = null;
  applyFuzzModeDefaults();
  await initializeSmokeMode();
  await featureFlagManager.load();
  demoInterstitialShownThisSession = sessionStorage.getItem(DEMO_INTERSTITIAL_SESSION_KEY) === "1";
  demoModePinnedByUser = sessionStorage.getItem(DEMO_MODE_PINNED_SESSION_KEY) === "1";
  stickyRealDeviceLock = false;
  setSnapshot({
    state: "UNKNOWN",
    lastDiscoveryTrigger: null,
    lastTransitionAtMs: Date.now(),
    lastProbeAtMs: null,
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
    lastProbeError: null,
    deviceInfo: null,
    demoInterstitialVisible: false,
  });
  updateDeviceConnectionState("UNKNOWN");

  // Ensure outcomes never persist across cold starts.
  try {
    await stopDemoServer();
  } catch (error) {
    addLog("warn", "Failed to stop demo server during initialization", {
      error: (error as Error).message,
    });
  }
  const testBaseUrl = resolveTestBaseUrl();
  if (testBaseUrl) {
    const savedPassword = await loadStoredPassword();
    applyC64APIRuntimeConfig(testBaseUrl, savedPassword ?? undefined, getDeviceHostFromBaseUrl(testBaseUrl));
    return;
  }
  await applyC64APIConfigFromStorage();
}

export const CONNECTION_CONSTANTS = {
  STARTUP_PROBE_INTERVAL_MS,
  PROBE_REQUEST_TIMEOUT_MS,
};
