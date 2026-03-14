/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// C64 Ultimate REST API Client

import {
  clearPassword as clearStoredPassword,
  getCachedPassword,
  getPassword as loadStoredPassword,
  hasStoredPasswordFlag,
  setPassword as storePassword,
} from "@/lib/secureStorage";
import { addErrorLog, addLog, buildErrorLogDetails } from "@/lib/logging";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";
import { isSmokeModeEnabled, isSmokeReadOnlyEnabled } from "@/lib/smoke/smokeMode";
import { isFuzzModeEnabled, isFuzzSafeBaseUrl } from "@/lib/fuzz/fuzzMode";
import { scheduleConfigWrite } from "@/lib/config/configWriteThrottle";
import { runWithImplicitAction } from "@/lib/tracing/actionTrace";
import { recordRestRequest, recordRestResponse, recordTraceError } from "@/lib/tracing/traceSession";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { withRestInteraction, type InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import {
  DEFAULT_BASE_URL,
  DEFAULT_DEVICE_HOST,
  DEFAULT_PROXY_URL,
  WEB_PROXY_PATH,
  buildBaseUrlFromDeviceHost,
  getDeviceHostFromBaseUrl,
  isLocalProxy,
  normalizeDeviceHost,
  resolveDeviceHostFromStorage,
  resolvePlatformApiBaseUrl,
  resolvePreferredDeviceHost,
} from "@/lib/c64api/hostConfig";
import {
  awaitPromiseWithAbortSignal,
  buildReadRequestDedupeKey,
  cloneBudgetValue,
  createAbortError,
  estimateBudgetValueBytes,
  extractRequestBody,
  getIdleContext,
  normalizeUrlPath,
  readResponseBody,
  wait,
  waitWithAbortSignal,
} from "@/lib/c64api/requestRuntime";
const CONTROL_REQUEST_TIMEOUT_MS = 3000;
const UPLOAD_REQUEST_TIMEOUT_MS = 5000;
const PLAYBACK_REQUEST_TIMEOUT_MS = 5000;
const RAM_BLOCK_WRITE_TIMEOUT_MS = 15_000;
const IDLE_RECOVERY_THRESHOLD_MS = 10_000;
const NETWORK_RETRY_DELAY_MS = 180;
const SID_UPLOAD_MAX_ATTEMPTS = 3;
const SID_UPLOAD_RETRYABLE_HTTP_STATUS = new Set([502, 503, 504]);
const RETRYABLE_IDLE_RECOVERY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEDUPEABLE_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const READ_REQUEST_BUDGET_WINDOW_MS = 500;
const READ_REQUEST_BUDGET_MAX_ENTRIES = 256;
const READ_REQUEST_BUDGET_MAX_VALUE_BYTES = 64 * 1024;

const isDnsFailure = (message: string) => /unknown host|enotfound|ename_not_found|dns/i.test(message);
const isNetworkFailureMessage = (message: string) =>
  /failed to fetch|networkerror|network request failed|unknown host|enotfound|ename_not_found|dns/i.test(message);
const resolveHostErrorMessage = (message: string) =>
  isDnsFailure(message) ? "Host unreachable (DNS)" : "Host unreachable";

const parseHttpStatusFromErrorMessage = (message: string) => {
  const match = /http\s+(\d{3})/i.exec(message);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
};

const isSidUploadTransientFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isNetworkFailureMessage(message) || /timed out|timeout|host unreachable/i.test(message)) {
    return true;
  }
  const status = parseHttpStatusFromErrorMessage(message);
  return status !== null && SID_UPLOAD_RETRYABLE_HTTP_STATUS.has(status);
};

let requestSequence = 0;
const buildRequestId = () => {
  requestSequence = (requestSequence + 1) % 1_000_000;
  return `c64req-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
};

let lastDeviceHost: string | null = null;

const logDeviceHostChange = (nextHost: string, context: { baseUrl: string; mode: "persisted" | "runtime" }) => {
  if (lastDeviceHost && lastDeviceHost !== nextHost) {
    addLog("info", "API device host changed", {
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
    const override =
      (
        globalThis as {
          __C64U_NATIVE_OVERRIDE__?: boolean;
          __c64uAllowNativePlatform?: boolean;
        }
      ).__C64U_NATIVE_OVERRIDE__ ??
      (typeof window !== "undefined"
        ? (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__
        : undefined) ??
      (globalThis as { __c64uAllowNativePlatform?: boolean }).__c64uAllowNativePlatform;
    if (typeof override === "boolean") {
      return override;
    }
    if (typeof process !== "undefined") {
      const env = (process as { env?: Record<string, string | undefined> }).env ?? {};
      if (env.VITEST === "true" || env.NODE_ENV === "test") {
        return false;
      }
    }
    return Boolean((window as any)?.Capacitor?.isNativePlatform?.());
  } catch (error) {
    addLog("warn", "Failed to detect native platform in API client", {
      error: (error as Error).message,
    });
    return false;
  }
};

const isReadOnlyMethod = (method: string) => ["GET", "HEAD", "OPTIONS"].includes(method);

const shouldBlockSmokeMutation = (method: string) =>
  isSmokeModeEnabled() && isSmokeReadOnlyEnabled() && !isReadOnlyMethod(method);

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
  [itemName: string]:
    | {
        selected?: string | number;
        options?: string[];
        details?: {
          min?: number;
          max?: number;
          format?: string;
          presets?: string[];
        };
      }
    | string
    | number;
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

type C64ReadRequestOptions = RequestInit & {
  timeoutMs?: number;
  __c64uTraceSuppressed?: boolean;
  __c64uIntent?: InteractionIntent;
  __c64uAllowDuringDiscovery?: boolean;
  __c64uBypassCache?: boolean;
  __c64uBypassCooldown?: boolean;
  __c64uBypassBackoff?: boolean;
};

const hasStructuredConfigMetadata = (config: unknown) => {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return false;

  const record = config as Record<string, unknown>;
  return [
    "selected",
    "value",
    "current",
    "current_value",
    "currentValue",
    "default",
    "default_value",
    "defaultValue",
    "options",
    "values",
    "choices",
    "details",
    "presets",
    "min",
    "max",
    "minimum",
    "maximum",
    "format",
  ].some((key) => Object.prototype.hasOwnProperty.call(record, key));
};

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
  private apiBaseUrl: string;
  private readonly inFlightReadRequests = new Map<string, Promise<unknown>>();
  private readonly readRequestBudget = new Map<string, { recordedAtMs: number; value: unknown }>();

  constructor(baseUrl: string = DEFAULT_BASE_URL, password?: string, deviceHost: string = DEFAULT_DEVICE_HOST) {
    this.deviceHost = normalizeDeviceHost(deviceHost || getDeviceHostFromBaseUrl(baseUrl));
    const initialBaseUrl =
      import.meta.env.VITE_WEB_PLATFORM === "1" ? baseUrl : buildBaseUrlFromDeviceHost(this.deviceHost);
    this.apiBaseUrl = resolvePlatformApiBaseUrl(this.deviceHost, initialBaseUrl);
    this.password = password;
  }

  setBaseUrl(url: string) {
    if (import.meta.env.VITE_WEB_PLATFORM !== "1") {
      this.deviceHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(url));
    }
    this.apiBaseUrl = resolvePlatformApiBaseUrl(this.deviceHost, url);
    this.resetRequestReadState();
  }

  setPassword(password?: string) {
    this.password = password;
    this.resetRequestReadState();
  }

  setDeviceHost(deviceHost?: string) {
    this.deviceHost = normalizeDeviceHost(deviceHost);
    this.apiBaseUrl = resolvePlatformApiBaseUrl(this.deviceHost, buildBaseUrlFromDeviceHost(this.deviceHost));
    this.resetRequestReadState();
  }

  getBaseUrl() {
    return this.apiBaseUrl;
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
      headers["X-Password"] = this.password;
    }
    const baseUrl = this.getBaseUrl();
    if (baseUrl.includes(WEB_PROXY_PATH) || isLocalProxy(baseUrl)) {
      headers["X-C64U-Host"] = this.deviceHost;
    }
    return headers;
  }

  private async buildBinaryUploadRequest(body: Blob): Promise<{
    headers: Record<string, string>;
    body: ArrayBuffer;
  }> {
    const uploadBody =
      typeof body.arrayBuffer === "function" ? await body.arrayBuffer() : await new Response(body).arrayBuffer();
    return {
      headers: {
        ...this.buildAuthHeaders(),
        "Content-Type": "application/octet-stream",
      },
      body: uploadBody,
    };
  }

  private buildMalformedResponseError(
    path: string,
    response: Response,
    reason: "non-json-content-type" | "invalid-json",
    details?: { contentType?: string; parseError?: string },
  ) {
    const contentType = details?.contentType ?? response.headers.get("content-type")?.toLowerCase() ?? "";
    const error = new Error(`Malformed JSON response for ${path}: HTTP ${response.status} (${reason})`) as Error & {
      code?: "C64API_MALFORMED_JSON_RESPONSE";
      c64api?: {
        path: string;
        status: number;
        reason: "non-json-content-type" | "invalid-json";
        contentType: string;
      };
    };
    error.code = "C64API_MALFORMED_JSON_RESPONSE";
    error.c64api = {
      path,
      status: response.status,
      reason,
      contentType,
    };
    addErrorLog(
      "C64 API parse failed",
      buildErrorLogDetails(error, {
        path,
        status: response.status,
        reason,
        contentType,
        parseError: details?.parseError,
      }),
    );
    return error;
  }

  private async parseResponseJson<T>(
    response: Response,
    path: string,
    options?: { allowNonJsonSuccess?: boolean },
  ): Promise<T> {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      if (options?.allowNonJsonSuccess) {
        addLog("warn", "C64 API non-JSON success payload accepted", {
          path,
          status: response.status,
          contentType,
        });
        return { errors: [] } as T;
      }
      throw this.buildMalformedResponseError(path, response, "non-json-content-type", { contentType });
    }
    try {
      return (await response.clone().json()) as T;
    } catch (error) {
      throw this.buildMalformedResponseError(path, response, "invalid-json", {
        contentType,
        parseError: (error as Error).message,
      });
    }
  }

  private logRestCall(method: string, path: string, status: number | "error", startedAt: number) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const latencyMs = Math.max(0, Math.round(endedAt - startedAt));
    addLog("debug", "C64 API request", {
      method,
      path,
      status,
      latencyMs,
      baseUrl: this.getBaseUrl(),
      deviceHost: this.deviceHost,
    });
  }

  private resetRequestReadState() {
    this.inFlightReadRequests.clear();
    this.readRequestBudget.clear();
  }

  private getReadRequestBudgetValue<T>(key: string, nowMs: number): T | null {
    this.pruneReadRequestBudget(nowMs);
    const cached = this.readRequestBudget.get(key);
    if (!cached) return null;
    if (nowMs - cached.recordedAtMs > READ_REQUEST_BUDGET_WINDOW_MS) {
      this.readRequestBudget.delete(key);
      return null;
    }
    return cloneBudgetValue(cached.value as T);
  }

  private saveReadRequestBudgetValue(key: string, value: unknown) {
    const nowMs = Date.now();
    this.pruneReadRequestBudget(nowMs);
    const budgetValue = cloneBudgetValue(value);
    const estimatedBytes = estimateBudgetValueBytes(budgetValue);
    if (estimatedBytes !== null && estimatedBytes > READ_REQUEST_BUDGET_MAX_VALUE_BYTES) {
      addLog("debug", "Skipping oversized C64 API request budget value", {
        key,
        estimatedBytes,
        maxBytes: READ_REQUEST_BUDGET_MAX_VALUE_BYTES,
      });
      return;
    }
    this.readRequestBudget.set(key, {
      recordedAtMs: nowMs,
      value: budgetValue,
    });
    while (this.readRequestBudget.size > READ_REQUEST_BUDGET_MAX_ENTRIES) {
      const oldestKey = this.readRequestBudget.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.readRequestBudget.delete(oldestKey);
    }
  }

  private pruneReadRequestBudget(nowMs: number) {
    this.readRequestBudget.forEach((entry, key) => {
      if (nowMs - entry.recordedAtMs > READ_REQUEST_BUDGET_WINDOW_MS) {
        this.readRequestBudget.delete(key);
      }
    });
  }

  private async request<T>(path: string, options: C64ReadRequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(),
      ...((options.headers as Record<string, string>) || {}),
    };

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const method = (options.method || "GET").toString().toUpperCase();
    const timeoutMs = options.timeoutMs;
    const intent = options.__c64uIntent ?? "user";
    const allowDuringDiscovery = Boolean(options.__c64uAllowDuringDiscovery);
    const bypassCache = Boolean(options.__c64uBypassCache);
    const bypassCooldown = Boolean(options.__c64uBypassCooldown);
    const bypassBackoff = Boolean(options.__c64uBypassBackoff);
    const requestOptions = { ...options } as C64ReadRequestOptions;
    requestOptions.__c64uTraceSuppressed = true;
    delete (requestOptions as { __c64uIntent?: InteractionIntent }).__c64uIntent;
    delete (requestOptions as { __c64uAllowDuringDiscovery?: boolean }).__c64uAllowDuringDiscovery;
    delete (requestOptions as { __c64uBypassCache?: boolean }).__c64uBypassCache;
    delete (requestOptions as { __c64uBypassCooldown?: boolean }).__c64uBypassCooldown;
    delete (requestOptions as { __c64uBypassBackoff?: boolean }).__c64uBypassBackoff;
    delete (requestOptions as { timeoutMs?: number }).timeoutMs;

    const readRequestKey = buildReadRequestDedupeKey(method, url, headers, requestOptions.body);
    const allowInFlightDedupe = Boolean(readRequestKey) && !bypassCache;
    const allowBudgetReplay = allowInFlightDedupe && !bypassCooldown;

    if (allowBudgetReplay && readRequestKey) {
      const cachedValue = this.getReadRequestBudgetValue<T>(readRequestKey, Date.now());
      if (cachedValue !== null) {
        addLog("debug", "C64 API request budget replay hit", {
          method,
          path,
          readRequestKey,
        });
        return awaitPromiseWithAbortSignal(Promise.resolve(cachedValue), requestOptions.signal);
      }
    }

    if (allowInFlightDedupe && readRequestKey) {
      const inFlight = this.inFlightReadRequests.get(readRequestKey);
      if (inFlight) {
        addLog("debug", "C64 API in-flight dedupe hit", {
          method,
          path,
          readRequestKey,
        });
        return awaitPromiseWithAbortSignal(inFlight as Promise<T>, requestOptions.signal);
      }
    }

    const executeRequest = () =>
      runWithImplicitAction(`rest.${method.toLowerCase()}`, async (action) =>
        withRestInteraction(
          {
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
          },
          async () => {
            const requestId = buildRequestId();
            const idleContext = getIdleContext();
            const canRetryAfterIdle = RETRYABLE_IDLE_RECOVERY_METHODS.has(method);
            const maxAttempts = canRetryAfterIdle && idleContext.wasIdle ? 2 : 1;
            const bodyPayload = extractRequestBody(requestOptions.body);
            const requestSignal = requestOptions.signal;
            let lastError: unknown = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
              let status: number | "error" = "error";
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
                  addErrorLog(
                    "Smoke mode blocked mutating request",
                    buildErrorLogDetails(new Error("Smoke mode blocked mutating request"), {
                      path,
                      url,
                      method,
                      baseUrl,
                      deviceHost: this.deviceHost,
                    }),
                  );
                  console.info("C64U_SMOKE_MUTATION_BLOCKED", JSON.stringify({ method, path, url, requestId }));
                  throw new Error("Smoke mode blocked mutating request");
                }
                if (isFuzzModeEnabled() && !isFuzzSafeBaseUrl(baseUrl)) {
                  addErrorLog(
                    "Fuzz mode blocked real device request",
                    buildErrorLogDetails(new Error("Fuzz mode blocked request"), {
                      path,
                      url,
                      baseUrl,
                      deviceHost: this.deviceHost,
                    }),
                  );
                  const blocked = new Error("Fuzz mode blocked request") as Error & { __fuzzBlocked?: boolean };
                  blocked.__fuzzBlocked = true;
                  throw blocked;
                }

                if (isSmokeModeEnabled()) {
                  console.info("C64U_HTTP", JSON.stringify({ method, path, url, requestId, attempt }));
                }

                // Keep C64U REST calls stateless and avoid cookie bridge churn on native startup.
                const outerSignal = requestSignal;
                const controller = timeoutMs ? new AbortController() : null;
                const abortFromOuter = () => controller?.abort();
                if (outerSignal && controller) {
                  if (outerSignal.aborted) {
                    controller.abort();
                  } else {
                    outerSignal.addEventListener("abort", abortFromOuter, {
                      once: true,
                    });
                  }
                }
                const timeoutId = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : null;
                const signal = controller ? controller.signal : outerSignal;
                const responsePromise = fetch(url, {
                  ...requestOptions,
                  headers,
                  credentials: requestOptions.credentials ?? "omit",
                  ...(signal ? { signal } : {}),
                });
                let timeoutPromiseId: ReturnType<typeof setTimeout> | null = null;
                const timeoutPromise = timeoutMs
                  ? new Promise<never>((_, reject) => {
                      timeoutPromiseId = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
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
                    outerSignal.removeEventListener("abort", abortFromOuter);
                  }
                  if (timeoutPromiseId) clearTimeout(timeoutPromiseId);
                }

                status = response.status;
                const durationMs = Math.max(
                  0,
                  Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
                );
                if (!response.ok) {
                  const responseBody = await readResponseBody(response);
                  const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
                  const failure = classifyError(err, "integration");
                  recordRestResponse(action, {
                    status: response.status,
                    body: responseBody,
                    durationMs,
                    error: err,
                  });
                  recordTraceError(action, err, failure);
                  responseRecorded = true;
                  throw err;
                }

                const parsedBody = await this.parseResponseJson<T>(response, path);
                recordRestResponse(action, {
                  status: response.status,
                  body: parsedBody,
                  durationMs,
                  error: null,
                });
                responseRecorded = true;

                if (!DEDUPEABLE_READ_METHODS.has(method)) {
                  this.resetRequestReadState();
                }

                return parsedBody;
              } catch (error) {
                lastError = error;
                const fuzzBlocked = (error as { __fuzzBlocked?: boolean }).__fuzzBlocked;
                const rawMessage = (error as Error).message || "Request failed";
                const isAbort = (error as { name?: string }).name === "AbortError" || /timed out/i.test(rawMessage);
                const isNetworkFailure = isNetworkFailureMessage(rawMessage);
                const normalizedError = isAbort || isNetworkFailure ? resolveHostErrorMessage(rawMessage) : rawMessage;
                const durationMs = Math.max(
                  0,
                  Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
                );
                if (!responseRecorded) {
                  const failure = classifyError(error);
                  recordRestResponse(action, {
                    status: status === "error" ? null : status,
                    body: null,
                    durationMs,
                    error: error as Error,
                  });
                  recordTraceError(action, error as Error, failure);
                }
                if (!fuzzBlocked && intent !== "system") {
                  const isTransientFailure =
                    isAbort ||
                    isNetworkFailure ||
                    isTransientConnectivityFailure(rawMessage) ||
                    isTransientConnectivityFailure(normalizedError);
                  const failureDetails = buildErrorLogDetails(error as Error, {
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
                    errorDetail: isDnsFailure(rawMessage) ? "DNS lookup failed" : undefined,
                  });
                  // Always log as error so the entry is captured when the diagnostics
                  // overlay is open (warn is suppressed by the overlay). The transient
                  // flag distinguishes recoverable network blips from genuine defects.
                  addErrorLog(
                    "C64 API request failed",
                    isTransientFailure ? { ...failureDetails, transient: true } : failureDetails,
                  );
                  console.info(
                    "C64U_HTTP_FAILURE",
                    JSON.stringify({
                      requestId,
                      method,
                      path,
                      attempt,
                      maxAttempts,
                      idleMs: idleContext.idleMs,
                      wasIdle: idleContext.wasIdle,
                      durationMs,
                      error: normalizedError,
                    }),
                  );
                }

                const callerAborted = requestSignal?.aborted === true;
                const shouldRetry = !callerAborted && attempt < maxAttempts && (isAbort || isNetworkFailure);
                if (shouldRetry) {
                  const retryDelayMs = NETWORK_RETRY_DELAY_MS * attempt;
                  addLog("warn", "C64 API retry scheduled after idle failure", {
                    requestId,
                    method,
                    path,
                    attempt,
                    maxAttempts,
                    retryDelayMs,
                    idleMs: idleContext.idleMs,
                    wasIdle: idleContext.wasIdle,
                  });
                  console.info(
                    "C64U_HTTP_RETRY",
                    JSON.stringify({
                      requestId,
                      method,
                      path,
                      attempt,
                      maxAttempts,
                      retryDelayMs,
                    }),
                  );
                  await waitWithAbortSignal(retryDelayMs, requestSignal);
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
          },
        ),
      );

    if (!allowInFlightDedupe || !readRequestKey) {
      return executeRequest();
    }

    const sharedPromise = executeRequest()
      .then((result) => {
        if (allowBudgetReplay) {
          this.saveReadRequestBudgetValue(readRequestKey, result);
        }
        return result;
      })
      .finally(() => {
        this.inFlightReadRequests.delete(readRequestKey);
      });
    this.inFlightReadRequests.set(readRequestKey, sharedPromise as Promise<unknown>);
    return awaitPromiseWithAbortSignal(sharedPromise, requestOptions.signal);
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit & { __c64uTraceSuppressed?: boolean },
    timeoutMs?: number,
  ): Promise<Response> {
    options.__c64uTraceSuppressed = true;
    const body = options.body;

    const method = (options.method || "GET").toString().toUpperCase();

    return runWithImplicitAction(`rest.${method.toLowerCase()}`, async (action) =>
      withRestInteraction(
        {
          action,
          method,
          path: normalizeUrlPath(url),
          normalizedUrl: normalizeUrlPath(url),
          intent: "user",
          baseUrl: (() => {
            try {
              return new URL(url).origin;
            } catch (error) {
              addLog("warn", "Failed to parse base URL origin for upload", {
                url,
                error: (error as Error).message,
              });
              return "";
            }
          })(),
        },
        async () => {
          const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
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
            console.info("C64U_HTTP", JSON.stringify({ method, url }));
          }

          // Keep upload/control calls stateless to avoid cookie bridge lookups.
          const controller = timeoutMs ? new AbortController() : null;
          const timeoutId = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : null;
          let timeoutPromiseId: ReturnType<typeof setTimeout> | null = null;
          try {
            const responsePromise = fetch(url, {
              ...options,
              credentials: options.credentials ?? "omit",
              ...(controller ? { signal: controller.signal } : {}),
            });
            const timeoutPromise = timeoutMs
              ? new Promise<never>((_, reject) => {
                  timeoutPromiseId = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
                })
              : null;
            const response = timeoutPromise
              ? await Promise.race([responsePromise, timeoutPromise])
              : await responsePromise;
            const durationMs = Math.max(
              0,
              Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
            );
            const responseBody = await readResponseBody(response);
            recordRestResponse(action, {
              status: response.status,
              body: responseBody,
              durationMs,
              error: null,
            });
            return response;
          } catch (error) {
            const rawMessage = (error as Error).message || "Request failed";
            const isAbort = (error as { name?: string }).name === "AbortError" || /timed out/i.test(rawMessage);
            const isNetworkFailure = isNetworkFailureMessage(rawMessage);
            const normalizedError = isAbort || isNetworkFailure ? resolveHostErrorMessage(rawMessage) : rawMessage;
            const durationMs = Math.max(
              0,
              Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
            );
            const failure = classifyError(error);
            recordRestResponse(action, {
              status: null,
              body: null,
              durationMs,
              error: error as Error,
            });
            recordTraceError(action, error as Error, failure);
            const transientUploadFailure = isAbort || isNetworkFailure || isTransientConnectivityFailure(rawMessage);
            const uploadFailureDetails = buildErrorLogDetails(error as Error, {
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
            });
            // Always log as error so the entry is captured when the diagnostics
            // overlay is open. The transient flag marks recoverable upload failures.
            addErrorLog(
              "C64 API upload failed",
              transientUploadFailure ? { ...uploadFailureDetails, transient: true } : uploadFailureDetails,
            );
            console.info(
              "C64U_HTTP_FAILURE",
              JSON.stringify({
                requestId,
                method,
                path: normalizeUrlPath(url),
                idleMs: idleContext.idleMs,
                wasIdle: idleContext.wasIdle,
                durationMs,
                error: normalizedError,
              }),
            );
            if (isAbort || isNetworkFailure) {
              throw new Error(resolveHostErrorMessage(rawMessage));
            }
            throw error;
          } finally {
            if (timeoutPromiseId) clearTimeout(timeoutPromiseId);
            if (timeoutId) clearTimeout(timeoutId);
          }
        },
      ),
    );
  }

  // About endpoints
  async getVersion(): Promise<VersionInfo> {
    return this.request("/v1/version");
  }

  async getInfo(options: C64ReadRequestOptions = {}): Promise<DeviceInfo> {
    return this.request("/v1/info", options);
  }

  // Config endpoints
  async getCategories(options: C64ReadRequestOptions = {}): Promise<CategoriesResponse> {
    return this.request("/v1/configs", options);
  }

  async getCategory(category: string, options: C64ReadRequestOptions = {}): Promise<ConfigResponse> {
    const encoded = encodeURIComponent(category);
    return this.request(`/v1/configs/${encoded}`, options);
  }

  async getConfigItem(category: string, item: string, options: C64ReadRequestOptions = {}): Promise<ConfigResponse> {
    const catEncoded = encodeURIComponent(category);
    const itemEncoded = encodeURIComponent(item);
    return this.request(`/v1/configs/${catEncoded}/${itemEncoded}`, options);
  }

  async getConfigItems(
    category: string,
    items: string[],
    options: C64ReadRequestOptions = {},
  ): Promise<ConfigResponse> {
    const uniqueItems = Array.from(new Set(items));
    if (!uniqueItems.length) {
      return {
        [category]: {
          items: {},
        },
        errors: [],
      } as ConfigResponse;
    }

    const mergedItems: Record<string, unknown> = {};
    const itemsNeedingEnrichment = new Set<string>();
    try {
      const categoryPayload = await this.getCategory(category, options);
      const payload = categoryPayload as Record<string, any>;
      const categoryBlock = payload?.[category] ?? payload;
      const itemsBlock = categoryBlock?.items ?? categoryBlock;
      if (itemsBlock && typeof itemsBlock === "object") {
        uniqueItems.forEach((item) => {
          if (Object.prototype.hasOwnProperty.call(itemsBlock, item)) {
            const itemConfig = (itemsBlock as Record<string, unknown>)[item];
            mergedItems[item] = itemConfig;
            if (!hasStructuredConfigMetadata(itemConfig)) {
              itemsNeedingEnrichment.add(item);
            }
          }
        });
      }
    } catch (error) {
      addLog("warn", "Category config fetch failed; falling back to item fetches", {
        category,
        error: (error as Error).message,
      });
    }

    const missingItems = uniqueItems.filter(
      (item) => !Object.prototype.hasOwnProperty.call(mergedItems, item) || itemsNeedingEnrichment.has(item),
    );
    if (missingItems.length > 0) {
      const responses = await Promise.allSettled(
        missingItems.map((item) => this.getConfigItem(category, item, options)),
      );
      responses.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const payload = result.value as Record<string, any>;
        const categoryBlock = payload?.[category] ?? payload;
        const itemsBlock = categoryBlock?.items ?? categoryBlock;
        if (!itemsBlock || typeof itemsBlock !== "object") return;
        Object.entries(itemsBlock as Record<string, unknown>).forEach(([name, config]) => {
          if (name === "errors") return;
          mergedItems[name] = config;
        });
      });
    }

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
        method: "PUT",
      }),
    );
  }

  async saveConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request("/v1/configs:save_to_flash", { method: "PUT" }));
  }

  async loadConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request("/v1/configs:load_from_flash", { method: "PUT" }));
  }

  async resetConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request("/v1/configs:reset_to_default", { method: "PUT" }));
  }

  async updateConfigBatch(
    payload: Record<string, Record<string, string | number>>,
    options: { immediate?: boolean } = {},
  ): Promise<{ errors: string[] }> {
    const run = () =>
      this.request("/v1/configs", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    if (options.immediate) {
      return run();
    }
    return scheduleConfigWrite(run);
  }

  // Machine control endpoints
  async machineReset(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:reset", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async machineReboot(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:reboot", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async machinePause(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:pause", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async machineResume(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:resume", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async machinePowerOff(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:poweroff", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async machineMenuButton(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:menu_button", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async startStream(stream: string, ip: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/streams/${encodeURIComponent(stream)}:start?ip=${encodeURIComponent(ip)}`, {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  async stopStream(stream: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/streams/${encodeURIComponent(stream)}:stop`, {
      method: "PUT",
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
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/octet-stream") || contentType.includes("application/binary")) {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    }
    // Fall back to JSON parsing
    const payload = (await response.json()) as { data?: string | number[] };
    const data = payload.data;
    if (!data) return new Uint8Array();
    if (typeof data === "string") {
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
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return this.request(`/v1/machine:writemem?address=${address}&data=${hex}`, {
      method: "PUT",
    });
  }

  async writeMemoryBlock(address: string, data: Uint8Array): Promise<{ errors: string[] }> {
    const path = `/v1/machine:writemem?address=${address}`;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
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
            "Content-Type": "application/octet-stream",
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
      addErrorLog(
        "Memory DMA write failed",
        buildErrorLogDetails(error, {
          status: response.status,
          statusText: response.statusText,
        }),
      );
      throw error;
    }

    return this.parseResponseJson(response, path, {
      allowNonJsonSuccess: true,
    });
  }

  // Drive endpoints
  async getDrives(options: C64ReadRequestOptions = {}): Promise<DrivesResponse> {
    return this.request("/v1/drives", options);
  }

  async mountDrive(
    drive: "a" | "b",
    image: string,
    type?: string,
    mode?: "readwrite" | "readonly" | "unlinked",
  ): Promise<{ errors: string[] }> {
    let path = `/v1/drives/${drive}:mount?image=${encodeURIComponent(image)}`;
    if (type) path += `&type=${encodeURIComponent(type)}`;
    if (mode) path += `&mode=${encodeURIComponent(mode)}`;
    return this.request(path, { method: "PUT" });
  }

  async mountDriveUpload(
    drive: "a" | "b",
    image: Blob,
    type?: string,
    mode?: "readwrite" | "readonly" | "unlinked",
  ): Promise<{ errors: string[] }> {
    let path = `/v1/drives/${drive}:mount`;
    if (type || mode) {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (mode) params.set("mode", mode);
      path = `${path}?${params.toString()}`;
    }

    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(image);
      addLog("debug", "Drive mount upload payload prepared", {
        drive,
        type: type ?? null,
        mode: mode ?? null,
        sizeBytes: typeof image?.size === "number" ? image.size : null,
        baseUrl,
        deviceHost: this.deviceHost,
      });
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog(
        "Drive mount upload failed",
        buildErrorLogDetails(error, {
          status: response.status,
          statusText: response.statusText,
        }),
      );
      throw error;
    }

    return this.parseResponseJson(response, path, {
      allowNonJsonSuccess: true,
    });
  }

  async unmountDrive(drive: "a" | "b"): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:remove`, { method: "PUT" });
  }

  async resetDrive(drive: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:reset`, { method: "PUT" });
  }

  async driveOn(drive: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:on`, { method: "PUT" });
  }

  async driveOff(drive: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:off`, { method: "PUT" });
  }

  async setDriveMode(drive: string, mode: "1541" | "1571" | "1581"): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:set_mode?mode=${mode}`, {
      method: "PUT",
    });
  }

  // Runner endpoints
  async playSid(file: string, songNr?: number): Promise<{ errors: string[] }> {
    let path = `/v1/runners:sidplay?file=${encodeURIComponent(file)}`;
    if (songNr !== undefined) path += `&songnr=${songNr}`;
    const baseUrl = this.getBaseUrl();
    const headers = this.buildAuthHeaders();
    addLog("debug", "SID playback request", {
      baseUrl,
      deviceHost: this.deviceHost,
      url: `${baseUrl}${path}`,
      headerKeys: Object.keys(headers),
      proxyHostHeader: headers["X-C64U-Host"] ?? null,
      hasPasswordHeader: Boolean(headers["X-Password"]),
    });
    return this.request(path, {
      method: "PUT",
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async playSidUpload(sidFile: Blob, songNr?: number, sslFile?: Blob): Promise<{ errors: string[] }> {
    const url = new URL(`${this.getBaseUrl()}/v1/runners:sidplay`);
    if (songNr !== undefined) {
      url.searchParams.set("songnr", String(songNr));
    }
    const headers = this.buildAuthHeaders();

    const form = new FormData();
    form.append("file", sidFile, (sidFile as any).name ?? "track.sid");
    if (sslFile) {
      form.append("file", sslFile, (sslFile as any).name ?? "songlengths.ssl");
    }

    const path = `${url.pathname}${url.search}`;
    const method = "POST";
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= SID_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      let status: number | "error" = "error";
      try {
        const response = await this.fetchWithTimeout(
          url.toString(),
          {
            method,
            headers,
            body: form,
          },
          UPLOAD_REQUEST_TIMEOUT_MS,
        );
        status = response.status;

        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          addErrorLog(
            "SID upload failed",
            buildErrorLogDetails(error, {
              status: response.status,
              statusText: response.statusText,
              attempt,
              maxAttempts: SID_UPLOAD_MAX_ATTEMPTS,
            }),
          );
          throw error;
        }

        return this.parseResponseJson(response, path, {
          allowNonJsonSuccess: true,
        });
      } catch (error) {
        const err = error as Error;
        lastError = err;
        const transient = isSidUploadTransientFailure(err);
        if (attempt < SID_UPLOAD_MAX_ATTEMPTS && transient) {
          const retryDelayMs = NETWORK_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          const failure = classifyError(err);
          addLog("warn", "SID upload retry scheduled", {
            path,
            attempt,
            maxAttempts: SID_UPLOAD_MAX_ATTEMPTS,
            retryDelayMs,
            failureClass: failure.failureClass,
            errorCategory: failure.category,
            error: err.message,
          });
          await wait(retryDelayMs);
          continue;
        }
        throw err;
      } finally {
        this.logRestCall(method, path, status, startedAt);
      }
    }

    throw lastError ?? new Error("SID upload failed");
  }

  async playMod(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:modplay?file=${encodeURIComponent(file)}`, {
      method: "PUT",
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async playModUpload(modFile: Blob): Promise<{ errors: string[] }> {
    const path = "/v1/runners:modplay";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(modFile);
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog(
        "MOD upload failed",
        buildErrorLogDetails(error, {
          status: response.status,
          statusText: response.statusText,
        }),
      );
      throw error;
    }

    return this.parseResponseJson(response, path, {
      allowNonJsonSuccess: true,
    });
  }

  async runPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_prg?file=${encodeURIComponent(file)}`, {
      method: "PUT",
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async runPrgUpload(prgFile: Blob): Promise<{ errors: string[] }> {
    const path = "/v1/runners:run_prg";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(prgFile);
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog(
        "PRG upload failed",
        buildErrorLogDetails(error, {
          status: response.status,
          statusText: response.statusText,
        }),
      );
      throw error;
    }

    return this.parseResponseJson(response, path, {
      allowNonJsonSuccess: true,
    });
  }

  async loadPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:load_prg?file=${encodeURIComponent(file)}`, {
      method: "PUT",
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async loadPrgUpload(prgFile: Blob): Promise<{ errors: string[] }> {
    const path = "/v1/runners:load_prg";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(prgFile);
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog(
        "PRG upload failed",
        buildErrorLogDetails(error, {
          status: response.status,
          statusText: response.statusText,
        }),
      );
      throw error;
    }

    return this.parseResponseJson(response, path, {
      allowNonJsonSuccess: true,
    });
  }

  async runCartridge(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_crt?file=${encodeURIComponent(file)}`, {
      method: "PUT",
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async runCartridgeUpload(crtFile: Blob): Promise<{ errors: string[] }> {
    const path = "/v1/runners:run_crt";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(crtFile);
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog(
        "CRT upload failed",
        buildErrorLogDetails(error, {
          status: response.status,
          statusText: response.statusText,
        }),
      );
      throw error;
    }

    return this.parseResponseJson(response, path, {
      allowNonJsonSuccess: true,
    });
  }
}

// Singleton instance
let apiInstance: C64API | null = null;
let apiProxy: C64API | null = null;

const createApiProxy = (api: C64API): C64API =>
  new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });

export function getC64API(): C64API {
  if (!apiInstance) {
    const resolvedDeviceHost = resolveDeviceHostFromStorage();
    const resolvedBaseUrl = resolvePlatformApiBaseUrl(
      resolvedDeviceHost,
      buildBaseUrlFromDeviceHost(resolvedDeviceHost),
    );
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
  const resolvedBaseUrl = resolvePlatformApiBaseUrl(resolvedDeviceHost, buildBaseUrlFromDeviceHost(resolvedDeviceHost));

  api.setBaseUrl(resolvedBaseUrl);
  api.setPassword(password);
  api.setDeviceHost(resolvedDeviceHost);
  localStorage.removeItem("c64u_base_url");
  localStorage.setItem("c64u_device_host", resolvedDeviceHost);
  localStorage.removeItem("c64u_password");
  if (password) {
    void storePassword(password);
  } else {
    void clearStoredPassword();
  }

  addLog("info", "API routing updated (persisted)", {
    baseUrl: resolvedBaseUrl,
    deviceHost: resolvedDeviceHost,
  });
  logDeviceHostChange(resolvedDeviceHost, {
    baseUrl: resolvedBaseUrl,
    mode: "persisted",
  });
  if (isSmokeModeEnabled()) {
    console.info(
      "C64U_ROUTING_UPDATED",
      JSON.stringify({
        baseUrl: resolvedBaseUrl,
        deviceHost: resolvedDeviceHost,
        mode: "persisted",
      }),
    );
  }

  window.dispatchEvent(
    new CustomEvent("c64u-connection-change", {
      detail: {
        baseUrl: resolvedBaseUrl,
        password: password || "",
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
  const resolvedBaseUrl = resolvePlatformApiBaseUrl(resolvedDeviceHost, baseUrl);
  api.setBaseUrl(resolvedBaseUrl);
  api.setPassword(password);
  api.setDeviceHost(resolvedDeviceHost);
  addLog("info", "API routing updated (runtime)", {
    baseUrl: resolvedBaseUrl,
    deviceHost: resolvedDeviceHost,
  });
  logDeviceHostChange(resolvedDeviceHost, {
    baseUrl: resolvedBaseUrl,
    mode: "runtime",
  });
  if (isSmokeModeEnabled()) {
    console.info(
      "C64U_ROUTING_UPDATED",
      JSON.stringify({
        baseUrl: resolvedBaseUrl,
        deviceHost: resolvedDeviceHost,
        mode: "runtime",
      }),
    );
  }

  window.dispatchEvent(
    new CustomEvent("c64u-connection-change", {
      detail: {
        baseUrl: resolvedBaseUrl,
        password: password || "",
        deviceHost: resolvedDeviceHost,
      },
    }),
  );
}

export async function applyC64APIConfigFromStorage() {
  const savedPassword = await loadStoredPassword();
  const resolvedDeviceHost = resolveDeviceHostFromStorage();
  const resolvedBaseUrl = resolvePlatformApiBaseUrl(resolvedDeviceHost, buildBaseUrlFromDeviceHost(resolvedDeviceHost));
  applyC64APIRuntimeConfig(resolvedBaseUrl, savedPassword ?? undefined, resolvedDeviceHost);
}

export const C64_DEFAULTS = {
  DEFAULT_BASE_URL,
  DEFAULT_DEVICE_HOST,
  DEFAULT_PROXY_URL,
};

export { buildBaseUrlFromDeviceHost, getDeviceHostFromBaseUrl, normalizeDeviceHost, resolveDeviceHostFromStorage };
