/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// C64 Ultimate REST API Client

import {
  clearPassword as clearStoredPassword,
  getCachedPassword,
  getPassword as loadStoredPassword,
  hasStoredPasswordFlag,
  setPassword as storePassword,
} from '@/lib/secureStorage';
import { addErrorLog, addLog, buildErrorLogDetails } from '@/lib/logging';
import { isSmokeModeEnabled, isSmokeReadOnlyEnabled } from '@/lib/smoke/smokeMode';
import { isFuzzModeEnabled, isFuzzSafeBaseUrl } from '@/lib/fuzz/fuzzMode';
import { scheduleConfigWrite } from '@/lib/config/configWriteThrottle';
import { runWithImplicitAction } from '@/lib/tracing/actionTrace';
import { recordRestRequest, recordRestResponse, recordTraceError } from '@/lib/tracing/traceSession';
import { classifyError } from '@/lib/tracing/failureTaxonomy';
import { withRestInteraction, type InteractionIntent } from '@/lib/deviceInteraction/deviceInteractionManager';
import { getDeviceStateSnapshot } from '@/lib/deviceInteraction/deviceStateStore';

const DEFAULT_BASE_URL = 'http://c64u';
const DEFAULT_DEVICE_HOST = 'c64u';
const DEFAULT_PROXY_URL = 'http://127.0.0.1:8787';
const CONTROL_REQUEST_TIMEOUT_MS = 3000;
const UPLOAD_REQUEST_TIMEOUT_MS = 5000;
const PLAYBACK_REQUEST_TIMEOUT_MS = 5000;
const RAM_BLOCK_WRITE_TIMEOUT_MS = 15_000;
const IDLE_RECOVERY_THRESHOLD_MS = 10_000;
const NETWORK_RETRY_DELAY_MS = 180;
const RETRYABLE_IDLE_RECOVERY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isDnsFailure = (message: string) => /unknown host|enotfound|ename_not_found|dns/i.test(message);
const isNetworkFailureMessage = (message: string) =>
  /failed to fetch|networkerror|network request failed|unknown host|enotfound|ename_not_found|dns/i.test(message);
const resolveHostErrorMessage = (message: string) =>
  (isDnsFailure(message) ? 'Host unreachable (DNS)' : 'Host unreachable');

const normalizeUrlPath = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    addLog('warn', 'Failed to normalize API URL path', {
      url,
      error: (error as Error).message,
    });
    return url;
  }
};

let requestSequence = 0;
const buildRequestId = () => {
  requestSequence = (requestSequence + 1) % 1_000_000;
  return `c64req-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
};

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const createAbortError = () => {
  const error = new Error('The operation was aborted');
  (error as { name: string }).name = 'AbortError';
  return error;
};

const waitWithAbortSignal = async (ms: number, signal?: AbortSignal) => {
  if (!signal) {
    await wait(ms);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const getIdleContext = () => {
  const snapshot = getDeviceStateSnapshot();
  const now = Date.now();
  const idleMs = snapshot.lastSuccessAtMs !== null ? Math.max(0, now - snapshot.lastSuccessAtMs) : null;
  return {
    deviceState: snapshot.state,
    idleMs,
    wasIdle: idleMs !== null && idleMs >= IDLE_RECOVERY_THRESHOLD_MS,
  };
};


const extractRequestBody = (body: unknown) => {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (error) {
      addLog('warn', 'Failed to parse request body JSON', {
        error: (error as Error).message,
      });
      return body;
    }
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // Provide structured summary of FormData for diagnostics
    const fields: Array<{
      name: string;
      type: 'file' | 'text';
      fileName?: string;
      sizeBytes?: number;
      mimeType?: string;
    }> = [];
    body.forEach((value, name) => {
      if (value instanceof File) {
        fields.push({
          name,
          type: 'file',
          fileName: value.name,
          sizeBytes: value.size,
          mimeType: value.type || undefined,
        });
      } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
        fields.push({
          name,
          type: 'file',
          sizeBytes: value.size,
          mimeType: value.type || undefined,
        });
      } else {
        fields.push({
          name,
          type: 'text',
        });
      }
    });
    return { type: 'form-data', fields };
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return {
      type: 'blob',
      sizeBytes: body.size,
      mimeType: body.type || null,
      source: 'blob',
    };
  }
  if (body instanceof ArrayBuffer) {
    return { type: 'array-buffer', sizeBytes: body.byteLength };
  }
  if (ArrayBuffer.isView(body)) {
    return { type: 'array-buffer-view', sizeBytes: body.byteLength };
  }
  return body as unknown;
};

const readResponseBody = async (response: Response) => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.clone().json();
  } catch (error) {
    addLog('warn', 'Failed to parse API response JSON', {
      error: (error as Error).message,
    });
    return null;
  }
};

const sanitizeHostInput = (input?: string) => {
  const raw = input?.trim() ?? '';
  if (!raw) return '';
  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return url.host || url.hostname || '';
    } catch (error) {
      addLog('warn', 'Failed to parse host from URL input', {
        input: raw,
        error: (error as Error).message,
      });
      return '';
    }
  }
  return raw.split('/')[0] ?? '';
};

export const normalizeDeviceHost = (input?: string) => {
  const sanitized = sanitizeHostInput(input);
  return sanitized || DEFAULT_DEVICE_HOST;
};

export const getDeviceHostFromBaseUrl = (baseUrl?: string) => {
  if (!baseUrl) return DEFAULT_DEVICE_HOST;
  try {
    const url = new URL(baseUrl);
    return url.host || DEFAULT_DEVICE_HOST;
  } catch (error) {
    addLog('warn', 'Failed to parse device host from base URL', {
      baseUrl,
      error: (error as Error).message,
    });
    return normalizeDeviceHost(baseUrl);
  }
};

export const buildBaseUrlFromDeviceHost = (deviceHost?: string) =>
  `http://${normalizeDeviceHost(deviceHost)}`;

export const resolveDeviceHostFromStorage = () => {
  if (typeof localStorage === 'undefined') return DEFAULT_DEVICE_HOST;
  const storedDeviceHost = localStorage.getItem('c64u_device_host');
  const normalizedStoredHost = normalizeDeviceHost(storedDeviceHost);
  if (storedDeviceHost) {
    localStorage.removeItem('c64u_base_url');
    return normalizedStoredHost;
  }
  const legacyBaseUrl = localStorage.getItem('c64u_base_url');
  if (legacyBaseUrl) {
    const migratedHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(legacyBaseUrl));
    localStorage.setItem('c64u_device_host', migratedHost);
    localStorage.removeItem('c64u_base_url');
    return migratedHost;
  }
  localStorage.removeItem('c64u_base_url');
  return normalizedStoredHost;
};

const isLocalProxy = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch (error) {
    addLog('warn', 'Failed to parse base URL for proxy detection', {
      baseUrl,
      error: (error as Error).message,
    });
    return false;
  }
};

const isLocalDeviceHost = (host: string) => {
  let normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('[')) {
    const closingBracketIndex = normalized.indexOf(']');
    if (closingBracketIndex !== -1) {
      normalized = normalized.slice(1, closingBracketIndex);
    }
  } else {
    const colonIndex = normalized.indexOf(':');
    if (colonIndex !== -1) {
      normalized = normalized.slice(0, colonIndex);
    }
  }
  return normalized === 'localhost' || normalized === '127.0.0.1';
};

const resolvePreferredDeviceHost = (baseUrl: string, deviceHost?: string) => {
  const explicitHost = deviceHost ? normalizeDeviceHost(deviceHost) : null;
  const derivedHost = normalizeDeviceHost(explicitHost ?? getDeviceHostFromBaseUrl(baseUrl));
  const isLikelyFallbackOrigin = (() => {
    if (typeof window === 'undefined') return false;
    const origin = window.location?.origin;
    return Boolean(origin && (baseUrl === origin || baseUrl.startsWith(`${origin}/`)));
  })();
  if (!explicitHost && isLocalDeviceHost(derivedHost) && isLikelyFallbackOrigin) {
    const storedHost = resolveDeviceHostFromStorage();
    if (!isLocalDeviceHost(storedHost)) {
      addLog('warn', 'Ignoring localhost base URL in favor of stored host', {
        baseUrl,
        derivedHost,
        storedHost,
      });
      return storedHost;
    }
  }
  return derivedHost;
};

let lastDeviceHost: string | null = null;

const logDeviceHostChange = (nextHost: string, context: { baseUrl: string; mode: 'persisted' | 'runtime' }) => {
  if (lastDeviceHost && lastDeviceHost !== nextHost) {
    addLog('warn', 'API device host changed', {
      previous: lastDeviceHost,
      next: nextHost,
      baseUrl: context.baseUrl,
      mode: context.mode,
    });
    void runWithImplicitAction(`api.host-change:${lastDeviceHost}->${nextHost}`, async () => {
      return;
    });
  }
  lastDeviceHost = nextHost;
};

const isNativePlatform = () => {
  try {
    const override = (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean; __c64uAllowNativePlatform?: boolean })
      .__C64U_NATIVE_OVERRIDE__
      ?? (typeof window !== 'undefined'
        ? (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__
        : undefined)
      ?? (globalThis as { __c64uAllowNativePlatform?: boolean }).__c64uAllowNativePlatform;
    if (typeof override === 'boolean') {
      return override;
    }
    if (typeof process !== 'undefined') {
      const env = (process as { env?: Record<string, string | undefined> }).env ?? {};
      if (env.VITEST === 'true' || env.NODE_ENV === 'test') {
        return false;
      }
    }
    return Boolean((window as any)?.Capacitor?.isNativePlatform?.());
  } catch (error) {
    addLog('warn', 'Failed to detect native platform in API client', {
      error: (error as Error).message,
    });
    return false;
  }
};

const isReadOnlyMethod = (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method);

const shouldBlockSmokeMutation = (method: string) => isSmokeModeEnabled() && isSmokeReadOnlyEnabled() && !isReadOnlyMethod(method);

export const getDefaultBaseUrl = () => DEFAULT_BASE_URL;

export interface DeviceInfo {
  product?: string;
  firmware_version?: string;
  fpga_version?: string;
  core_version?: string;
  hostname?: string;
  unique_id?: string;
  errors: string[];
}

export interface VersionInfo {
  version: string;
  errors: string[];
}

export interface ConfigCategory {
  [itemName: string]: {
    selected?: string | number;
    options?: string[];
    details?: {
      min?: number;
      max?: number;
      format?: string;
      presets?: string[];
    };
  } | string | number;
}

export interface ConfigResponse {
  [categoryName: string]: ConfigCategory | string[];
}

export interface ConfigResponseWithErrors extends ConfigResponse {
  errors: string[];
}

export interface CategoriesResponse {
  categories: string[];
  errors: string[];
}

export interface DriveInfo {
  enabled?: boolean;
  bus_id?: number;
  type?: string;
  rom?: string;
  image_file?: string;
  image_path?: string;
  last_error?: string;
  partitions?: Array<{ id: number; path: string }>;
}

export interface DrivesResponse {
  drives: Array<{ [key: string]: DriveInfo }>;
  errors: string[];
}

export class C64API {
  private password?: string;
  private deviceHost: string;

  constructor(
    baseUrl: string = DEFAULT_BASE_URL,
    password?: string,
    deviceHost: string = DEFAULT_DEVICE_HOST
  ) {
    this.deviceHost = normalizeDeviceHost(deviceHost || getDeviceHostFromBaseUrl(baseUrl));
    this.password = password;
  }

  setBaseUrl(url: string) {
    this.deviceHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(url));
  }

  setPassword(password?: string) {
    this.password = password;
  }

  setDeviceHost(deviceHost?: string) {
    this.deviceHost = normalizeDeviceHost(deviceHost);
  }

  getBaseUrl() {
    return buildBaseUrlFromDeviceHost(this.deviceHost);
  }

  getPassword() {
    return this.password;
  }

  getDeviceHost() {
    return this.deviceHost;
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.password) {
      headers['X-Password'] = this.password;
    }
    const baseUrl = this.getBaseUrl();
    if (isLocalProxy(baseUrl)) {
      headers['X-C64U-Host'] = this.deviceHost;
    }
    return headers;
  }

  private async parseResponseJson<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('application/json')) {
      return { errors: [] } as T;
    }
    try {
      return await response.clone().json() as T;
    } catch (error) {
      const err = error as Error;
      addErrorLog('C64 API parse failed', buildErrorLogDetails(err));
      return { errors: [] } as T;
    }
  }

  private logRestCall(method: string, path: string, status: number | 'error', startedAt: number) {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = Math.max(0, Math.round(endedAt - startedAt));
    addLog('debug', 'C64 API request', {
      method,
      path,
      status,
      latencyMs,
      baseUrl: this.getBaseUrl(),
      deviceHost: this.deviceHost,
    });
  }

  private async request<T>(
    path: string,
    options: (RequestInit & {
      timeoutMs?: number;
      __c64uTraceSuppressed?: boolean;
      __c64uIntent?: InteractionIntent;
      __c64uAllowDuringDiscovery?: boolean;
      __c64uBypassCache?: boolean;
      __c64uBypassCooldown?: boolean;
      __c64uBypassBackoff?: boolean;
    }) = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.buildAuthHeaders(),
      ...((options.headers as Record<string, string>) || {}),
    };

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const method = (options.method || 'GET').toString().toUpperCase();
    const timeoutMs = options.timeoutMs;
    const intent = options.__c64uIntent ?? 'user';
    const allowDuringDiscovery = Boolean(options.__c64uAllowDuringDiscovery);
    const bypassCache = Boolean(options.__c64uBypassCache);
    const bypassCooldown = Boolean(options.__c64uBypassCooldown);
    const bypassBackoff = Boolean(options.__c64uBypassBackoff);
    const requestOptions = { ...options } as RequestInit & {
      timeoutMs?: number;
      __c64uTraceSuppressed?: boolean;
      __c64uIntent?: InteractionIntent;
      __c64uAllowDuringDiscovery?: boolean;
      __c64uBypassCache?: boolean;
      __c64uBypassCooldown?: boolean;
      __c64uBypassBackoff?: boolean;
    };
    requestOptions.__c64uTraceSuppressed = true;
    delete (requestOptions as { __c64uIntent?: InteractionIntent }).__c64uIntent;
    delete (requestOptions as { __c64uAllowDuringDiscovery?: boolean }).__c64uAllowDuringDiscovery;
    delete (requestOptions as { __c64uBypassCache?: boolean }).__c64uBypassCache;
    delete (requestOptions as { __c64uBypassCooldown?: boolean }).__c64uBypassCooldown;
    delete (requestOptions as { __c64uBypassBackoff?: boolean }).__c64uBypassBackoff;
    delete (requestOptions as { timeoutMs?: number }).timeoutMs;

    return runWithImplicitAction(`rest.${method.toLowerCase()}`, async (action) => withRestInteraction({
      action,
      method,
      path,
      normalizedUrl: normalizeUrlPath(url),
      intent,
      baseUrl,
      allowDuringDiscovery,
      bypassCache,
      bypassCooldown,
      bypassBackoff,
    }, async () => {
      const requestId = buildRequestId();
      const idleContext = getIdleContext();
      const canRetryAfterIdle = RETRYABLE_IDLE_RECOVERY_METHODS.has(method);
      const maxAttempts = canRetryAfterIdle && idleContext.wasIdle ? 2 : 1;
      const bodyPayload = extractRequestBody(requestOptions.body);
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let status: number | 'error' = 'error';
        let responseRecorded = false;
        recordRestRequest(action, {
          method,
          url,
          normalizedUrl: normalizeUrlPath(url),
          headers,
          body: bodyPayload,
        });

        try {
          if (shouldBlockSmokeMutation(method)) {
            addErrorLog('Smoke mode blocked mutating request', buildErrorLogDetails(new Error('Smoke mode blocked mutating request'), {
              path,
              url,
              method,
              baseUrl,
              deviceHost: this.deviceHost,
            }));
            console.info('C64U_SMOKE_MUTATION_BLOCKED', JSON.stringify({ method, path, url, requestId }));
            throw new Error('Smoke mode blocked mutating request');
          }
          if (isFuzzModeEnabled() && !isFuzzSafeBaseUrl(baseUrl)) {
            addErrorLog('Fuzz mode blocked real device request', buildErrorLogDetails(new Error('Fuzz mode blocked request'), {
              path,
              url,
              baseUrl,
              deviceHost: this.deviceHost,
            }));
            const blocked = new Error('Fuzz mode blocked request') as Error & { __fuzzBlocked?: boolean };
            blocked.__fuzzBlocked = true;
            throw blocked;
          }

          if (isSmokeModeEnabled()) {
            console.info('C64U_HTTP', JSON.stringify({ method, path, url, requestId, attempt }));
          }

          // Use web fetch for all requests - CapacitorHttp patches it on native platforms
          const outerSignal = requestOptions.signal;
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
          const signal = controller ? controller.signal : outerSignal;
          const responsePromise = fetch(url, {
            ...requestOptions,
            headers,
            ...(signal ? { signal } : {}),
          });
          let timeoutPromiseId: ReturnType<typeof setTimeout> | null = null;
          const timeoutPromise = timeoutMs
            ? new Promise<never>((_, reject) => {
              timeoutPromiseId = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
            })
            : null;
          let response: Response;
          try {
            response = timeoutPromise
              ? await Promise.race([responsePromise, timeoutPromise])
              : await responsePromise;
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (outerSignal && controller) {
              outerSignal.removeEventListener('abort', abortFromOuter);
            }
            if (timeoutPromiseId) clearTimeout(timeoutPromiseId);
          }

          status = response.status;
          const durationMs = Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
          if (!response.ok) {
            const responseBody = await readResponseBody(response);
            const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
            const failure = classifyError(err, 'integration');
            recordRestResponse(action, { status: response.status, body: responseBody, durationMs, error: err });
            recordTraceError(action, err, failure);
            responseRecorded = true;
            throw err;
          }

          const parsedBody = await this.parseResponseJson<T>(response);
          recordRestResponse(action, { status: response.status, body: parsedBody, durationMs, error: null });
          responseRecorded = true;

          return parsedBody;
        } catch (error) {
          lastError = error;
          const fuzzBlocked = (error as { __fuzzBlocked?: boolean }).__fuzzBlocked;
          const rawMessage = (error as Error).message || 'Request failed';
          const isAbort = (error as { name?: string }).name === 'AbortError' || /timed out/i.test(rawMessage);
          const isNetworkFailure = isNetworkFailureMessage(rawMessage);
          const normalizedError = isAbort || isNetworkFailure ? resolveHostErrorMessage(rawMessage) : rawMessage;
          const durationMs = Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
          if (!responseRecorded) {
            const failure = classifyError(error);
            recordRestResponse(action, { status: status === 'error' ? null : status, body: null, durationMs, error: error as Error });
            recordTraceError(action, error as Error, failure);
          }
          if (!fuzzBlocked) {
            addErrorLog('C64 API request failed', buildErrorLogDetails(error as Error, {
              path,
              url,
              requestId,
              attempt,
              maxAttempts,
              retryCount: attempt - 1,
              method,
              deviceState: idleContext.deviceState,
              idleMs: idleContext.idleMs,
              wasIdle: idleContext.wasIdle,
              durationMs,
              error: normalizedError,
              rawError: rawMessage,
              errorDetail: isDnsFailure(rawMessage) ? 'DNS lookup failed' : undefined,
            }));
            console.info('C64U_HTTP_FAILURE', JSON.stringify({
              requestId,
              method,
              path,
              attempt,
              maxAttempts,
              idleMs: idleContext.idleMs,
              wasIdle: idleContext.wasIdle,
              durationMs,
              error: normalizedError,
            }));
          }

          const callerAborted = requestOptions.signal?.aborted === true;
          const shouldRetry = !callerAborted && attempt < maxAttempts && (isAbort || isNetworkFailure);
          if (shouldRetry) {
            const retryDelayMs = NETWORK_RETRY_DELAY_MS * attempt;
            addLog('warn', 'C64 API retry scheduled after idle failure', {
              requestId,
              method,
              path,
              attempt,
              maxAttempts,
              retryDelayMs,
              idleMs: idleContext.idleMs,
              wasIdle: idleContext.wasIdle,
            });
            console.info('C64U_HTTP_RETRY', JSON.stringify({
              requestId,
              method,
              path,
              attempt,
              maxAttempts,
              retryDelayMs,
            }));
            await waitWithAbortSignal(retryDelayMs, requestOptions.signal);
            continue;
          }

          if (callerAborted) {
            throw createAbortError();
          }

          if (isAbort || isNetworkFailure) {
            throw new Error(resolveHostErrorMessage(rawMessage));
          }
          throw error;
        } finally {
          this.logRestCall(method, path, status, startedAt);
        }
      }

      throw lastError as Error;
    }));
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit & { __c64uTraceSuppressed?: boolean },
    timeoutMs?: number,
  ): Promise<Response> {
    options.__c64uTraceSuppressed = true;
    const body = options.body;

    const method = (options.method || 'GET').toString().toUpperCase();

    return runWithImplicitAction(`rest.${method.toLowerCase()}`, async (action) => withRestInteraction({
      action,
      method,
      path: normalizeUrlPath(url),
      normalizedUrl: normalizeUrlPath(url),
      intent: 'user',
      baseUrl: (() => {
        try {
          return new URL(url).origin;
        } catch (error) {
          addLog('warn', 'Failed to parse base URL origin for upload', {
            url,
            error: (error as Error).message,
          });
          return '';
        }
      })(),
    }, async () => {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const requestId = buildRequestId();
      const idleContext = getIdleContext();
      const headers = (options.headers as Record<string, string>) || {};
      recordRestRequest(action, {
        method,
        url,
        normalizedUrl: normalizeUrlPath(url),
        headers,
        body: extractRequestBody(body),
      });

      if (isSmokeModeEnabled()) {
        console.info('C64U_HTTP', JSON.stringify({ method, url }));
      }

      // Use web fetch for all requests - CapacitorHttp patches it on native platforms
      // to handle FormData, Blob, ArrayBuffer, and other complex types natively
      const controller = timeoutMs ? new AbortController() : null;
      const timeoutId = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : null;
      let timeoutPromiseId: ReturnType<typeof setTimeout> | null = null;
      try {
        const responsePromise = fetch(url, {
          ...options,
          ...(controller ? { signal: controller.signal } : {}),
        });
        const timeoutPromise = timeoutMs
          ? new Promise<never>((_, reject) => {
            timeoutPromiseId = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
          })
          : null;
        const response = timeoutPromise
          ? await Promise.race([responsePromise, timeoutPromise])
          : await responsePromise;
        const durationMs = Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
        const responseBody = await readResponseBody(response);
        recordRestResponse(action, { status: response.status, body: responseBody, durationMs, error: null });
        return response;
      } catch (error) {
        const rawMessage = (error as Error).message || 'Request failed';
        const isAbort = (error as { name?: string }).name === 'AbortError' || /timed out/i.test(rawMessage);
        const isNetworkFailure = isNetworkFailureMessage(rawMessage);
        const normalizedError = isAbort || isNetworkFailure ? resolveHostErrorMessage(rawMessage) : rawMessage;
        const durationMs = Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
        const failure = classifyError(error);
        recordRestResponse(action, { status: null, body: null, durationMs, error: error as Error });
        recordTraceError(action, error as Error, failure);
        addErrorLog('C64 API upload failed', buildErrorLogDetails(error as Error, {
          url,
          requestId,
          method,
          path: normalizeUrlPath(url),
          deviceState: idleContext.deviceState,
          idleMs: idleContext.idleMs,
          wasIdle: idleContext.wasIdle,
          durationMs,
          error: normalizedError,
          rawError: rawMessage,
        }));
        console.info('C64U_HTTP_FAILURE', JSON.stringify({
          requestId,
          method,
          path: normalizeUrlPath(url),
          idleMs: idleContext.idleMs,
          wasIdle: idleContext.wasIdle,
          durationMs,
          error: normalizedError,
        }));
        if (isAbort || isNetworkFailure) {
          throw new Error(resolveHostErrorMessage(rawMessage));
        }
        throw error;
      } finally {
        if (timeoutPromiseId) clearTimeout(timeoutPromiseId);
        if (timeoutId) clearTimeout(timeoutId);
      }
    }));
  }

  // About endpoints
  async getVersion(): Promise<VersionInfo> {
    return this.request('/v1/version');
  }

  async getInfo(options: (RequestInit & {
    timeoutMs?: number;
    __c64uIntent?: InteractionIntent;
    __c64uAllowDuringDiscovery?: boolean;
    __c64uBypassCache?: boolean;
    __c64uBypassCooldown?: boolean;
    __c64uBypassBackoff?: boolean;
  }) = {}): Promise<DeviceInfo> {
    return this.request('/v1/info', options);
  }

  // Config endpoints
  async getCategories(): Promise<CategoriesResponse> {
    return this.request('/v1/configs');
  }

  async getCategory(category: string): Promise<ConfigResponse> {
    const encoded = encodeURIComponent(category);
    return this.request(`/v1/configs/${encoded}`);
  }

  async getConfigItem(category: string, item: string): Promise<ConfigResponse> {
    const catEncoded = encodeURIComponent(category);
    const itemEncoded = encodeURIComponent(item);
    return this.request(`/v1/configs/${catEncoded}/${itemEncoded}`);
  }

  async getConfigItems(category: string, items: string[]): Promise<ConfigResponse> {
    const responses = await Promise.allSettled(
      items.map((item) => this.getConfigItem(category, item)),
    );
    const mergedItems: Record<string, unknown> = {};
    responses.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const payload = result.value as Record<string, any>;
      const categoryBlock = payload?.[category] ?? payload;
      const itemsBlock = categoryBlock?.items ?? categoryBlock;
      if (!itemsBlock || typeof itemsBlock !== 'object') return;
      Object.entries(itemsBlock as Record<string, unknown>).forEach(([name, config]) => {
        if (name === 'errors') return;
        mergedItems[name] = config;
      });
    });
    return {
      [category]: {
        items: mergedItems,
      },
      errors: [],
    } as ConfigResponse;
  }

  async setConfigValue(category: string, item: string, value: string | number): Promise<ConfigResponse> {
    const catEncoded = encodeURIComponent(category);
    const itemEncoded = encodeURIComponent(item);
    const valEncoded = encodeURIComponent(String(value));
    return scheduleConfigWrite(() =>
      this.request(`/v1/configs/${catEncoded}/${itemEncoded}?value=${valEncoded}`, {
        method: 'PUT',
      }),
    );
  }

  async saveConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request('/v1/configs:save_to_flash', { method: 'PUT' }));
  }

  async loadConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request('/v1/configs:load_from_flash', { method: 'PUT' }));
  }

  async resetConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request('/v1/configs:reset_to_default', { method: 'PUT' }));
  }

  async updateConfigBatch(
    payload: Record<string, Record<string, string | number>>,
    options: { immediate?: boolean } = {},
  ): Promise<{ errors: string[] }> {
    const run = () =>
      this.request('/v1/configs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    if (options.immediate) {
      return run();
    }
    return scheduleConfigWrite(run);
  }

  // Machine control endpoints
  async machineReset(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:reset', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machineReboot(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:reboot', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machinePause(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:pause', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machineResume(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:resume', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machinePowerOff(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:poweroff', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machineMenuButton(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:menu_button', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async startStream(stream: string, ip: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/streams/${encodeURIComponent(stream)}:start?ip=${encodeURIComponent(ip)}`, {
      method: 'PUT',
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async stopStream(stream: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/streams/${encodeURIComponent(stream)}:stop`, {
      method: 'PUT',
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async readMemory(address: string, length = 1): Promise<Uint8Array> {
    const path = `/v1/machine:readmem?address=${address}&length=${length}`;
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...this.buildAuthHeaders(),
    };
    const response = await this.fetchWithTimeout(url, { headers }, CONTROL_REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`readMemory failed: HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/octet-stream') || contentType.includes('application/binary')) {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    }
    // Fall back to JSON parsing
    const payload = await response.json() as { data?: string | number[] };
    const data = payload.data;
    if (!data) return new Uint8Array();
    if (typeof data === 'string') {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    return new Uint8Array(data);
  }

  async writeMemory(address: string, data: Uint8Array): Promise<{ errors: string[] }> {
    const hex = Array.from(data)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return this.request(`/v1/machine:writemem?address=${address}&data=${hex}`, { method: 'PUT' });
  }

  async writeMemoryBlock(address: string, data: Uint8Array): Promise<{ errors: string[] }> {
    const path = `/v1/machine:writemem?address=${address}`;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const payload = new Uint8Array(data).buffer;
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: payload,
        },
        RAM_BLOCK_WRITE_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('Memory DMA write failed', buildErrorLogDetails(error, {
        status: response.status,
        statusText: response.statusText,
      }));
      throw error;
    }

    return this.parseResponseJson(response);
  }

  // Drive endpoints
  async getDrives(): Promise<DrivesResponse> {
    return this.request('/v1/drives');
  }

  async mountDrive(
    drive: 'a' | 'b',
    image: string,
    type?: string,
    mode?: 'readwrite' | 'readonly' | 'unlinked'
  ): Promise<{ errors: string[] }> {
    let path = `/v1/drives/${drive}:mount?image=${encodeURIComponent(image)}`;
    if (type) path += `&type=${encodeURIComponent(type)}`;
    if (mode) path += `&mode=${encodeURIComponent(mode)}`;
    return this.request(path, { method: 'PUT' });
  }

  async mountDriveUpload(
    drive: 'a' | 'b',
    image: Blob,
    type?: string,
    mode?: 'readwrite' | 'readonly' | 'unlinked'
  ): Promise<{ errors: string[] }> {
    let path = `/v1/drives/${drive}:mount`;
    if (type || mode) {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (mode) params.set('mode', mode);
      path = `${path}?${params.toString()}`;
    }

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      addLog('debug', 'Drive mount upload payload prepared', {
        drive,
        type: type ?? null,
        mode: mode ?? null,
        sizeBytes: typeof image?.size === 'number' ? image.size : null,
        baseUrl,
        deviceHost: this.deviceHost,
      });
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: image,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('Drive mount upload failed', buildErrorLogDetails(error, {
        status: response.status,
        statusText: response.statusText,
      }));
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async unmountDrive(drive: 'a' | 'b'): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:remove`, { method: 'PUT' });
  }

  async resetDrive(drive: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:reset`, { method: 'PUT' });
  }

  async driveOn(drive: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:on`, { method: 'PUT' });
  }

  async driveOff(drive: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:off`, { method: 'PUT' });
  }

  async setDriveMode(drive: string, mode: '1541' | '1571' | '1581'): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:set_mode?mode=${mode}`, { method: 'PUT' });
  }

  // Runner endpoints
  async playSid(file: string, songNr?: number): Promise<{ errors: string[] }> {
    let path = `/v1/runners:sidplay?file=${encodeURIComponent(file)}`;
    if (songNr !== undefined) path += `&songnr=${songNr}`;
    const baseUrl = this.getBaseUrl();
    const headers = this.buildAuthHeaders();
    addLog('debug', 'SID playback request', {
      baseUrl,
      deviceHost: this.deviceHost,
      url: `${baseUrl}${path}`,
      headerKeys: Object.keys(headers),
      proxyHostHeader: headers['X-C64U-Host'] ?? null,
      hasPasswordHeader: Boolean(headers['X-Password']),
    });
    return this.request(path, { method: 'PUT', timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS });
  }

  async playSidUpload(
    sidFile: Blob,
    songNr?: number,
    sslFile?: Blob,
  ): Promise<{ errors: string[] }> {
    const url = new URL(`${this.getBaseUrl()}/v1/runners:sidplay`);
    if (songNr !== undefined) {
      url.searchParams.set('songnr', String(songNr));
    }
    const headers = this.buildAuthHeaders();

    const form = new FormData();
    form.append('file', sidFile, (sidFile as any).name ?? 'track.sid');
    if (sslFile) {
      form.append('file', sslFile, (sslFile as any).name ?? 'songlengths.ssl');
    }

    const path = `${url.pathname}${url.search}`;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        url.toString(),
        {
          method,
          headers,
          body: form,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('SID upload failed', buildErrorLogDetails(error, {
        status: response.status,
        statusText: response.statusText,
      }));
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async playMod(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:modplay?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async playModUpload(modFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:modplay';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: modFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('MOD upload failed', buildErrorLogDetails(error, {
        status: response.status,
        statusText: response.statusText,
      }));
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async runPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_prg?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async runPrgUpload(prgFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:run_prg';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: prgFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('PRG upload failed', buildErrorLogDetails(error, {
        status: response.status,
        statusText: response.statusText,
      }));
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async loadPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:load_prg?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async loadPrgUpload(prgFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:load_prg';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: prgFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('PRG upload failed', buildErrorLogDetails(error, {
        status: response.status,
        statusText: response.statusText,
      }));
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async runCartridge(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_crt?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async runCartridgeUpload(crtFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:run_crt';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: crtFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('CRT upload failed', buildErrorLogDetails(error, {
        status: response.status,
        statusText: response.statusText,
      }));
      throw error;
    }

    return this.parseResponseJson(response);
  }
}

// Singleton instance
let apiInstance: C64API | null = null;
let apiProxy: C64API | null = null;

const createApiProxy = (api: C64API): C64API => new Proxy(api, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  },
});

export function getC64API(): C64API {
  if (!apiInstance) {
    const resolvedDeviceHost = resolveDeviceHostFromStorage();
    const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
    const cachedPassword = getCachedPassword();
    apiInstance = new C64API(resolvedBaseUrl, cachedPassword ?? undefined, resolvedDeviceHost);
    if (!lastDeviceHost) {
      lastDeviceHost = apiInstance.getDeviceHost();
    }
    if (hasStoredPasswordFlag() && cachedPassword === null) {
      void loadStoredPassword().then((password) => {
        apiInstance?.setPassword(password ?? undefined);
      });
    }
  }
  if (!apiProxy) {
    apiProxy = createApiProxy(apiInstance);
  }
  return apiProxy;
}

export function updateC64APIConfig(baseUrl: string, password?: string, deviceHost?: string) {
  const api = getC64API();
  const resolvedDeviceHost = resolvePreferredDeviceHost(baseUrl, deviceHost);
  const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);

  api.setBaseUrl(resolvedBaseUrl);
  api.setPassword(password);
  api.setDeviceHost(resolvedDeviceHost);
  localStorage.removeItem('c64u_base_url');
  localStorage.setItem('c64u_device_host', resolvedDeviceHost);
  localStorage.removeItem('c64u_password');
  if (password) {
    void storePassword(password);
  } else {
    void clearStoredPassword();
  }

  addLog('info', 'API routing updated (persisted)', {
    baseUrl: resolvedBaseUrl,
    deviceHost: resolvedDeviceHost,
  });
  logDeviceHostChange(resolvedDeviceHost, { baseUrl: resolvedBaseUrl, mode: 'persisted' });
  if (isSmokeModeEnabled()) {
    console.info('C64U_ROUTING_UPDATED', JSON.stringify({ baseUrl: resolvedBaseUrl, deviceHost: resolvedDeviceHost, mode: 'persisted' }));
  }

  window.dispatchEvent(
    new CustomEvent('c64u-connection-change', {
      detail: {
        baseUrl: resolvedBaseUrl,
        password: password || '',
        deviceHost: resolvedDeviceHost,
      },
    }),
  );
}

export type C64ApiConfigSnapshot = {
  baseUrl: string;
  password?: string;
  deviceHost: string;
};

export function getC64APIConfigSnapshot(): C64ApiConfigSnapshot {
  const api = getC64API();
  return {
    baseUrl: api.getBaseUrl(),
    password: api.getPassword(),
    deviceHost: api.getDeviceHost(),
  };
}

/**
 * Update the active in-memory API configuration without persisting it.
 * This is used for session-limited modes (e.g. Demo Mode).
 */
export function applyC64APIRuntimeConfig(baseUrl: string, password?: string, deviceHost?: string) {
  const api = getC64API();
  const resolvedDeviceHost = resolvePreferredDeviceHost(baseUrl, deviceHost);
  const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
  api.setBaseUrl(resolvedBaseUrl);
  api.setPassword(password);
  api.setDeviceHost(resolvedDeviceHost);
  addLog('info', 'API routing updated (runtime)', {
    baseUrl: resolvedBaseUrl,
    deviceHost: resolvedDeviceHost,
  });
  logDeviceHostChange(resolvedDeviceHost, { baseUrl: resolvedBaseUrl, mode: 'runtime' });
  if (isSmokeModeEnabled()) {
    console.info('C64U_ROUTING_UPDATED', JSON.stringify({ baseUrl: resolvedBaseUrl, deviceHost: resolvedDeviceHost, mode: 'runtime' }));
  }

  window.dispatchEvent(
    new CustomEvent('c64u-connection-change', {
      detail: {
        baseUrl: resolvedBaseUrl,
        password: password || '',
        deviceHost: resolvedDeviceHost,
      },
    }),
  );
}

export async function applyC64APIConfigFromStorage() {
  const savedPassword = await loadStoredPassword();
  const resolvedDeviceHost = resolveDeviceHostFromStorage();
  const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
  applyC64APIRuntimeConfig(resolvedBaseUrl, savedPassword ?? undefined, resolvedDeviceHost);
}

export const C64_DEFAULTS = {
  DEFAULT_BASE_URL,
  DEFAULT_DEVICE_HOST,
  DEFAULT_PROXY_URL,
};
