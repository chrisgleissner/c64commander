/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { C64API, buildBaseUrlFromDeviceHost, type DeviceInfo } from "@/lib/c64api";
import { isAuthRequiredError, normalizeTransportError } from "@/lib/c64api/transportErrors";
import { loadDiscoveryProbeTimeoutMs } from "@/lib/config/appSettings";
import { isNewProbeFailure, noteProbeAnswered } from "@/lib/connection/probeFailureLog";
import { addLog } from "@/lib/logging";

export type ProbeInfoResult = {
  ok: boolean;
  deviceInfo: DeviceInfo | null;
  error: string | null;
  /** Set when the failure was a 401/403 — the device answered, it rejected the password. */
  authRequired?: boolean;
};

export const loadSwitchConnectionConfig = (options: { deviceHost: string; password?: string | null }) => {
  const deviceHost = options.deviceHost;
  return {
    baseUrl: buildBaseUrlFromDeviceHost(deviceHost),
    password: options.password ?? undefined,
    deviceHost,
  };
};

const PROBE_REQUEST_OPTIONS = {
  // A probe exists to find out whether the device answers; "no" is a result, not a fault to count.
  __c64uExpectedFailure: true,
  __c64uIntent: "system",
  __c64uAllowDuringDiscovery: true,
  __c64uAllowDuringError: true,
  __c64uBypassCache: true,
  // Self-healing: recovery/discovery probes must NEVER be suppressed by an
  // open circuit breaker. Backing off from an unhealthy device is exactly
  // what would stop us noticing it has recovered, leaving the app wedged
  // offline. These probes carry their own timeout + rediscovery backoff, so
  // the gateway bypasses the circuit for them, keeping a recovery path
  // permanently open (the low-level circuit bypass stays inside the gateway).
  __c64uRecoveryProbe: true,
} as const;

export type ProbeConnectionConfig = ReturnType<typeof loadSwitchConnectionConfig>;

/**
 * How a probe ended, so each entry point can attach its own side effects
 * without re-deriving the classification from the error message. Every probe
 * shares one classification (HARD27-024); only the side effects differ.
 */
export type ProbeOutcome = {
  result: ProbeInfoResult;
  kind: "ok" | "payload" | "auth" | "http" | "transport";
};

const classifyProbeFailure = (error: unknown, config: ProbeConnectionConfig): ProbeOutcome => {
  // getHttpStatusFromError is the app-wide chokepoint for 401/403 and reads the
  // annotated status, not the message text. A message regex would miss the
  // throw sites that prefix the status ("getInfo failed: HTTP 401").
  const authRequired = isAuthRequiredError(error);
  const message = (error as Error | undefined)?.message ?? "Unknown probe failure";
  if (authRequired || /^HTTP\s+\d+/.test(message)) {
    noteProbeAnswered(config.deviceHost);
    return {
      kind: authRequired ? "auth" : "http",
      result: { ok: false, deviceInfo: null, error: message, authRequired },
    };
  }
  // Contextualize raw transport failures (e.g. DNS "Unable to resolve host")
  // so the connection snapshot, UnifiedHealthBadge, and downstream diagnostics
  // see a user-friendly message instead of the raw fetch error text.
  const failure = normalizeTransportError(error, { host: config.deviceHost });
  if (isNewProbeFailure(config.deviceHost, failure.class)) {
    addLog("info", "Probe request failed", {
      baseUrl: config.baseUrl,
      deviceHost: config.deviceHost,
      class: failure.class,
      userMessage: failure.userMessage,
      error: failure.rawMessage,
    });
  }
  return {
    kind: "transport",
    result: { ok: false, deviceInfo: null, error: failure.userMessage, authRequired: false },
  };
};

export const runProbeInfo = async (
  config: ProbeConnectionConfig,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeOutcome> => {
  try {
    const api = new C64API(config.baseUrl, config.password, config.deviceHost);
    const response = await api.getInfo({
      timeoutMs: options.timeoutMs ?? loadDiscoveryProbeTimeoutMs(),
      signal: options.signal,
      ...PROBE_REQUEST_OPTIONS,
    });
    noteProbeAnswered(config.deviceHost);
    const healthy = isProbePayloadHealthy(response);
    return {
      kind: healthy ? "ok" : "payload",
      result: {
        ok: healthy,
        deviceInfo: response,
        error: healthy ? null : "Probe payload missing required identity",
      },
    };
  } catch (error) {
    return classifyProbeFailure(error, config);
  }
};

export const probeInfoWithConnectionConfig = async (
  config: ProbeConnectionConfig,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeInfoResult> => (await runProbeInfo(config, options)).result;

export const isProbePayloadHealthy = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return false;
  const maybeErrors = (payload as { errors?: unknown }).errors;
  if (Array.isArray(maybeErrors) && maybeErrors.length > 0) return false;
  const product = (payload as { product?: unknown }).product;
  return typeof product === "string" && product.trim().length > 0;
};
