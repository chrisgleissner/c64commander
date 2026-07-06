/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { recordDeviceGuard } from "@/lib/tracing/traceSession";
import type { TraceActionContext } from "@/lib/tracing/types";
import {
  loadDeviceSafetyConfig,
  subscribeDeviceSafetyUpdates,
  type DeviceSafetyConfig,
} from "@/lib/config/deviceSafetySettings";
import { getActiveAutoResolutionContext } from "@/lib/config/deviceSafetySettings";
import {
  getDeviceStateSnapshot,
  markDeviceRequestEnd,
  markDeviceRequestStart,
  setCircuitOpenUntil,
} from "@/lib/deviceInteraction/deviceStateStore";
import {
  areBackgroundReadsSuspended,
  waitForBackgroundReadsToResume,
} from "@/lib/deviceInteraction/deviceActivityGate";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";
import {
  buildRestRequestIdentity,
  canonicalizeRestPath,
  isConfigMutationPath,
  isMachineControlPath,
  isReadOnlyRestMethod,
} from "@/lib/deviceInteraction/restRequestIdentity";
import { resetConfigWriteThrottle } from "@/lib/config/configWriteThrottle";

export type InteractionIntent = "user" | "system" | "background";

type RestRequestMeta = {
  action: TraceActionContext;
  method: string;
  path: string;
  normalizedUrl: string;
  intent: InteractionIntent;
  baseUrl: string;
  allowDuringDiscovery?: boolean;
  allowDuringError?: boolean;
  bypassCache?: boolean;
  bypassCooldown?: boolean;
  bypassBackoff?: boolean;
  bypassCircuit?: boolean;
  /**
   * An explicit, user-forced probe (e.g. the Diagnostics "Run health check"
   * button). It MUST always reach the wire: it skips the device-state gate
   * below and — via the caller ORing every bypass flag on — the circuit,
   * backoff, cooldown, and cache. The whole point of a manual health check is
   * to observe the device's ACTUAL current state, so no stale governor may
   * suppress it. See withRestInteraction and c64api request().
   */
  forceProbe?: boolean;
  /**
   * This request must NOT contribute failures to the REST circuit-breaker
   * streak. Set for diagnostic/health probes, which are observers: a probe blip
   * must never trip the breaker that guards real user traffic (a success still
   * resets the streak, so healthy observation keeps closing the circuit).
   */
  suppressCircuitContribution?: boolean;
};

type FtpRequestMeta = {
  action: TraceActionContext;
  operation: string;
  path: string;
  intent: InteractionIntent;
  // PH9: device scope is part of the coalescing/cooldown key so that
  // identical operations against different hosts (u64 vs c64u, or a saved
  // device reconfigured to a new host) don't share in-flight or cooldown
  // state. Optional for backward compatibility with legacy callers that
  // only ever talked to a single host; in that case the key falls back to
  // "any" scope and behaves like the pre-PH9 implementation.
  host?: string;
  port?: number;
};

type TelnetRequestMeta = {
  action: TraceActionContext;
  actionId: string;
  intent: InteractionIntent;
  host?: string;
  port?: number;
};

type RestFailureKind = "timeout" | "abort" | "network" | "http-status";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type InflightEntry<T> = {
  promise: Promise<T>;
  generation: number;
};

type QueueTask<T> = {
  run: () => Promise<T>;
  resolve?: (value: T) => void;
  reject?: (error: Error) => void;
  intent: InteractionIntent;
  getReadyAtMs?: () => number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTestEnv = () => {
  if (
    (
      globalThis as {
        __c64uForceInteractionScheduling?: boolean;
      }
    ).__c64uForceInteractionScheduling === true
  ) {
    return false;
  }
  if (typeof import.meta !== "undefined") {
    const env = (import.meta as ImportMeta).env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
    if (env?.VITE_ENABLE_TEST_PROBES === "1") return true;
  }
  if (typeof window !== "undefined") {
    const win = window as Window & { __c64uTestProbeEnabled?: boolean };
    if (win.__c64uTestProbeEnabled) return true;
  }
  if (typeof process !== "undefined") {
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test" || process.env.PLAYWRIGHT === "1") {
      return true;
    }
  }
  return false;
};

// PH10: thrown when queued interaction tasks are cancelled by a device-state
// reset (e.g. saved-device switch). Classified as cancellation, not failure,
// so callers and diagnostics can distinguish "stale, ignored" from "broken".
export class InteractionCancelledError extends Error {
  readonly isCancellation = true as const;
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "InteractionCancelledError";
  }
}

class InteractionScheduler {
  private running = 0;
  private deferredDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly queues: Record<InteractionIntent, Array<QueueTask<unknown>>> = {
    user: [],
    system: [],
    background: [],
  };

  constructor(
    private readonly maxConcurrency: () => number,
    private readonly label: string = "scheduler",
  ) {}

  schedule<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueueTask<unknown> = {
        ...task,
        resolve,
        reject,
      } as QueueTask<unknown>;
      this.queues[task.intent].push(entry);
      this.drain();
    });
  }

  // PH10: reject every queued (not-yet-running) task with a cancellation
  // error so a saved-device switch doesn't leak old-host work into the new
  // device's context. Running tasks cannot be revoked here — they complete
  // or fail naturally; their late results are handled by the caller (or
  // simply ignored when state has moved on).
  cancelAll(reason: string, intents: readonly InteractionIntent[] = ["user", "system", "background"]): number {
    this.clearDeferredDrainTimer();
    let cancelled = 0;
    for (const intent of intents) {
      const queue = this.queues[intent];
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) continue;
        cancelled += 1;
        const error = new InteractionCancelledError(`${this.label} queued task cancelled: ${reason}`, reason);
        // Promise reject cannot throw synchronously, so no try/catch is needed.
        task.reject?.(error);
      }
    }
    return cancelled;
  }

  private clearDeferredDrainTimer() {
    if (this.deferredDrainTimer) {
      clearTimeout(this.deferredDrainTimer);
      this.deferredDrainTimer = null;
    }
  }

  private scheduleDeferredDrain(nextReadyAtMs: number | null) {
    this.clearDeferredDrainTimer();
    if (nextReadyAtMs === null) return;
    this.deferredDrainTimer = setTimeout(
      () => {
        this.deferredDrainTimer = null;
        this.drain();
      },
      Math.max(0, nextReadyAtMs - Date.now()),
    );
  }

  private takeNext(): { task: QueueTask<unknown> | null; nextReadyAtMs: number | null } {
    const now = Date.now();
    let nextReadyAtMs: number | null = null;
    for (const intent of ["user", "system", "background"] as const) {
      const queue = this.queues[intent];
      for (let index = 0; index < queue.length; index += 1) {
        const candidate = queue[index];
        const readyAtMs = candidate.getReadyAtMs?.() ?? now;
        if (readyAtMs <= now) {
          queue.splice(index, 1);
          return { task: candidate, nextReadyAtMs: null };
        }
        nextReadyAtMs = nextReadyAtMs === null ? readyAtMs : Math.min(nextReadyAtMs, readyAtMs);
      }
    }
    return { task: null, nextReadyAtMs };
  }

  private drain() {
    this.clearDeferredDrainTimer();
    const limit = Math.max(1, this.maxConcurrency());
    while (this.running < limit) {
      const { task, nextReadyAtMs } = this.takeNext();
      if (!task) {
        this.scheduleDeferredDrain(nextReadyAtMs);
        return;
      }
      this.running += 1;
      void task
        .run()
        .then((value) => task.resolve?.(value))
        .catch((error) => task.reject?.(error))
        .finally(() => {
          this.running = Math.max(0, this.running - 1);
          this.drain();
        });
    }
  }
}

let config: DeviceSafetyConfig = loadDeviceSafetyConfig();
let lastLoggedEffectivePresetSignature: string | null = null;

const logEffectivePresetChange = (nextConfig: DeviceSafetyConfig) => {
  const resolution = nextConfig.resolution;
  const effectiveMode = resolution?.effectiveMode ?? nextConfig.mode;
  const signature = `${nextConfig.mode}:${effectiveMode}`;
  if (signature === lastLoggedEffectivePresetSignature) {
    return;
  }
  lastLoggedEffectivePresetSignature = signature;
  const context = getActiveAutoResolutionContext();
  const message =
    nextConfig.mode === "AUTO"
      ? `Device safety effective-preset = ${effectiveMode}`
      : `Device safety preset = ${effectiveMode}`;
  addLog("info", message, {
    mode: nextConfig.mode,
    resolvedPreset: resolution?.resolvedPreset ?? null,
    provisional: resolution?.isProvisional ?? false,
    activeProduct: context.activeProduct,
    activeDeviceId: context.activeDeviceId,
    reason: resolution?.reason ?? "explicit-user-choice",
  });
};

const updateConfig = () => {
  config = loadDeviceSafetyConfig();
  restInflightGeneration += 1;
  restCache.clear();
  restCooldownUntil.clear();
  ftpConnectCooldownUntil.clear();
  telnetConnectCooldownUntil.clear();
  restInflight.clear();
  ftpInflight.clear();
  restErrorStreak = 0;
  restBackoffUntilMs = 0;
  restCircuitUntilMs = 0;
  restUserCircuitProbePromise = null;
  ftpErrorStreak = 0;
  ftpBackoffUntilMs = 0;
  ftpCircuitUntilMs = 0;
  telnetErrorStreak = 0;
  telnetBackoffUntilMs = 0;
  telnetCircuitUntilMs = 0;
  setCircuitOpenUntil(null);
  logEffectivePresetChange(config);
  addLog("info", "Device safety config updated", { mode: config.mode, config });
};

export const resetInteractionState = (reason: string) => {
  const preserveQueuedUserWork = reason === "transition-real-connected";
  restInflightGeneration += 1;
  restCache.clear();
  restCooldownUntil.clear();
  restInflight.clear();
  if (!preserveQueuedUserWork) {
    resetConfigWriteThrottle(reason);
  }
  ftpConnectCooldownUntil.clear();
  telnetConnectCooldownUntil.clear();
  ftpInflight.clear();
  restErrorStreak = 0;
  restBackoffUntilMs = 0;
  restCircuitUntilMs = 0;
  restUserCircuitProbePromise = null;
  ftpErrorStreak = 0;
  ftpBackoffUntilMs = 0;
  ftpCircuitUntilMs = 0;
  telnetErrorStreak = 0;
  telnetBackoffUntilMs = 0;
  telnetCircuitUntilMs = 0;
  setCircuitOpenUntil(null);
  // PH10: reject everything still queued so old-device REST/FTP/Telnet
  // work cannot land against the new device's context. Already-running
  // tasks complete naturally; their late results are stale and ignored
  // by their callers because device-state has moved on.
  const resetIntents: readonly InteractionIntent[] = preserveQueuedUserWork
    ? ["system", "background"]
    : ["user", "system", "background"];
  const restCancelled = restScheduler.cancelAll(reason, resetIntents);
  const ftpCancelled = ftpScheduler.cancelAll(reason, resetIntents);
  const telnetCancelled = telnetScheduler.cancelAll(reason, resetIntents);
  addLog("info", "Device interaction state reset", {
    reason,
    cancelledQueuedRest: restCancelled,
    cancelledQueuedFtp: ftpCancelled,
    cancelledQueuedTelnet: telnetCancelled,
  });
};

subscribeDeviceSafetyUpdates(updateConfig);

const REST_MAX_CONCURRENCY = 1;
const TELNET_MAX_CONCURRENCY = 1;
const MACHINE_CONTROL_COOLDOWN_MS = 250;
export const FTP_TRANSIENT_RETRY_DELAY_MS = 250;

const restScheduler = new InteractionScheduler(() => REST_MAX_CONCURRENCY, "rest");
const ftpScheduler = new InteractionScheduler(() => config.ftpMaxConcurrency, "ftp");
const telnetScheduler = new InteractionScheduler(() => TELNET_MAX_CONCURRENCY, "telnet");

const restCache = new Map<string, CacheEntry<unknown>>();
const restInflight = new Map<string, InflightEntry<unknown>>();
const restCooldownUntil = new Map<string, number>();

const ftpInflight = new Map<string, Promise<unknown>>();
const ftpConnectCooldownUntil = new Map<string, number>();
const telnetConnectCooldownUntil = new Map<string, number>();

let restErrorStreak = 0;
let restBackoffUntilMs = 0;
let restCircuitUntilMs = 0;
let restUserCircuitProbePromise: Promise<unknown> | null = null;
let restInflightGeneration = 0;

let ftpErrorStreak = 0;
let ftpBackoffUntilMs = 0;
let ftpCircuitUntilMs = 0;

let telnetErrorStreak = 0;
let telnetBackoffUntilMs = 0;
let telnetCircuitUntilMs = 0;

const getRestFailureKind = (error: Error): RestFailureKind | null => {
  const kind = (error as { c64uRestFailureKind?: RestFailureKind }).c64uRestFailureKind;
  return kind ?? null;
};

const isCriticalRestError = (error: Error) => {
  if ((error as { isCancellation?: boolean; c64uCallerCancelled?: boolean }).isCancellation) return false;
  if ((error as { c64uCallerCancelled?: boolean }).c64uCallerCancelled) return false;
  const structuredKind = getRestFailureKind(error);
  if (structuredKind) {
    if (structuredKind === "abort") return false;
    if (structuredKind === "timeout" || structuredKind === "network") return true;
    const status = (error as { c64uHttpStatus?: number }).c64uHttpStatus;
    return typeof status === "number" && (status >= 500 || status === 429);
  }
  const message = error.message.toLowerCase();
  if (message.includes("smoke mode blocked")) return false;
  if (message.includes("fuzz mode blocked")) return false;
  if (message.includes("host unreachable")) return true;
  if (message.includes("network")) return true;
  if (message.includes("timed out")) return true;
  const httpMatch = message.match(/http\s+(\d+)/i);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    return status >= 500 || status === 429;
  }
  return false;
};

const getCriticalRestFailureWeight = (error: Error) => {
  const structuredKind = getRestFailureKind(error);
  if (structuredKind === "timeout") return 0.5;
  return isCriticalRestError(error) ? 1 : 0;
};

const computeBackoff = (streak: number) => {
  if (config.backoffBaseMs <= 0 || config.backoffMaxMs <= 0 || streak <= 0) return 0;
  const factor = Math.max(1, config.backoffFactor);
  const backoff = Math.min(config.backoffMaxMs, Math.round(config.backoffBaseMs * Math.pow(factor, streak - 1)));
  return backoff;
};

const updateRestFailure = (error: Error) => {
  const failureWeight = getCriticalRestFailureWeight(error);
  if (failureWeight <= 0) return;
  restErrorStreak += failureWeight;
  const backoffMs = computeBackoff(restErrorStreak);
  const now = Date.now();
  if (backoffMs > 0) {
    restBackoffUntilMs = Math.max(restBackoffUntilMs, now + backoffMs);
  }
  if (config.circuitBreakerThreshold > 0 && restErrorStreak >= config.circuitBreakerThreshold) {
    restCircuitUntilMs = Math.max(restCircuitUntilMs, now + config.circuitBreakerCooldownMs);
    setCircuitOpenUntil(restCircuitUntilMs, error.message);
  }
};

const resetRestFailure = () => {
  restErrorStreak = 0;
  restBackoffUntilMs = 0;
  restCircuitUntilMs = 0;
  restUserCircuitProbePromise = null;
  setCircuitOpenUntil(null);
};

const isTransientFtpFailure = (error: Error) => {
  const message = error.message.toLowerCase();
  return (
    isTransientConnectivityFailure(message) ||
    /timed out|timeout|connection refused|connection reset|econnrefused|econnreset|socket closed|connection aborted/.test(
      message,
    )
  );
};

const shouldRetryFtpFailure = (error: Error) => isTransientFtpFailure(error);

const updateFtpFailure = (error: Error) => {
  if (!isTransientFtpFailure(error)) return;
  ftpErrorStreak += 1;
  const backoffMs = computeBackoff(ftpErrorStreak);
  const now = Date.now();
  if (backoffMs > 0) {
    ftpBackoffUntilMs = Math.max(ftpBackoffUntilMs, now + backoffMs);
  }
  if (config.circuitBreakerThreshold > 0 && ftpErrorStreak >= config.circuitBreakerThreshold) {
    ftpCircuitUntilMs = Math.max(ftpCircuitUntilMs, now + config.circuitBreakerCooldownMs);
  }
};

const resetFtpFailure = () => {
  ftpErrorStreak = 0;
  ftpBackoffUntilMs = 0;
  ftpCircuitUntilMs = 0;
};

const updateTelnetFailure = (error: Error) => {
  telnetErrorStreak += 1;
  const backoffMs = computeBackoff(telnetErrorStreak);
  const now = Date.now();
  if (backoffMs > 0) {
    telnetBackoffUntilMs = Math.max(telnetBackoffUntilMs, now + backoffMs);
  }
  if (config.circuitBreakerThreshold > 0 && telnetErrorStreak >= config.circuitBreakerThreshold) {
    telnetCircuitUntilMs = Math.max(telnetCircuitUntilMs, now + config.circuitBreakerCooldownMs);
  }
};

const resetTelnetFailure = () => {
  telnetErrorStreak = 0;
  telnetBackoffUntilMs = 0;
  telnetCircuitUntilMs = 0;
};

const resolveRestPolicy = (method: string, path: string, baseUrl: string) => {
  const canonicalPath = canonicalizeRestPath(path, baseUrl);
  const normalizedPath = canonicalPath.split("?")[0];
  if (method === "GET" && normalizedPath === "/v1/info") {
    return {
      key: buildRestRequestIdentity({ method, path: canonicalPath, baseUrl }),
      cacheMs: config.infoCacheMs,
      cooldownMs: config.infoCacheMs,
    };
  }
  if (method === "GET" && normalizedPath === "/v1/configs") {
    return {
      key: buildRestRequestIdentity({ method, path: canonicalPath, baseUrl }),
      cacheMs: config.configsCacheMs,
      cooldownMs: config.configsCooldownMs,
    };
  }
  if (method === "GET" && normalizedPath === "/v1/drives") {
    return {
      key: buildRestRequestIdentity({ method, path: canonicalPath, baseUrl }),
      cacheMs: 0,
      cooldownMs: config.drivesCooldownMs,
    };
  }
  if (normalizedPath === "/v1/machine:readmem") {
    return {
      key: `${baseUrl}:rest-machine-readmem`,
      cacheMs: 0,
      cooldownMs: MACHINE_CONTROL_COOLDOWN_MS,
    };
  }
  if (normalizedPath === "/v1/machine:writemem") {
    return {
      key: `${baseUrl}:rest-machine-writemem`,
      cacheMs: 0,
      cooldownMs: MACHINE_CONTROL_COOLDOWN_MS,
    };
  }
  if (!isReadOnlyRestMethod(method) && isMachineControlPath(canonicalPath)) {
    return {
      key: `${baseUrl}:rest-machine-control`,
      cacheMs: 0,
      cooldownMs: MACHINE_CONTROL_COOLDOWN_MS,
    };
  }
  if (!isReadOnlyRestMethod(method) && isConfigMutationPath(canonicalPath)) {
    return {
      key: `${baseUrl}:rest-config-mutation`,
      cacheMs: 0,
      cooldownMs: config.configsCooldownMs,
    };
  }
  return { key: null, cacheMs: 0, cooldownMs: 0 };
};

const shouldBlockForState = (intent: InteractionIntent, allowDuringDiscovery?: boolean, allowDuringError?: boolean) => {
  if (isTestEnv()) return false;
  const snapshot = getDeviceStateSnapshot();
  const state = snapshot.state;
  if (state === "UNKNOWN" || state === "DISCOVERING") {
    if (intent === "user") return false;
    return !(allowDuringDiscovery && intent === "system");
  }
  if (state === "ERROR") {
    if ((intent === "system" || intent === "background") && allowDuringError) return false;
    if (intent === "background") return true;
    if (intent === "user" && snapshot.circuitOpenUntilMs && Date.now() < snapshot.circuitOpenUntilMs) return false;
    if (intent === "user" && config.allowUserOverrideCircuit) return false;
    return true;
  }
  return false;
};

const applyCooldown = async (
  key: string | null,
  cooldownMs: number,
  intent: InteractionIntent,
  action: TraceActionContext,
) => {
  if (!key || cooldownMs <= 0) return;
  const now = Date.now();
  const untilMs = restCooldownUntil.get(key) ?? 0;
  if (now >= untilMs) return;
  const waitMs = untilMs - now;
  recordDeviceGuard(action, {
    decision: "defer",
    reason: "cooldown",
    waitMs,
  });
  addLog("debug", "Device safety cooldown delay applied", {
    transport: "rest",
    key,
    intent,
    waitMs,
    cooldownMs,
    deviceSafetyMode: config.mode,
    effectiveDeviceSafetyMode: config.resolution?.effectiveMode ?? config.mode,
  });
  await sleep(waitMs);
};

const normalizeRestResourcePath = (path: string, baseUrl: string) => canonicalizeRestPath(path, baseUrl).split("?")[0];

const pathsShareResourceTree = (leftPath: string, rightPath: string) =>
  leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`);

const invalidateRestReadStateForWrite = (method: string, path: string, baseUrl: string) => {
  if (isReadOnlyRestMethod(method)) return;

  const writePath = normalizeRestResourcePath(path, baseUrl);
  const invalidatedReadPaths = new Set<string>(["/v1/info"]);
  if (writePath.startsWith("/v1/configs")) {
    invalidatedReadPaths.add("/v1/configs");
  }
  if (writePath.startsWith("/v1/drives")) {
    invalidatedReadPaths.add("/v1/drives");
  }
  if (isMachineControlPath(writePath)) {
    invalidatedReadPaths.add("/v1/drives");
  }

  const shouldInvalidateKey = (key: string) => {
    if (!key.startsWith(`GET ${baseUrl}`)) return false;
    const readPath = normalizeRestResourcePath(key.slice(`GET ${baseUrl}`.length), baseUrl);
    if (invalidatedReadPaths.has(readPath)) return true;
    return Array.from(invalidatedReadPaths).some((candidate) => pathsShareResourceTree(readPath, candidate));
  };

  Array.from(restCache.keys()).forEach((key) => {
    if (shouldInvalidateKey(key)) {
      restCache.delete(key);
    }
  });
  Array.from(restInflight.keys()).forEach((key) => {
    if (shouldInvalidateKey(key)) {
      restInflight.delete(key);
    }
  });
  Array.from(restCooldownUntil.keys()).forEach((key) => {
    if (shouldInvalidateKey(key)) {
      restCooldownUntil.delete(key);
    }
  });
};

export const withRestInteraction = async <T>(meta: RestRequestMeta, handler: () => Promise<T>): Promise<T> => {
  if (isTestEnv()) {
    markDeviceRequestStart();
    try {
      const result = await handler();
      markDeviceRequestEnd({ success: true });
      return result;
    } catch (error) {
      const err = error as Error;
      markDeviceRequestEnd({ success: false, errorMessage: err.message });
      throw error;
    }
  }
  if (meta.forceProbe && getDeviceStateSnapshot().state === "ERROR") {
    // A user-forced probe (manual health check) must observe the device's real
    // state, so it overrides the ERROR state gate instead of being rejected by
    // it. Without this, a device stuck in ERROR (e.g. OFFLINE_NO_DEMO) can
    // never be re-checked and the app stays wedged offline until diagnostics
    // are cleared or a background rediscovery happens to land - the reported bug.
    recordDeviceGuard(meta.action, {
      decision: "override",
      reason: "state",
      state: getDeviceStateSnapshot().state,
    });
  } else if (shouldBlockForState(meta.intent, meta.allowDuringDiscovery, meta.allowDuringError)) {
    const error = new Error("Device not ready for requests");
    recordDeviceGuard(meta.action, {
      decision: "block",
      reason: "state",
      state: getDeviceStateSnapshot().state,
    });
    throw error;
  }

  if (meta.intent !== "user" && isReadOnlyRestMethod(meta.method)) {
    if (getDeviceStateSnapshot().state === "BUSY") {
      recordDeviceGuard(meta.action, {
        decision: "observe",
        reason: "device-busy",
      });
    }
    if (meta.intent === "background" || areBackgroundReadsSuspended()) {
      if (meta.intent === "system") {
        recordDeviceGuard(meta.action, {
          decision: "defer",
          reason: "user-write-priority",
        });
        addLog("debug", "System REST read yielding to user device activity", {
          method: meta.method,
          path: meta.path,
          intent: meta.intent,
        });
      }
      await waitForBackgroundReadsToResume();
    }
  }

  let now = Date.now();
  let circuitOpen = restCircuitUntilMs > now && !meta.bypassCircuit;
  let userHalfOpenProbe = circuitOpen && meta.intent === "user";
  let reservedUserHalfOpenProbe = false;
  if (circuitOpen && !userHalfOpenProbe) {
    recordDeviceGuard(meta.action, {
      decision: "block",
      reason: "circuit-open",
      untilMs: restCircuitUntilMs,
    });
    throw new Error("Device circuit open");
  }
  if (userHalfOpenProbe && restUserCircuitProbePromise) {
    recordDeviceGuard(meta.action, {
      decision: "defer",
      reason: "circuit-open",
      untilMs: restCircuitUntilMs,
    });
    const firstProbeSucceeded = await restUserCircuitProbePromise.then(
      () => true,
      () => false,
    );
    if (!firstProbeSucceeded) {
      throw new Error("Device circuit open");
    }
    now = Date.now();
    circuitOpen = restCircuitUntilMs > now && !meta.bypassCircuit;
    userHalfOpenProbe = circuitOpen && meta.intent === "user";
    if (circuitOpen && !userHalfOpenProbe) {
      recordDeviceGuard(meta.action, {
        decision: "block",
        reason: "circuit-open",
        untilMs: restCircuitUntilMs,
      });
      throw new Error("Device circuit open");
    }
  }
  if (userHalfOpenProbe) {
    reservedUserHalfOpenProbe = true;
  }
  if (restCircuitUntilMs > now && meta.bypassCircuit) {
    recordDeviceGuard(meta.action, {
      decision: "override",
      reason: "circuit-open",
      untilMs: restCircuitUntilMs,
    });
  }
  if (userHalfOpenProbe) {
    recordDeviceGuard(meta.action, {
      decision: "override",
      reason: "circuit-open",
      untilMs: restCircuitUntilMs,
    });
  }

  const canonicalPath = canonicalizeRestPath(meta.path, meta.baseUrl);
  const policy = resolveRestPolicy(meta.method, canonicalPath, meta.baseUrl);
  const usesSharedReadState =
    isReadOnlyRestMethod(meta.method) && Boolean(policy.key) && !meta.bypassCache && !userHalfOpenProbe;
  const defersReadWaitsInScheduler = isReadOnlyRestMethod(meta.method);

  if (usesSharedReadState && policy.key) {
    const cached = restCache.get(policy.key);
    if (cached && cached.expiresAt > now) {
      recordDeviceGuard(meta.action, {
        decision: "cache",
        reason: "fresh",
        key: policy.key,
      });
      return cached.value as T;
    }
    const inflight = restInflight.get(policy.key);
    if (inflight) {
      recordDeviceGuard(meta.action, {
        decision: "coalesce",
        reason: "inflight",
        key: policy.key,
      });
      return inflight.promise as Promise<T>;
    }
  }

  const scheduleTask = async () => {
    if (!defersReadWaitsInScheduler && !meta.bypassBackoff && !userHalfOpenProbe && restBackoffUntilMs > Date.now()) {
      const waitMs = restBackoffUntilMs - Date.now();
      recordDeviceGuard(meta.action, {
        decision: "defer",
        reason: "backoff",
        waitMs,
      });
      addLog("debug", "Device safety backoff delay applied", {
        transport: "rest",
        method: meta.method,
        path: canonicalPath,
        intent: meta.intent,
        waitMs,
        deviceSafetyMode: config.mode,
        effectiveDeviceSafetyMode: config.resolution?.effectiveMode ?? config.mode,
      });
      await sleep(waitMs);
    }

    if (!defersReadWaitsInScheduler && !meta.bypassCooldown && !userHalfOpenProbe) {
      await applyCooldown(policy.key, policy.cooldownMs, meta.intent, meta.action);
    }

    if (!meta.bypassCooldown && !userHalfOpenProbe && policy.key && policy.cooldownMs > 0) {
      restCooldownUntil.set(policy.key, Date.now() + policy.cooldownMs);
    }

    markDeviceRequestStart();
    addLog("debug", "Device request started", {
      transport: "rest",
      method: meta.method,
      path: canonicalPath,
      intent: meta.intent,
      priority: meta.intent,
      cooldownMs: policy.cooldownMs,
      deviceSafetyMode: config.mode,
      effectiveDeviceSafetyMode: config.resolution?.effectiveMode ?? config.mode,
    });
    try {
      const result = await handler();
      if (usesSharedReadState && policy.key && policy.cacheMs > 0) {
        restCache.set(policy.key, {
          value: result,
          expiresAt: Date.now() + policy.cacheMs,
        });
      }
      invalidateRestReadStateForWrite(meta.method, canonicalPath, meta.baseUrl);
      resetRestFailure();
      markDeviceRequestEnd({ success: true });
      addLog("debug", "Device request finished", {
        transport: "rest",
        method: meta.method,
        path: canonicalPath,
        intent: meta.intent,
        priority: meta.intent,
        success: true,
      });
      return result;
    } catch (error) {
      const err = error as Error;
      // A diagnostic/health probe is an OBSERVER: it must never trip the circuit
      // breaker that guards real user traffic. Otherwise a couple of transient
      // probe blips (a config write + one readMemory retry timing out) sum past
      // the CONSERVATIVE threshold of 2 and escalate the WHOLE device to
      // "offline / circuit open" - which then blocks the very probes that would
      // detect it is actually healthy, wedging the app until restart. A probe
      // SUCCESS still calls resetRestFailure() above, so healthy observation
      // continues to CLOSE the circuit (rapid self-healing); only the failure
      // contribution is suppressed here.
      if (!meta.suppressCircuitContribution) {
        updateRestFailure(err);
      }
      markDeviceRequestEnd({ success: false, errorMessage: err.message });
      addLog("debug", "Device request finished", {
        transport: "rest",
        method: meta.method,
        path: canonicalPath,
        intent: meta.intent,
        priority: meta.intent,
        success: false,
        error: err.message,
      });
      throw error;
    }
  };

  const scheduledPromise = restScheduler.schedule<T>({
    intent: meta.intent,
    run: scheduleTask,
    getReadyAtMs: defersReadWaitsInScheduler
      ? () => {
          let readyAtMs = Date.now();
          if (!meta.bypassBackoff && !userHalfOpenProbe) {
            readyAtMs = Math.max(readyAtMs, restBackoffUntilMs);
          }
          if (!meta.bypassCooldown && !userHalfOpenProbe && policy.key && policy.cooldownMs > 0) {
            readyAtMs = Math.max(readyAtMs, restCooldownUntil.get(policy.key) ?? 0);
          }
          return readyAtMs;
        }
      : undefined,
  });

  if (reservedUserHalfOpenProbe) {
    restUserCircuitProbePromise = scheduledPromise;
  }

  if (usesSharedReadState && policy.key) {
    restInflight.set(policy.key, {
      promise: scheduledPromise as Promise<unknown>,
      generation: restInflightGeneration,
    });
  }

  return scheduledPromise.finally(() => {
    if (reservedUserHalfOpenProbe) {
      if (restUserCircuitProbePromise === scheduledPromise) {
        restUserCircuitProbePromise = null;
      }
    }
    if (usesSharedReadState && policy.key) {
      const current = restInflight.get(policy.key);
      if (current?.promise === scheduledPromise && current.generation === restInflightGeneration) {
        restInflight.delete(policy.key);
      }
    }
  });
};

const applyFtpConnectPacing = async (hostScope: string, action: TraceActionContext, intent: InteractionIntent) => {
  const cooldownMs = config.ftpListCooldownMs;
  if (cooldownMs <= 0) return;
  const now = Date.now();
  const cooldownUntil = ftpConnectCooldownUntil.get(hostScope) ?? 0;
  if (now < cooldownUntil) {
    const waitMs = cooldownUntil - now;
    recordDeviceGuard(action, {
      decision: "defer",
      reason: "cooldown",
      waitMs,
    });
    addLog("debug", "FTP connect pacing delay applied", {
      transport: "ftp",
      hostScope,
      intent,
      waitMs,
      cooldownMs,
      deviceSafetyMode: config.mode,
      effectiveDeviceSafetyMode: config.resolution?.effectiveMode ?? config.mode,
    });
    await sleep(waitMs);
  }
  ftpConnectCooldownUntil.set(hostScope, Date.now() + cooldownMs);
};

const applyTelnetConnectPacing = async (hostScope: string, action: TraceActionContext, intent: InteractionIntent) => {
  const cooldownMs = config.telnetConnectCooldownMs;
  if (cooldownMs <= 0) return;
  const now = Date.now();
  const cooldownUntil = telnetConnectCooldownUntil.get(hostScope) ?? 0;
  if (now < cooldownUntil) {
    const waitMs = cooldownUntil - now;
    recordDeviceGuard(action, {
      decision: "defer",
      reason: "cooldown",
      waitMs,
    });
    addLog("debug", "Telnet connect pacing delay applied", {
      transport: "telnet",
      hostScope,
      intent,
      waitMs,
      cooldownMs,
      deviceSafetyMode: config.mode,
      effectiveDeviceSafetyMode: config.resolution?.effectiveMode ?? config.mode,
    });
    await sleep(waitMs);
  }
  telnetConnectCooldownUntil.set(hostScope, Date.now() + cooldownMs);
};

export const withFtpInteraction = async <T>(meta: FtpRequestMeta, handler: () => Promise<T>): Promise<T> => {
  if (isTestEnv()) {
    markDeviceRequestStart();
    try {
      const result = await handler();
      markDeviceRequestEnd({ success: true });
      return result;
    } catch (error) {
      const err = error as Error;
      markDeviceRequestEnd({ success: false, errorMessage: err.message });
      throw error;
    }
  }
  if (shouldBlockForState(meta.intent, false)) {
    const error = new Error("Device not ready for FTP");
    recordDeviceGuard(meta.action, {
      decision: "block",
      reason: "state",
      state: getDeviceStateSnapshot().state,
    });
    throw error;
  }

  const now = Date.now();
  if (ftpCircuitUntilMs > now && !(meta.intent === "user" && config.allowUserOverrideCircuit)) {
    recordDeviceGuard(meta.action, {
      decision: "block",
      reason: "circuit-open",
      untilMs: ftpCircuitUntilMs,
    });
    throw new Error("FTP circuit open");
  }
  if (ftpCircuitUntilMs > now && meta.intent === "user" && config.allowUserOverrideCircuit) {
    recordDeviceGuard(meta.action, {
      decision: "override",
      reason: "circuit-open",
      untilMs: ftpCircuitUntilMs,
    });
  }

  // PH9: scope keys per device (host:port) so cross-device traffic does not
  // share inflight/cooldown state. Falls back to "any" when host is missing.
  const hostScope = `${(meta.host ?? "any").toLowerCase()}:${meta.port ?? 21}`;
  const key = `${hostScope}|${meta.operation}:${meta.path}`;
  const inflight = ftpInflight.get(key);
  if (inflight) {
    recordDeviceGuard(meta.action, {
      decision: "coalesce",
      reason: "inflight",
      key,
    });
    return inflight as Promise<T>;
  }

  const scheduleTask = async () => {
    if (ftpBackoffUntilMs > Date.now()) {
      const waitMs = ftpBackoffUntilMs - Date.now();
      recordDeviceGuard(meta.action, {
        decision: "defer",
        reason: "backoff",
        waitMs,
      });
      await sleep(waitMs);
    }

    let attempt = 0;
    while (true) {
      await applyFtpConnectPacing(hostScope, meta.action, meta.intent);
      markDeviceRequestStart();
      try {
        const result = await handler();
        resetFtpFailure();
        markDeviceRequestEnd({ success: true });
        return result;
      } catch (error) {
        const err = error as Error;
        updateFtpFailure(err);
        markDeviceRequestEnd({ success: false, errorMessage: err.message });
        const circuitOpen = ftpCircuitUntilMs > Date.now();
        if (attempt >= 1 || !shouldRetryFtpFailure(err) || circuitOpen) {
          throw error;
        }
        attempt += 1;
        recordDeviceGuard(meta.action, {
          decision: "defer",
          reason: "retry",
          waitMs: FTP_TRANSIENT_RETRY_DELAY_MS,
        });
        addLog("debug", "Retrying transient FTP failure once", {
          operation: meta.operation,
          path: meta.path,
          host: meta.host ?? null,
          port: meta.port ?? 21,
          error: err.message,
          waitMs: FTP_TRANSIENT_RETRY_DELAY_MS,
        });
        await sleep(FTP_TRANSIENT_RETRY_DELAY_MS);
      }
    }
  };

  const scheduledPromise = ftpScheduler.schedule<T>({
    intent: meta.intent,
    run: scheduleTask,
  });

  ftpInflight.set(key, scheduledPromise as Promise<unknown>);
  try {
    return await scheduledPromise;
  } finally {
    ftpInflight.delete(key);
  }
};

export const withTelnetInteraction = async <T>(meta: TelnetRequestMeta, handler: () => Promise<T>): Promise<T> => {
  if (isTestEnv()) {
    markDeviceRequestStart();
    try {
      const result = await handler();
      markDeviceRequestEnd({ success: true });
      return result;
    } catch (error) {
      const err = error as Error;
      markDeviceRequestEnd({ success: false, errorMessage: err.message });
      throw error;
    }
  }
  if (shouldBlockForState(meta.intent, false)) {
    const error = new Error("Device not ready for Telnet");
    recordDeviceGuard(meta.action, {
      decision: "block",
      reason: "state",
      state: getDeviceStateSnapshot().state,
    });
    throw error;
  }

  const now = Date.now();
  if (telnetCircuitUntilMs > now && !(meta.intent === "user" && config.allowUserOverrideCircuit)) {
    recordDeviceGuard(meta.action, {
      decision: "block",
      reason: "circuit-open",
      untilMs: telnetCircuitUntilMs,
    });
    throw new Error("Telnet circuit open");
  }
  if (telnetCircuitUntilMs > now && meta.intent === "user" && config.allowUserOverrideCircuit) {
    recordDeviceGuard(meta.action, {
      decision: "override",
      reason: "circuit-open",
      untilMs: telnetCircuitUntilMs,
    });
  }
  const hostScope = `${(meta.host ?? "any").toLowerCase()}:${meta.port ?? 23}`;

  const scheduleTask = async () => {
    if (telnetBackoffUntilMs > Date.now()) {
      const waitMs = telnetBackoffUntilMs - Date.now();
      recordDeviceGuard(meta.action, {
        decision: "defer",
        reason: "backoff",
        waitMs,
      });
      await sleep(waitMs);
    }

    await applyTelnetConnectPacing(hostScope, meta.action, meta.intent);
    markDeviceRequestStart();
    try {
      const result = await handler();
      resetTelnetFailure();
      markDeviceRequestEnd({ success: true });
      return result;
    } catch (error) {
      const err = error as Error;
      updateTelnetFailure(err);
      markDeviceRequestEnd({ success: false, errorMessage: err.message });
      addErrorLog("Telnet request failed", {
        error: err.message,
        actionId: meta.actionId,
      });
      throw error;
    }
  };

  return telnetScheduler.schedule<T>({
    intent: meta.intent,
    run: scheduleTask,
  });
};
