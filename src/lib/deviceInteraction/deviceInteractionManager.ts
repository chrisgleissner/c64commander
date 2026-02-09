/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from '@/lib/logging';
import { recordDeviceGuard } from '@/lib/tracing/traceSession';
import type { TraceActionContext } from '@/lib/tracing/types';
import {
  loadDeviceSafetyConfig,
  subscribeDeviceSafetyUpdates,
  type DeviceSafetyConfig,
} from '@/lib/config/deviceSafetySettings';
import {
  getDeviceStateSnapshot,
  markDeviceRequestEnd,
  markDeviceRequestStart,
  setCircuitOpenUntil,
} from '@/lib/deviceInteraction/deviceStateStore';

export type InteractionIntent = 'user' | 'system' | 'background';

type RestRequestMeta = {
  action: TraceActionContext;
  method: string;
  path: string;
  normalizedUrl: string;
  intent: InteractionIntent;
  baseUrl: string;
  allowDuringDiscovery?: boolean;
  bypassCache?: boolean;
  bypassCooldown?: boolean;
  bypassBackoff?: boolean;
};

type FtpRequestMeta = {
  action: TraceActionContext;
  operation: string;
  path: string;
  intent: InteractionIntent;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type QueueTask<T> = {
  run: () => Promise<T>;
  resolve?: (value: T) => void;
  reject?: (error: Error) => void;
  intent: InteractionIntent;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTestEnv = () => {
  if (typeof import.meta !== 'undefined') {
    const env = (import.meta as ImportMeta).env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
    if (env?.VITE_ENABLE_TEST_PROBES === '1') return true;
  }
  if (typeof process !== 'undefined') {
    if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT === '1') {
      return true;
    }
  }
  return false;
};

class InteractionScheduler {
  private running = 0;
  private readonly queues: Record<InteractionIntent, Array<QueueTask<unknown>>> = {
    user: [],
    system: [],
    background: [],
  };

  constructor(private readonly maxConcurrency: () => number) {}

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

  private takeNext(): QueueTask<unknown> | null {
    if (this.queues.user.length) return this.queues.user.shift() ?? null;
    if (this.queues.system.length) return this.queues.system.shift() ?? null;
    if (this.queues.background.length) return this.queues.background.shift() ?? null;
    return null;
  }

  private drain() {
    const limit = Math.max(1, this.maxConcurrency());
    while (this.running < limit) {
      const task = this.takeNext();
      if (!task) return;
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

const updateConfig = () => {
  config = loadDeviceSafetyConfig();
  restCache.clear();
  restCooldownUntil.clear();
  ftpCooldownUntil.clear();
  restInflight.clear();
  ftpInflight.clear();
  restErrorStreak = 0;
  restBackoffUntilMs = 0;
  restCircuitUntilMs = 0;
  ftpErrorStreak = 0;
  ftpBackoffUntilMs = 0;
  ftpCircuitUntilMs = 0;
  setCircuitOpenUntil(null);
  addLog('info', 'Device safety config updated', { mode: config.mode, config });
};

export const resetInteractionState = (reason: string) => {
  restCache.clear();
  restCooldownUntil.clear();
  restInflight.clear();
  ftpCooldownUntil.clear();
  ftpInflight.clear();
  restErrorStreak = 0;
  restBackoffUntilMs = 0;
  restCircuitUntilMs = 0;
  ftpErrorStreak = 0;
  ftpBackoffUntilMs = 0;
  ftpCircuitUntilMs = 0;
  setCircuitOpenUntil(null);
  addLog('info', 'Device interaction state reset', { reason });
};

subscribeDeviceSafetyUpdates(updateConfig);

const restScheduler = new InteractionScheduler(() => config.restMaxConcurrency);
const ftpScheduler = new InteractionScheduler(() => config.ftpMaxConcurrency);

const restCache = new Map<string, CacheEntry<unknown>>();
const restInflight = new Map<string, Promise<unknown>>();
const restCooldownUntil = new Map<string, number>();

const ftpInflight = new Map<string, Promise<unknown>>();
const ftpCooldownUntil = new Map<string, number>();

let restErrorStreak = 0;
let restBackoffUntilMs = 0;
let restCircuitUntilMs = 0;

let ftpErrorStreak = 0;
let ftpBackoffUntilMs = 0;
let ftpCircuitUntilMs = 0;

const isCriticalRestError = (error: Error) => {
  const message = error.message.toLowerCase();
  if (message.includes('smoke mode blocked')) return false;
  if (message.includes('fuzz mode blocked')) return false;
  if (message.includes('host unreachable')) return true;
  if (message.includes('network')) return true;
  if (message.includes('timed out')) return true;
  const httpMatch = message.match(/http\s+(\d+)/i);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    return status >= 500 || status === 429;
  }
  return false;
};

const computeBackoff = (streak: number) => {
  if (config.backoffBaseMs <= 0 || config.backoffMaxMs <= 0 || streak <= 0) return 0;
  const factor = Math.max(1, config.backoffFactor);
  const backoff = Math.min(config.backoffMaxMs, Math.round(config.backoffBaseMs * Math.pow(factor, streak - 1)));
  return backoff;
};

const updateRestFailure = (error: Error) => {
  if (!isCriticalRestError(error)) return;
  restErrorStreak += 1;
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
  setCircuitOpenUntil(null);
};

const updateFtpFailure = (error: Error) => {
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

const resolveRestPolicy = (method: string, path: string, baseUrl: string) => {
  const normalizedPath = path.split('?')[0];
  if (method === 'GET' && normalizedPath === '/v1/info') {
    return {
      key: `${baseUrl}:rest-info`,
      cacheMs: config.infoCacheMs,
      cooldownMs: 0,
    };
  }
  if (method === 'GET' && normalizedPath === '/v1/configs') {
    return {
      key: `${baseUrl}:rest-configs`,
      cacheMs: config.configsCacheMs,
      cooldownMs: config.configsCooldownMs,
    };
  }
  if (method === 'GET' && normalizedPath === '/v1/drives') {
    return {
      key: `${baseUrl}:rest-drives`,
      cacheMs: 0,
      cooldownMs: config.drivesCooldownMs,
    };
  }
  return { key: null, cacheMs: 0, cooldownMs: 0 };
};

const shouldBlockForState = (intent: InteractionIntent, allowDuringDiscovery?: boolean) => {
  if (isTestEnv()) return false;
  const state = getDeviceStateSnapshot().state;
  if (state === 'UNKNOWN' || state === 'DISCOVERING') {
    return !(allowDuringDiscovery && intent === 'system');
  }
  if (state === 'ERROR') {
    if (intent === 'background') return true;
    if (intent === 'user' && config.allowUserOverrideCircuit) return false;
    return true;
  }
  return false;
};

const applyCooldown = async (key: string | null, cooldownMs: number, intent: InteractionIntent, action: TraceActionContext) => {
  if (!key || cooldownMs <= 0) return;
  const now = Date.now();
  const untilMs = restCooldownUntil.get(key) ?? 0;
  if (now >= untilMs) return;
  const waitMs = untilMs - now;
  recordDeviceGuard(action, {
    decision: 'defer',
    reason: 'cooldown',
    waitMs,
  });
  await sleep(waitMs);
};

export const withRestInteraction = async <T>(
  meta: RestRequestMeta,
  handler: () => Promise<T>,
): Promise<T> => {
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
  if (shouldBlockForState(meta.intent, meta.allowDuringDiscovery)) {
    const error = new Error('Device not ready for requests');
    recordDeviceGuard(meta.action, { decision: 'block', reason: 'state', state: getDeviceStateSnapshot().state });
    throw error;
  }

  const now = Date.now();
  if (restCircuitUntilMs > now && !(meta.intent === 'user' && config.allowUserOverrideCircuit)) {
    recordDeviceGuard(meta.action, { decision: 'block', reason: 'circuit-open', untilMs: restCircuitUntilMs });
    throw new Error('Device circuit open');
  }
  if (restCircuitUntilMs > now && meta.intent === 'user' && config.allowUserOverrideCircuit) {
    recordDeviceGuard(meta.action, { decision: 'override', reason: 'circuit-open', untilMs: restCircuitUntilMs });
  }

  const policy = resolveRestPolicy(meta.method, meta.path, meta.baseUrl);
  if (policy.key && !meta.bypassCache) {
    const cached = restCache.get(policy.key);
    if (cached && cached.expiresAt > now) {
      recordDeviceGuard(meta.action, { decision: 'cache', reason: 'fresh', key: policy.key });
      return cached.value as T;
    }
    const inflight = restInflight.get(policy.key);
    if (inflight) {
      recordDeviceGuard(meta.action, { decision: 'coalesce', reason: 'inflight', key: policy.key });
      return inflight as Promise<T>;
    }
  }

  const scheduleTask = async () => {
    if (!meta.bypassBackoff && restBackoffUntilMs > Date.now()) {
      const waitMs = restBackoffUntilMs - Date.now();
      recordDeviceGuard(meta.action, { decision: 'defer', reason: 'backoff', waitMs });
      await sleep(waitMs);
    }

    if (!meta.bypassCooldown) {
      await applyCooldown(policy.key, policy.cooldownMs, meta.intent, meta.action);
    }

    if (!meta.bypassCooldown && policy.key && policy.cooldownMs > 0) {
      restCooldownUntil.set(policy.key, Date.now() + policy.cooldownMs);
    }

    markDeviceRequestStart();
    try {
      const result = await handler();
      if (policy.key && policy.cacheMs > 0 && !meta.bypassCache) {
        restCache.set(policy.key, { value: result, expiresAt: Date.now() + policy.cacheMs });
      }
      resetRestFailure();
      markDeviceRequestEnd({ success: true });
      return result;
    } catch (error) {
      const err = error as Error;
      updateRestFailure(err);
      markDeviceRequestEnd({ success: false, errorMessage: err.message });
      throw error;
    } finally {
      if (policy.key && !meta.bypassCache) {
        restInflight.delete(policy.key);
      }
    }
  };

  const scheduledPromise = restScheduler.schedule<T>({
    intent: meta.intent,
    run: scheduleTask,
  });

  if (policy.key && !meta.bypassCache) {
    restInflight.set(policy.key, scheduledPromise as Promise<unknown>);
  }

  return scheduledPromise;
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
    const error = new Error('Device not ready for FTP');
    recordDeviceGuard(meta.action, { decision: 'block', reason: 'state', state: getDeviceStateSnapshot().state });
    throw error;
  }

  const now = Date.now();
  if (ftpCircuitUntilMs > now && !(meta.intent === 'user' && config.allowUserOverrideCircuit)) {
    recordDeviceGuard(meta.action, { decision: 'block', reason: 'circuit-open', untilMs: ftpCircuitUntilMs });
    throw new Error('FTP circuit open');
  }
  if (ftpCircuitUntilMs > now && meta.intent === 'user' && config.allowUserOverrideCircuit) {
    recordDeviceGuard(meta.action, { decision: 'override', reason: 'circuit-open', untilMs: ftpCircuitUntilMs });
  }

  const key = `${meta.operation}:${meta.path}`;
  const inflight = ftpInflight.get(key);
  if (inflight) {
    recordDeviceGuard(meta.action, { decision: 'coalesce', reason: 'inflight', key });
    return inflight as Promise<T>;
  }

  const cooldownUntil = ftpCooldownUntil.get(key) ?? 0;
  const scheduleTask = async () => {
    if (ftpBackoffUntilMs > Date.now()) {
      const waitMs = ftpBackoffUntilMs - Date.now();
      recordDeviceGuard(meta.action, { decision: 'defer', reason: 'backoff', waitMs });
      await sleep(waitMs);
    }

    if (config.ftpListCooldownMs > 0 && Date.now() < cooldownUntil) {
      const waitMs = cooldownUntil - Date.now();
      recordDeviceGuard(meta.action, { decision: 'defer', reason: 'cooldown', waitMs });
      await sleep(waitMs);
    }

    if (config.ftpListCooldownMs > 0) {
      ftpCooldownUntil.set(key, Date.now() + config.ftpListCooldownMs);
    }

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
      addErrorLog('FTP request failed', { error: err.message, operation: meta.operation, path: meta.path });
      throw error;
    } finally {
      ftpInflight.delete(key);
    }
  };

  const scheduledPromise = ftpScheduler.schedule<T>({
    intent: meta.intent,
    run: scheduleTask,
  });

  ftpInflight.set(key, scheduledPromise as Promise<unknown>);
  return scheduledPromise;
};
