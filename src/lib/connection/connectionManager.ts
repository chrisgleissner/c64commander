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
import {
  buildDeviceHostWithHttpPort,
  hasPersistedDeviceHostConfig,
  stripPortFromDeviceHost,
} from "@/lib/c64api/hostConfig";
import { getPassword as loadStoredPassword, getPasswordForDevice } from "@/lib/secureStorage";
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
import { isAuthRequiredError, normalizeTransportError } from "@/lib/c64api/transportErrors";
import { notifyAuthRequired } from "@/lib/auth/authChallenge";
import { clearConnectivityErrorToastsForHost } from "@/lib/uiErrors";
import { registerReachabilityListener, type ReachabilitySource } from "@/lib/connection/reachabilityEvents";
import {
  completeSavedDeviceVerification,
  getSavedDevicesSnapshot,
  getSelectedSavedDevice,
  resolveCanonicalProductFamilyCode,
  selectSavedDevice,
} from "@/lib/savedDevices/store";
import { startDeviceDiscovery } from "@/lib/deviceDiscovery/discoveryManager";
import type { DeviceDiscoveryTrigger } from "@/lib/deviceDiscovery/types";

export type ConnectionState = "UNKNOWN" | "DISCOVERING" | "REAL_CONNECTED" | "DEMO_ACTIVE" | "OFFLINE_NO_DEMO";
export type DiscoveryTrigger = "startup" | "manual" | "settings" | "background" | "switch" | "resume";

export type ProbeInfoResult = {
  ok: boolean;
  deviceInfo: DeviceInfo | null;
  error: string | null;
  /** Set when the failure was a 401/403 — the device answered, it rejected the password. */
  authRequired?: boolean;
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
const AUTH_REQUIRED_PROBE_ERROR = "Password required";

const isTestProbeEnabled = () => {
  const env = import.meta.env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
  if (env?.VITE_ENABLE_TEST_PROBES === "1") return true;
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

const toDeviceDiscoveryTrigger = (trigger: DiscoveryTrigger): DeviceDiscoveryTrigger => {
  if (trigger === "settings") return "settings";
  if (trigger === "resume") return "resume";
  if (trigger === "manual") return "manual";
  return "startup";
};

const shouldAttemptAutomaticDeviceDiscovery = (trigger: DiscoveryTrigger) =>
  trigger === "startup" || trigger === "resume" || trigger === "settings";

// Device hostnames are passed through to the platform's HTTP client verbatim.
// The app performs no custom name resolution; DHCP-aware routers may make the
// firmware hostname reachable through normal LAN DNS.
const loadPersistedConnectionConfig = async () => {
  const password = await loadStoredPassword();
  const deviceHost = resolveDeviceHostFromStorage();
  return {
    baseUrl: buildBaseUrlFromDeviceHost(deviceHost),
    password: password ?? undefined,
    deviceHost,
  };
};

const loadSwitchConnectionConfig = (options: { deviceHost: string; password?: string | null }) => {
  const deviceHost = options.deviceHost;
  return {
    baseUrl: buildBaseUrlFromDeviceHost(deviceHost),
    password: options.password ?? undefined,
    deviceHost,
  };
};

const probeInfoWithConnectionConfig = async (
  config: ReturnType<typeof loadSwitchConnectionConfig>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeInfoResult> => {
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
    const healthy = isProbePayloadHealthy(response);
    return {
      ok: healthy,
      deviceInfo: response,
      error: healthy ? null : "Probe payload missing required identity",
    };
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? "Unknown probe failure";
    if (/^HTTP\s+\d+/.test(message)) {
      return {
        ok: false,
        deviceInfo: null,
        error: message,
        authRequired: isAuthRequiredError(error),
      };
    }
    // Contextualize raw transport failures (e.g. DNS "Unable to resolve host")
    // so the connection snapshot, UnifiedHealthBadge, and downstream diagnostics
    // see a user-friendly message instead of the raw fetch error text.
    const failure = normalizeTransportError(error, { host: config.deviceHost });
    addLog(failure.class === "dns" ? "info" : "warn", "Probe request failed", {
      baseUrl: config.baseUrl,
      deviceHost: config.deviceHost,
      class: failure.class,
      userMessage: failure.userMessage,
      error: failure.rawMessage,
    });
    return {
      ok: false,
      deviceInfo: null,
      error: failure.userMessage,
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

const reportAuthRequiredProbe = (config: Awaited<ReturnType<typeof loadPersistedConnectionConfig>>): void => {
  addLog("info", "Discovery probe rejected by device; raising password challenge", {
    deviceHost: config.deviceHost,
  });
  setSnapshot({ lastProbeError: AUTH_REQUIRED_PROBE_ERROR });
  notifyAuthRequired({ host: config.deviceHost });
};

const isAuthRequiredProbeFailure = (): boolean => snapshot.lastProbeError === AUTH_REQUIRED_PROBE_ERROR;

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
    const healthy = isProbePayloadHealthy(response);
    return healthy;
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? "Unknown probe failure";
    const normalizedMessage = message;
    if (isAuthRequiredError(error)) {
      reportAuthRequiredProbe(config);
    } else if (!/^HTTP\s+\d+/.test(normalizedMessage)) {
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

/**
 * Read-only reachability probe of an ARBITRARY host, without committing it as the
 * active device or mutating connection state. Used to validate a device before it is
 * saved (so we never persist an unreachable entry). A `/v1/info` answer — including a
 * 401/403 (reachable but password-gated) — means the host is reachable.
 */
export async function probeDeviceReachability(options: {
  deviceHost: string;
  password?: string | null;
  timeoutMs?: number;
}): Promise<ProbeInfoResult> {
  const config = loadSwitchConnectionConfig({ deviceHost: options.deviceHost, password: options.password ?? null });
  return probeInfoWithConnectionConfig(config, {
    timeoutMs: options.timeoutMs ?? Math.max(1000, loadDiscoveryProbeTimeoutMs()) + 1000,
  });
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
        authRequired: isAuthRequiredError(error),
      };
    }
    const failure = normalizeTransportError(error, { host: config.deviceHost });
    return {
      ok: false,
      deviceInfo: null,
      error: failure.userMessage,
    };
  }
}

export async function verifyCurrentConnectionTarget(options?: {
  deviceHost?: string;
  password?: string | null;
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
      ? loadSwitchConnectionConfig({
          deviceHost: options.deviceHost,
          password: options.password,
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
            deviceHost: switchConfig.deviceHost,
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
    firmware_version: deviceInfo?.firmware_version ?? null,
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
  // transitionToRealConnected has no internal try/catch and mutates state to
  // REAL_CONNECTED before its throwing awaits (stopDemoServer / config apply); the
  // other call sites await it, so guard this fire-and-forget path against an
  // unhandled rejection + a half-promoted connection going silent.
  void transitionToRealConnected(trigger).catch((error) => {
    addLog("warn", "Reachability-triggered connection promotion failed", {
      host: normalizedHost,
      source,
      error: error instanceof Error ? error.message : String(error ?? "unknown error"),
    });
  });
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

// Bounded per-device timeout for the startup saved-device reachability sweep.
const SAVED_DEVICE_SWEEP_TIMEOUT_MS = 1200;

/**
 * Startup/resume policy: when the selected device is unreachable, probe the OTHER
 * configured (saved) devices' `/v1/info` in parallel (bounded, read-only). If any is
 * reachable, switch to it and connect WITHOUT presenting an auto-discovery flow. This
 * implements "if at least one configured device is reachable, do not start discovery
 * merely because other configured devices are unreachable". A stale U2 entry is a valid
 * input here and is simply skipped if it does not answer the probe.
 */
const tryReachableSavedDeviceFallback = async (
  trigger: DiscoveryTrigger,
  isCurrentRun: () => boolean,
): Promise<boolean> => {
  if (trigger !== "startup" && trigger !== "resume") return false;
  const savedDevices = getSavedDevicesSnapshot();
  const selectedId = savedDevices.selectedDeviceId;
  const candidates = savedDevices.devices.filter((device) => device.id !== selectedId && device.host.trim());
  if (candidates.length === 0) return false;

  const probes = await Promise.all(
    candidates.map(async (device) => {
      if (!isCurrentRun()) return null;
      const deviceHost = buildDeviceHostWithHttpPort(device.host, device.httpPort);
      let password: string | null = null;
      if (device.hasPassword) {
        password = await getPasswordForDevice(device.id).catch((error) => {
          addLog("warn", "Failed to read saved-device password during startup sweep; probing without auth", {
            deviceId: device.id,
            error: error instanceof Error ? error.message : String(error ?? "Unknown secure-storage failure"),
          });
          return null;
        });
      }
      const probe = await probeInfoWithConnectionConfig(loadSwitchConnectionConfig({ deviceHost, password }), {
        timeoutMs: SAVED_DEVICE_SWEEP_TIMEOUT_MS,
      });
      return probe.ok ? { device, deviceHost, password } : null;
    }),
  );

  if (!isCurrentRun()) return false;
  const reachable = probes.find((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (!reachable) return false;

  addLog("info", "Startup found a reachable configured device; connecting without discovery", {
    trigger,
    deviceId: reachable.device.id,
  });
  selectSavedDevice(reachable.device.id);
  applyC64APIRuntimeConfig(
    buildBaseUrlFromDeviceHost(reachable.deviceHost),
    reachable.password ?? undefined,
    reachable.deviceHost,
    {
      reason: "startup-reachable-saved-device",
    },
  );
  const verification = await verifyCurrentConnectionTarget({
    deviceHost: reachable.deviceHost,
    password: reachable.password,
  });
  if (verification.ok && verification.deviceInfo) {
    completeSavedDeviceVerification(reachable.device.id, verification.deviceInfo);
    return true;
  }
  return false;
};

const tryAutomaticDeviceDiscoveryFallback = async (
  trigger: DiscoveryTrigger,
  isCurrentRun: () => boolean,
): Promise<boolean> => {
  if (!shouldAttemptAutomaticDeviceDiscovery(trigger)) return false;

  // Prefer connecting to an already-configured reachable device over scanning the LAN.
  if (await tryReachableSavedDeviceFallback(trigger, isCurrentRun)) return true;
  if (!isCurrentRun()) return false;

  setSnapshot({
    lastProbeAtMs: Date.now(),
    lastProbeError: "Searching the local network for C64 Ultimate devices.",
  });
  addLog("info", "Automatic device discovery fallback started", { trigger });

  const result = await startDeviceDiscovery({
    trigger: toDeviceDiscoveryTrigger(trigger),
    includeLanScan: true,
    timeoutMs: trigger === "settings" ? 10_000 : 8_000,
  });

  if (!isCurrentRun()) return false;

  if (result.candidates.length === 0) {
    addLog("info", "Automatic device discovery fallback found no devices", {
      trigger,
      scannedHosts: result.scannedHosts,
      unsupported: result.unsupported,
    });
    return false;
  }

  setSnapshot({
    lastProbeSucceededAtMs: Date.now(),
    lastProbeError: null,
    deviceInfo: null,
  });
  addLog("info", "Automatic device discovery fallback found devices and is waiting for user selection", {
    trigger,
    candidates: result.candidates.length,
    scannedHosts: result.scannedHosts,
    unsupported: result.unsupported,
  });
  await transitionToOfflineNoDemo(trigger);
  return true;
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

  if (trigger === "startup" && !hasPersistedDeviceHostConfig()) {
    const discovered = await tryAutomaticDeviceDiscoveryFallback(trigger, discoveryRun.isCurrent);
    if (discovered) return;
    if (!discoveryRun.isCurrent()) return;
  }

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
    if (!isAuthRequiredProbeFailure()) {
      const discovered = await tryAutomaticDeviceDiscoveryFallback(trigger, discoveryRun.isCurrent);
      if (discovered) return;
    }
    if (!discoveryRun.isCurrent()) return;
    setSnapshot({ lastProbeFailedAtMs: Date.now() });
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
    })().catch((error) => {
      // The offline/demo fallback transition runs here outside any try/catch;
      // guard it so a rejection can't become an unhandled rejection.
      addLog("warn", "Discovery window-expiry transition failed", {
        error: error instanceof Error ? error.message : String(error ?? "unknown error"),
      });
    });
  }, windowMs);

  const runProbe = async () => {
    if (cancelled || probeInFlight) return;
    probeInFlight = true;
    setSnapshot({ lastProbeAtMs: Date.now() });
    try {
      const ok = await probeOnce({ signal: abort.signal });
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unknown discovery probe failure");
      addLog("warn", "Discovery probe failed before completion", {
        trigger,
        error: message,
      });
      if (!cancelled && discoveryRun.isCurrent()) {
        setSnapshot({ lastProbeFailedAtMs: Date.now(), lastProbeError: message });
        if (windowExpired) {
          await handleWindowExpiry();
        }
      }
    } finally {
      probeInFlight = false;
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
