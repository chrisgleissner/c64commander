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
import { updateSelectedSavedDeviceConnection } from "@/lib/savedDevices/store";
import { notifyAuthRequired, notifyAuthSatisfied } from "@/lib/auth/authChallenge";
import { isAuthRequiredHttpStatus } from "@/lib/c64api/transportErrors";
import { addErrorLog, addLog, buildErrorLogDetails } from "@/lib/logging";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";
import { getSmokeConfig, isSmokeModeEnabled, isSmokeReadOnlyEnabled } from "@/lib/smoke/smokeMode";
import { isFuzzModeEnabled, isFuzzSafeBaseUrl } from "@/lib/fuzz/fuzzMode";
import { scheduleConfigWrite } from "@/lib/config/configWriteThrottle";
import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";
import { FirmwareConfigWriteError } from "@/lib/config/configWriteErrors";
import { extractConfigValue } from "@/lib/config/configValueExtractor";
import {
  getConfigCategoryItems,
  validateConfigBatchWrite,
  validateConfigWrite,
} from "@/lib/config/validateConfigWrite";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { runWithImplicitAction } from "@/lib/tracing/actionTrace";
import { recordRestRequest, recordRestResponse, recordTraceError } from "@/lib/tracing/traceSession";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { withRestInteraction, type InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import {
  DEFAULT_BASE_URL,
  DEFAULT_DEVICE_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_PROXY_URL,
  WEB_PROXY_PATH,
  buildBaseUrlFromDeviceHost,
  getDeviceHostHttpPort,
  getDeviceHostFromBaseUrl,
  hasPersistedDeviceHostConfig,
  isLocalProxy,
  normalizeDeviceHost,
  persistDeviceHostToStorage,
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
  getIdleContext,
  inspectRequestPayload,
  inspectResponsePayload,
  isAbortLikeError,
  normalizeUrlPath,
  wait,
} from "@/lib/c64api/requestRuntime";
import {
  loadConfigEnrichmentCategory,
  loadConfigEnrichmentNamespaceForHost,
  rememberConfigEnrichmentNamespaceForHost,
  saveConfigEnrichmentCategory,
} from "@/lib/c64api/configEnrichmentCache";
import { buildBinaryFingerprint } from "@/lib/binaryFingerprint";
import { TransmissionGuard, type SupportedC64FileType, type TransmissionValidationContext } from "@/lib/fileValidation";
import { collectTraceHeaders } from "@/lib/tracing/payloadPreview";
import { notifyReachable } from "@/lib/connection/reachabilityEvents";
import { getLifecycleState } from "@/lib/appLifecycle";
import { CapacitorHttp } from "@capacitor/core";

// A request that fails with a generic network/timeout class while the app is
// in the background is almost always the WebView/Capacitor pausing the request
// when the user backgrounds the app, not a real device problem. The matching
// rest-response already carries `expectedFailure:true, lifecycleState:"background"`
// (see recordRestResponse below), but a separate `error` trace event would still
// surface to derivePrimaryProblem and degrade the App contributor. Treat such
// failures as expected so the foreground UI stays Healthy when the user returns
// to a reachable device. (BUG-069)
const isExpectedBackgroundNetworkFailure = (
  error: Error | null | undefined,
  isAbort: boolean,
  isNetworkFailure: boolean,
  isTimeout: boolean,
): boolean => {
  if (isAbort) return false;
  if (!isNetworkFailure && !isTimeout) return false;
  if (getLifecycleState() !== "background") return false;
  const message = error instanceof Error ? error.message : "";
  return !/auth|unauthor|forbidden|401|403|404|500|http \d/i.test(message);
};
// Two timeout budgets for non-upload, non-playback requests:
// - INTERACTIVE: user-tappable controls and config writes the user is
//   staring at. Tighter than the firmware p99 (~600 ms) so a stuck
//   request surfaces feedback within ~1.5 s instead of the prior 3 s.
// - BACKGROUND: polling, prefetch, health checks. Tolerates slow
//   firmware paths under load.
export const INTERACTIVE_CONTROL_TIMEOUT_MS = 1500;
export const BACKGROUND_REQUEST_TIMEOUT_MS = 3000;
// Backwards-compatible aliases (kept until all call sites are migrated).
const CONTROL_REQUEST_TIMEOUT_MS = INTERACTIVE_CONTROL_TIMEOUT_MS;
const SCHEDULED_REQUEST_TIMEOUT_MS = BACKGROUND_REQUEST_TIMEOUT_MS;
const UPLOAD_REQUEST_TIMEOUT_MS = 5000;
const PLAYBACK_REQUEST_TIMEOUT_MS = 5000;
// Drive mount/eject are heavier firmware ops than a tappable control: real
// c64u-resident mounts were measured at ~0.8-1.8 s and can be slower under
// load. The default INTERACTIVE budget (1500 ms) aborts a slow-but-successful
// mount and mislabels it "Host unreachable" (the abort failure message), which
// then sticks in the per-drive status. Give mount/eject an intentional, larger
// budget so a normal mount is never falsely timed out.
const MOUNT_REQUEST_TIMEOUT_MS = 8000;
const RAM_BLOCK_WRITE_TIMEOUT_MS = 15_000;
const IDLE_RECOVERY_THRESHOLD_MS = 10_000;
const NETWORK_RETRY_DELAY_MS = 180;
const SID_UPLOAD_MAX_ATTEMPTS = 3;
const SID_UPLOAD_RETRYABLE_HTTP_STATUS = new Set([502, 503, 504]);
const DEDUPEABLE_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const READ_REQUEST_BUDGET_WINDOW_MS = 500;
const READ_REQUEST_BUDGET_MAX_ENTRIES = 256;
const READ_REQUEST_BUDGET_MAX_VALUE_BYTES = 64 * 1024;
const CONFIG_WRITE_REQUEST_OPTIONS = {
  timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
} as const;

const resolveDefaultRestRequestTimeoutMs = (intent: InteractionIntent) =>
  intent === "background" ? BACKGROUND_REQUEST_TIMEOUT_MS : INTERACTIVE_CONTROL_TIMEOUT_MS;

/**
 * Returns the lone {category,item,value} of a config-write payload that targets
 * exactly one item in one category, or null if it spans multiple items/categories.
 * Used to route single-item writes to the body-less `PUT` endpoint instead of the
 * temp-file-buffering `POST /v1/configs` batch handler (see `updateConfigBatch`).
 */
const singleConfigEntry = (
  payload: Record<string, Record<string, string | number>>,
): { category: string; item: string; value: string | number } | null => {
  const categories = Object.entries(payload);
  if (categories.length !== 1) return null;
  const [category, updates] = categories[0];
  const items = Object.entries(updates);
  if (items.length !== 1) return null;
  const [item, value] = items[0];
  return { category, item, value };
};

// E2E/test-probe builds drive a mock device that models realistic firmware
// latencies (mount ~744 ms, stream start ~1015 ms) and run under coverage
// instrumentation across parallel CI shards, all of which inflate wall-clock
// time far beyond the production-tuned interactive budget. Floor every timed
// request's effective timeout in those builds so a healthy-but-slow mocked
// response is not aborted as "Host unreachable". Production budgets are unchanged.
const TEST_PROBE_REQUEST_TIMEOUT_FLOOR_MS = 8000;

// Read lazily and defensively: `import.meta.env` is undefined when this module is
// loaded by the Playwright runner in Node (e.g. `playwright test --list`), so
// touching it at module scope would throw there and break test collection.
const isTestProbeTimeoutFloorEnabled = () => {
  const env = import.meta.env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
  return env?.VITE_ENABLE_TEST_PROBES === "1";
};

const readViteEnv = () =>
  import.meta.env as
    | {
        VITE_ENABLE_TEST_PROBES?: string;
        VITE_WEB_PLATFORM?: string;
      }
    | undefined;

const resolveEffectiveRequestTimeoutMs = (timeoutMs?: number) =>
  timeoutMs !== undefined && isTestProbeTimeoutFloorEnabled() && TEST_PROBE_REQUEST_TIMEOUT_FLOOR_MS > timeoutMs
    ? TEST_PROBE_REQUEST_TIMEOUT_FLOOR_MS
    : timeoutMs;

type RestFailureKind = "timeout" | "abort" | "network" | "http-status";

const annotateRestFailure = <T extends Error>(
  error: T,
  kind: RestFailureKind,
  details: { httpStatus?: number; callerCancelled?: boolean } = {},
): T => {
  Object.assign(error, {
    c64uRestFailureKind: kind,
    ...(details.httpStatus !== undefined ? { c64uHttpStatus: details.httpStatus } : {}),
    ...(details.callerCancelled ? { c64uCallerCancelled: true } : {}),
  });
  return error;
};

// Build a concise HTTP error message. When statusText is empty (common in HTTP/2)
// omit the trailing colon so the message reads "HTTP 404" instead of "HTTP 404: ".
const buildHttpErrorMessage = (status: number, statusText: string): string => {
  const text = statusText?.trim();
  return text ? `HTTP ${status}: ${text}` : `HTTP ${status}`;
};

const normalizeConfigWriteToken = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const U64_SPECIFIC_SETTINGS_CATEGORY = "U64 Specific Settings";
const U64_TURBO_CONTROL_ITEM = "Turbo Control";
const U64_CPU_SPEED_DEPENDENT_ITEMS = new Set(["CPU Speed", "Badline Timing", "SuperCPU Detect (D0BC)"]);

const isTurboControlOffValue = (value: string | number) =>
  typeof value === "string" && normalizeConfigWriteToken(value) === "off";

const orderFirmwareSafeConfigUpdates = (
  category: string,
  updates: Record<string, string | number>,
): Array<[string, string | number]> => {
  const entries = Object.entries(updates);
  if (
    category !== U64_SPECIFIC_SETTINGS_CATEGORY ||
    !Object.prototype.hasOwnProperty.call(updates, U64_TURBO_CONTROL_ITEM) ||
    !entries.some(([item]) => U64_CPU_SPEED_DEPENDENT_ITEMS.has(item))
  ) {
    return entries;
  }

  const turboEntry = entries.find(([item]) => item === U64_TURBO_CONTROL_ITEM);
  if (!turboEntry) {
    return entries;
  }

  const turboFirst = !isTurboControlOffValue(turboEntry[1]);
  const ordered: Array<[string, string | number]> = [];
  let turboAdded = false;

  for (const entry of entries) {
    const [item] = entry;
    if (item === U64_TURBO_CONTROL_ITEM) {
      continue;
    }
    if (turboFirst && U64_CPU_SPEED_DEPENDENT_ITEMS.has(item) && !turboAdded) {
      ordered.push(turboEntry);
      turboAdded = true;
    }
    ordered.push(entry);
  }

  if (!turboAdded) {
    ordered.push(turboEntry);
  }

  return ordered;
};

// Combined POSTs that write Turbo Control together with a CPU-speed-dependent
// item have twice coincided with the Ultimate dropping off the network
// mid-write (BUG-010 on u64 3.14e, 2026-06-12 on c64u 1.1.0), while
// single-item writes are reliable. Send such batches as sequential
// single-item requests; the config write throttle spaces them out.
const requiresSequentialItemWrites = (category: string, entries: Array<[string, string | number]>) =>
  category === U64_SPECIFIC_SETTINGS_CATEGORY &&
  entries.length > 1 &&
  entries.some(([item]) => item === U64_TURBO_CONTROL_ITEM) &&
  entries.some(([item]) => U64_CPU_SPEED_DEPENDENT_ITEMS.has(item));

const resolveDeclaredConfigWriteValue = (
  category: string,
  item: string,
  value: string | number,
  categoryPayload: unknown,
) => {
  if (typeof value !== "string") return value;
  const itemConfig = getConfigCategoryItems(categoryPayload, category)[item];
  if (itemConfig === undefined) return value;
  const options = normalizeConfigItem(itemConfig).options;
  if (!Array.isArray(options) || options.length === 0 || options.includes(value)) return value;
  const normalizedValue = normalizeConfigWriteToken(value);
  const matches = options.filter((option) => normalizeConfigWriteToken(option) === normalizedValue);
  return matches.length === 1 ? matches[0] : value;
};

// The Ultimate firmware lists "CPU Speed" choices as space-padded single-digit
// tokens (" 1".." 8") and rejects the unpadded form with
// "Value '8' is not a valid choice for item CPU Speed" (verified on u64 3.14e).
// The Home summary read returns CPU Speed as a bare value with no choices array,
// so the slider falls back to unpadded option constants and the write path has
// no declared options to map against. Re-pad single-digit CPU Speed writes for
// every Ultimate family (the item lives under "U64 Specific Settings", which
// applies to both u64 and C64U) and for numeric as well as string input, so the
// drag does not silently fail and snap back. (BUG-064)
const resolveU64CpuSpeedConfigWriteValue = (category: string, item: string, value: string | number) => {
  if (category !== "U64 Specific Settings" || item !== "CPU Speed") {
    return value;
  }
  const trimmedValue = typeof value === "string" ? value.trim() : String(value);
  return /^[1-9]$/.test(trimmedValue) ? ` ${trimmedValue}` : value;
};

const resolveConfigWriteValue = (category: string, item: string, value: string | number, categoryPayload: unknown) =>
  resolveU64CpuSpeedConfigWriteValue(
    category,
    item,
    resolveDeclaredConfigWriteValue(category, item, value, categoryPayload),
  );

const isDnsFailure = (message: string) => /unknown host|enotfound|ename_not_found|dns/i.test(message);
const isNetworkFailureMessage = (message: string) =>
  /failed to fetch|networkerror|network request failed|unknown host|enotfound|ename_not_found|dns/i.test(message);
const resolveHostErrorMessage = (message: string) =>
  isDnsFailure(message) ? "Host unreachable (DNS)" : "Host unreachable";
const isDeviceNotReadyRequestGate = (message: string) => /device not ready for requests/i.test(message);
const isUnsupportedSignalError = (error: unknown) =>
  error instanceof Error && error.message.includes("Expected signal") && error.message.includes("AbortSignal");

const fetchWithSignalCompatibility = async (
  input: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> => {
  const { signal: _ignoredSignal, ...initWithoutSignal } = init;
  try {
    return await fetch(input, {
      ...initWithoutSignal,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (!signal?.aborted && isUnsupportedSignalError(error)) {
      return fetch(input, initWithoutSignal);
    }
    throw error;
  }
};

// Statuses whose responses must not carry a body; the Response constructor throws
// ("Response with null body status cannot have body") if we pass one.
const NULL_BODY_HTTP_STATUSES = new Set([101, 103, 204, 205, 304]);

// Decode the binary body CapacitorHttp returns for a responseType:"arraybuffer" request
// (base64 string on native; raw byte array as a defensive fallback). Mirrors the
// production-proven decoder in src/lib/archive/client.ts (kept inline to avoid coupling
// the device API client to the archive module). `atob` performs forgiving-base64 decode,
// so the line-wrapped Android Base64.DEFAULT output decodes correctly.
const decodeNativeBase64ToArrayBuffer = (value: unknown): ArrayBuffer => {
  if (value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]).buffer;
  if (typeof value === "string") {
    if (typeof atob === "function") {
      const decoded = atob(value);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0)).buffer;
    }
    return Uint8Array.from(Buffer.from(value, "base64")).buffer as ArrayBuffer;
  }
  return new ArrayBuffer(0);
};

// Native device REST transport.
//
// On native platforms the Capacitor-patched `window.fetch` routes through the native
// HTTP client (Android: OkHttp-backed HttpURLConnection) but it neither forwards a
// connect/read timeout (the underlying timeout therefore defaults to 0 = infinite) nor
// lets us control the `Connection` header (it is stripped/managed by the stack, so the
// wire is always keep-alive). Connections are consequently pooled and reused. When the
// device's TCP endpoint silently goes away — e.g. it is rebooted and its fresh stack no
// longer knows the old socket, sending no RST — a request that reuses such a pooled
// connection blocks forever at the native read. The JS-level AbortSignal/timeout rejects
// the JS promise but cannot cancel the native read, so the dead connection is never
// marked broken: OkHttp keeps handing it back out and every probe times out. The device
// looks offline until the OS finally tears the half-open socket down (~30s) or the app is
// restarted (a fresh process starts with an empty pool) — which is exactly why a
// fresh-process CLI health check succeeds while the running app stays wedged.
//
// Calling CapacitorHttp.request directly lets us set a real native connect/read timeout.
// A reused-but-dead connection now fails fast with a socket timeout; OkHttp evicts it and
// the next request opens a fresh connection, so the app recovers on its own within a probe
// cycle instead of staying offline until a restart. (BUG-066)
const capacitorHttpDeviceFetch = async (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null },
  timeoutMs: number,
  responseType: "json" | "arraybuffer" = "json",
): Promise<Response> => {
  const method = (init.method || "GET").toUpperCase();
  const headers = init.headers ?? {};
  let native: { status: number; headers?: Record<string, string>; data?: unknown };
  try {
    native = await CapacitorHttp.request({
      url,
      method,
      headers,
      ...(init.body != null ? { data: init.body } : {}),
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      responseType,
    });
  } catch (error) {
    // Normalize to the shape the patched WebFetch produces on a transport error so the
    // downstream classification / circuit-breaker / retry logic stays unchanged.
    const message = error instanceof Error ? error.message : String(error ?? "");
    throw new Error(
      /time\s?d?\s?out|timeout/i.test(message)
        ? `Failed to fetch: timed out (${message})`
        : `Failed to fetch (${message})`,
    );
  }

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries((native.headers ?? {}) as Record<string, string>)) {
    if (value != null) responseHeaders.set(key, String(value));
  }
  const status = native.status;
  const data = native.data;

  // Binary responses (responseType "arraybuffer") come back as a base64 string we decode
  // to the original bytes. CapacitorHttp still parses a JSON content-type into an object
  // even when arraybuffer was requested, so an object here is the JSON path (e.g. an error
  // body or readMemory's JSON fallback) — fall through to the JSON branch below.
  if (responseType === "arraybuffer" && typeof data === "string") {
    return new Response(NULL_BODY_HTTP_STATUSES.has(status) ? null : decodeNativeBase64ToArrayBuffer(data), {
      status,
      statusText: "",
      headers: responseHeaders,
    });
  }

  // CapacitorHttp parses JSON bodies into an object; mirror the on-wire content type so
  // the JSON parsing in parseResponseJson/inspectResponsePayload accepts the body.
  const body = typeof data === "string" ? data : JSON.stringify(data ?? {});
  if (typeof data !== "string" && !responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", "application/json");
  }
  return new Response(NULL_BODY_HTTP_STATUSES.has(status) ? null : body, {
    status,
    statusText: "",
    headers: responseHeaders,
  });
};

const parseHttpStatusFromErrorMessage = (message: string) => {
  const match = /http\s+(\d{3})/i.exec(message);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
};

const getHeaderValue = (headers: HeadersInit | undefined, name: string): string | null => {
  if (!headers) return null;
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  const direct = record[name];
  if (typeof direct === "string") return direct;
  const ciKey = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return ciKey ? (record[ciKey] ?? null) : null;
};

const isOctetStreamRequest = (headers: HeadersInit | undefined) => {
  const contentType = getHeaderValue(headers, "content-type");
  if (!contentType) return false;
  return contentType.split(";")[0]?.trim().toLowerCase() === "application/octet-stream";
};

const normalizeNativeBinaryRequestBody = (
  body: BodyInit | null | undefined,
  headers: HeadersInit | undefined,
): { body: BodyInit | null | undefined; transport: "default" | "file" } => {
  if (!isNativePlatform() || typeof File === "undefined" || !isOctetStreamRequest(headers) || body == null) {
    return { body, transport: "default" };
  }

  if (body instanceof File) {
    return { body, transport: "file" };
  }

  if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return {
      body: new File([body], "upload.bin", { type: "application/octet-stream" }),
      transport: "file",
    };
  }

  return { body, transport: "default" };
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

// Serialize native direct-device REST requests: at most one connection to the
// device is in flight at a time. The C64 Ultimate / C64U firmware (esp. c64u
// 1.1.0, which lacks the lwIP socket-timeout/polling and Tx-starvation fixes the
// 3.14x line shipped — GideonZ/1541ultimate 57c7c8a6a / 802d6143b / ddd28dd17 /
// fdb521a5b) runs a single-threaded network task on a single shared Rx/Tx WiFi
// buffer and does not time out stuck sockets. Concurrent connections starve its
// Tx path and pile up sockets it never reclaims, which can drive the embedded TCP
// stack into a permanent wedge (all TCP services dead, ICMP alive, recover only on
// a power-cycle). Serializing our requests keeps us to one connection at a time so
// we never trigger that on the unfixed firmware. (The cure is a c64u firmware
// update; see docs/c64/c64u-firmware-tcp-wedge-report.md.)
let activeNativeDeviceRequests = 0;
const nativeDeviceRequestQueue: Array<{ limit: number; resolve: () => void }> = [];
const pumpNativeDeviceRequestQueue = () => {
  while (
    nativeDeviceRequestQueue.length > 0 &&
    activeNativeDeviceRequests < (nativeDeviceRequestQueue[0]?.limit ?? 1)
  ) {
    const next = nativeDeviceRequestQueue.shift();
    if (!next) break;
    activeNativeDeviceRequests += 1;
    next.resolve();
  }
};
// Run `run` once a device connection slot is free, allowing at most
// `maxConcurrent` native device requests in flight at a time (1 = fully
// serialized — one connection). The limit comes from the resolved device-safety
// profile (restMaxConcurrency): CONSERVATIVE = 1 for the unfixed-firmware c64u,
// higher for firmware that shipped the Ultimate network-stack fixes. Exported for
// unit testing. See docs/c64/c64u-firmware-tcp-wedge-report.md.
export const serializeNativeDeviceRequest = async <T>(run: () => Promise<T>, maxConcurrent = 1): Promise<T> => {
  const limit = Number.isFinite(maxConcurrent) ? Math.max(1, Math.floor(maxConcurrent)) : 1;
  await new Promise<void>((resolve) => {
    nativeDeviceRequestQueue.push({ limit, resolve });
    pumpNativeDeviceRequestQueue();
  });
  try {
    return await run();
  } finally {
    activeNativeDeviceRequests = Math.max(0, activeNativeDeviceRequests - 1);
    pumpNativeDeviceRequestQueue();
  }
};

const createTimedRequestSignal = (outerSignal: AbortSignal | undefined, timeoutMs?: number) => {
  const effectiveTimeoutMs = resolveEffectiveRequestTimeoutMs(timeoutMs);
  let timedOut = false;
  const controller = effectiveTimeoutMs ? new AbortController() : null;
  const abortFromOuter = () => controller?.abort();
  if (outerSignal && controller) {
    if (outerSignal.aborted) {
      controller.abort();
    } else {
      outerSignal.addEventListener("abort", abortFromOuter, { once: true });
    }
  }
  const timeoutId =
    effectiveTimeoutMs && controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, effectiveTimeoutMs)
      : null;

  return {
    signal: controller ? controller.signal : outerSignal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (outerSignal && controller) {
        outerSignal.removeEventListener("abort", abortFromOuter);
      }
    },
  };
};

const noteRestReachable = (url: string, deviceHost: string, deviceInfo: DeviceInfo | null = null) => {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return deviceHost;
    }
  })();
  notifyReachable(host, "rest", deviceInfo);
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

type UploadValidationMetadata = {
  filename?: string;
};

const getUploadFilename = (body: Blob) => {
  const candidate = (body as Blob & { name?: unknown }).name;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
};

const extractUploadFilename = (body: Blob, fallbackName: string) => {
  return getUploadFilename(body) ?? fallbackName;
};

const requireUploadFilename = (body: Blob, metadata: UploadValidationMetadata, operation: string) => {
  const filename = metadata.filename ?? getUploadFilename(body);
  if (filename) {
    return filename;
  }
  throw new Error(`${operation} requires a File upload or explicit metadata.filename for Blob uploads`);
};

const resolveDiskUploadType = (type?: string): SupportedC64FileType | undefined => {
  if (type === "d64" || type === "d71" || type === "d81") {
    return type;
  }
  return undefined;
};

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
  __c64uAllowDuringError?: boolean;
  __c64uBypassCache?: boolean;
  __c64uBypassCooldown?: boolean;
  __c64uBypassBackoff?: boolean;
  __c64uBypassCircuit?: boolean;
  __c64uExpectedMissing?: boolean;
  __c64uExpectedFailure?: boolean;
  __c64uSkipItemEnrichment?: boolean;
  __c64uSkipSuccessBodyInspection?: boolean;
  /**
   * Suppress the global "network password required" popup for this call. Set on
   * background connection/discovery probes (which have their own password UX);
   * `intent: "system"` is also suppressed automatically.
   */
  __c64uSuppressAuthChallenge?: boolean;
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
  private readonly configCategoryItemsCache = new Map<string, Record<string, unknown>>();
  private activeConfigEnrichmentNamespaceKey: string | null;
  private requestGeneration = 0;

  constructor(baseUrl: string = DEFAULT_BASE_URL, password?: string, deviceHost: string = DEFAULT_DEVICE_HOST) {
    this.deviceHost = normalizeDeviceHost(deviceHost || getDeviceHostFromBaseUrl(baseUrl));
    const initialBaseUrl =
      readViteEnv()?.VITE_WEB_PLATFORM === "1" ? baseUrl : buildBaseUrlFromDeviceHost(this.deviceHost);
    this.apiBaseUrl = resolvePlatformApiBaseUrl(this.deviceHost, initialBaseUrl);
    this.password = password;
    this.activeConfigEnrichmentNamespaceKey = loadConfigEnrichmentNamespaceForHost(this.deviceHost);
  }

  setBaseUrl(url: string) {
    if (readViteEnv()?.VITE_WEB_PLATFORM !== "1") {
      this.deviceHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(url));
    }
    this.apiBaseUrl = resolvePlatformApiBaseUrl(this.deviceHost, url);
    this.resetRequestReadState();
    this.bumpRequestGeneration();
    this.setActiveConfigEnrichmentNamespaceForCurrentHost();
  }

  setPassword(password?: string) {
    this.password = password;
    this.resetRequestReadState();
    this.bumpRequestGeneration();
  }

  setDeviceHost(deviceHost?: string) {
    this.deviceHost = normalizeDeviceHost(deviceHost);
    this.apiBaseUrl = resolvePlatformApiBaseUrl(this.deviceHost, buildBaseUrlFromDeviceHost(this.deviceHost));
    this.resetRequestReadState();
    this.bumpRequestGeneration();
    this.setActiveConfigEnrichmentNamespaceForCurrentHost();
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

  /**
   * Raise the global "network password required" popup when a device call
   * returns Forbidden/Unauthorized. Single-flighted downstream, so a burst of
   * Forbidden responses yields exactly one popup. Identity (saved-device id +
   * label) is resolved from this client's host by the auth-challenge store.
   */
  private maybeRaiseAuthChallenge(status: number, suppress: boolean) {
    if (suppress || !isAuthRequiredHttpStatus(status)) return;
    notifyAuthRequired({ host: this.deviceHost });
  }

  /**
   * A successful device response proves the active password works, so close any
   * popup left open for this host (e.g. by a transient re-probe failure). No-op
   * when no challenge is open.
   */
  private clearAuthChallengeOnSuccess() {
    notifyAuthSatisfied(this.deviceHost);
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

  private buildTransportHeaders(): Record<string, string> {
    const baseUrl = this.getBaseUrl();
    if (!isNativePlatform() || baseUrl.includes(WEB_PROXY_PATH) || isLocalProxy(baseUrl)) {
      return {};
    }
    return { Connection: "close" };
  }

  private validateUploadBytes(body: ArrayBuffer, context: TransmissionValidationContext) {
    TransmissionGuard.validateOrThrow(new Uint8Array(body), context);
  }

  private async buildBinaryUploadRequest(
    body: Blob,
    validationContext: TransmissionValidationContext,
  ): Promise<{
    headers: Record<string, string>;
    body: ArrayBuffer;
  }> {
    const uploadBody =
      typeof body.arrayBuffer === "function" ? await body.arrayBuffer() : await new Response(body).arrayBuffer();
    this.validateUploadBytes(uploadBody, validationContext);
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
      if (isAbortLikeError(error)) {
        addLog("debug", "C64 API response body read cancelled", {
          path,
          status: response.status,
          contentType,
        });
        throw createAbortError();
      }
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

  private bumpRequestGeneration() {
    this.requestGeneration = (this.requestGeneration + 1) % 1_000_000;
  }

  private setActiveConfigEnrichmentNamespaceForCurrentHost() {
    const nextNamespaceKey = loadConfigEnrichmentNamespaceForHost(this.deviceHost);
    if (this.activeConfigEnrichmentNamespaceKey === nextNamespaceKey) {
      return;
    }
    this.activeConfigEnrichmentNamespaceKey = nextNamespaceKey;
    this.configCategoryItemsCache.clear();
  }

  private rememberConfigEnrichmentNamespace(deviceInfo: DeviceInfo) {
    if (!deviceInfo.unique_id || !deviceInfo.firmware_version) {
      return;
    }

    const nextNamespaceKey = rememberConfigEnrichmentNamespaceForHost(
      this.deviceHost,
      deviceInfo.unique_id,
      deviceInfo.firmware_version,
    );
    this.activeConfigEnrichmentNamespaceKey = nextNamespaceKey;
    this.configCategoryItemsCache.forEach((items, category) => {
      saveConfigEnrichmentCategory(nextNamespaceKey, category, items);
    });
  }

  private getCachedConfigCategoryItems(category: string) {
    const inMemoryItems = this.configCategoryItemsCache.get(category);
    if (inMemoryItems) {
      return inMemoryItems;
    }
    const persistedItems = loadConfigEnrichmentCategory(this.activeConfigEnrichmentNamespaceKey, category);
    if (persistedItems) {
      this.configCategoryItemsCache.set(category, persistedItems);
      return persistedItems;
    }
    return undefined;
  }

  private rememberConfigCategoryItems(category: string, payload: unknown) {
    const nextItems = getConfigCategoryItems(payload, category);
    if (!Object.keys(nextItems).length) {
      return;
    }
    const previousItems = this.getCachedConfigCategoryItems(category) ?? {};
    const mergedItems: Record<string, unknown> = { ...previousItems };
    Object.entries(nextItems).forEach(([itemName, nextItem]) => {
      const previousItem = previousItems[itemName];
      if (hasStructuredConfigMetadata(previousItem) && !hasStructuredConfigMetadata(nextItem)) {
        mergedItems[itemName] = {
          ...(previousItem as Record<string, unknown>),
          selected: extractConfigValue(nextItem),
        };
        return;
      }
      mergedItems[itemName] = nextItem;
    });
    this.configCategoryItemsCache.set(category, mergedItems);
    saveConfigEnrichmentCategory(this.activeConfigEnrichmentNamespaceKey, category, mergedItems);
  }

  private setCachedConfigValue(category: string, item: string, value: string | number) {
    const previousItems = this.getCachedConfigCategoryItems(category);
    if (!previousItems || previousItems[item] === undefined) {
      return;
    }
    const previousConfig = previousItems[item];
    let nextItems: Record<string, unknown>;
    if (typeof previousConfig !== "object" || previousConfig === null || Array.isArray(previousConfig)) {
      nextItems = {
        ...previousItems,
        [item]: value,
      };
    } else {
      nextItems = {
        ...previousItems,
        [item]: {
          ...(previousConfig as Record<string, unknown>),
          selected: value,
        },
      };
    }
    this.configCategoryItemsCache.set(category, nextItems);
    saveConfigEnrichmentCategory(this.activeConfigEnrichmentNamespaceKey, category, nextItems);
  }

  getCachedCategory(category: string): ConfigResponse | null {
    const cachedItems = this.getCachedConfigCategoryItems(category);
    if (!cachedItems || Object.keys(cachedItems).length === 0) {
      return null;
    }

    return {
      [category]: {
        items: cloneBudgetValue(cachedItems),
      },
      errors: [],
    } as ConfigResponse;
  }

  /**
   * Synchronous read of a single item's CACHED config metadata (options/values + details),
   * served from the firmware-namespaced persistent enrichment cache (in-memory → localStorage).
   * Returns `undefined` on a miss or when only a bare scalar is cached (no options metadata),
   * so callers know whether they can render the control without a per-item network fetch. The
   * device-fresh VALUE is supplied separately by the category read; this only avoids re-fetching
   * the static option set on every session (the per-item read path otherwise ignores this cache).
   */
  getCachedConfigItem(category: string, item: string): Record<string, unknown> | undefined {
    if (!category || !item) return undefined;
    const cachedItems = this.getCachedConfigCategoryItems(category);
    const cached = cachedItems?.[item];
    if (!hasStructuredConfigMetadata(cached)) return undefined;
    return cloneBudgetValue(cached) as Record<string, unknown>;
  }

  private async ensureConfigCategoryItems(category: string, itemNames: string[]) {
    const cachedItems = this.getCachedConfigCategoryItems(category) ?? {};
    const missingItems = itemNames.filter((item) => cachedItems[item] === undefined);
    if (missingItems.length === 0) {
      return cachedItems;
    }

    const categoryPayload = await this.getCategory(category, { __c64uIntent: "user" });
    this.rememberConfigCategoryItems(category, categoryPayload);

    let resolvedItems = this.getCachedConfigCategoryItems(category) ?? {};
    const remainingItems = itemNames.filter((item) => resolvedItems[item] === undefined);
    if (remainingItems.length === 0) {
      return resolvedItems;
    }

    await Promise.all(
      remainingItems.map(async (item) => {
        const itemPayload = await this.getConfigItem(category, item, { __c64uIntent: "user" });
        this.rememberConfigCategoryItems(category, itemPayload);
      }),
    );
    resolvedItems = this.getCachedConfigCategoryItems(category) ?? {};
    return resolvedItems;
  }

  getInFlightReadRequestCount() {
    return this.inFlightReadRequests.size;
  }

  private assertConfigWriteAccepted(
    response: { errors?: string[] },
    context: {
      category?: string;
      item?: string;
      value?: string | number;
      payload?: Record<string, Record<string, string | number>>;
    },
  ) {
    const firmwareErrors = Array.isArray(response.errors)
      ? response.errors.filter((entry) => entry.trim().length > 0)
      : [];
    if (firmwareErrors.length === 0) {
      return;
    }

    const target =
      context.item && context.category
        ? `${context.category}/${context.item}`
        : context.category
          ? context.category
          : "config write";
    throw new FirmwareConfigWriteError(`Firmware rejected ${target}: ${firmwareErrors.join("; ")}`, {
      ...context,
      firmwareErrors,
    });
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
      ...this.buildTransportHeaders(),
      ...this.buildAuthHeaders(),
      ...((options.headers as Record<string, string>) || {}),
    };

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const requestGeneration = this.requestGeneration;
    const requestDeviceHost = this.deviceHost;
    const method = (options.method || "GET").toString().toUpperCase();
    const timeoutMs = options.timeoutMs;
    const intent = options.__c64uIntent ?? "user";
    const allowDuringDiscovery = Boolean(options.__c64uAllowDuringDiscovery);
    const allowDuringError = Boolean(options.__c64uAllowDuringError);
    const bypassCache = Boolean(options.__c64uBypassCache);
    const bypassCooldown = Boolean(options.__c64uBypassCooldown);
    const bypassBackoff = Boolean(options.__c64uBypassBackoff);
    const bypassCircuit = Boolean(options.__c64uBypassCircuit);
    const expectedMissing = Boolean(options.__c64uExpectedMissing);
    const expectedFailureOption = Boolean(options.__c64uExpectedFailure);
    const skipSuccessBodyInspection = Boolean(options.__c64uSkipSuccessBodyInspection);
    // Background connection/discovery probes (intent "system") manage their own
    // password UX, so they never raise the global Forbidden popup; every other
    // call does, covering info/config/drives/runners/play/health-check uniformly.
    const suppressAuthChallenge = Boolean(options.__c64uSuppressAuthChallenge) || intent === "system";
    const requestOptions = { ...options } as C64ReadRequestOptions;
    requestOptions.__c64uTraceSuppressed = true;
    delete (requestOptions as { __c64uIntent?: InteractionIntent }).__c64uIntent;
    delete (requestOptions as { __c64uAllowDuringDiscovery?: boolean }).__c64uAllowDuringDiscovery;
    delete (requestOptions as { __c64uAllowDuringError?: boolean }).__c64uAllowDuringError;
    delete (requestOptions as { __c64uBypassCache?: boolean }).__c64uBypassCache;
    delete (requestOptions as { __c64uBypassCooldown?: boolean }).__c64uBypassCooldown;
    delete (requestOptions as { __c64uBypassBackoff?: boolean }).__c64uBypassBackoff;
    delete (requestOptions as { __c64uBypassCircuit?: boolean }).__c64uBypassCircuit;
    delete (requestOptions as { __c64uExpectedMissing?: boolean }).__c64uExpectedMissing;
    delete (requestOptions as { __c64uExpectedFailure?: boolean }).__c64uExpectedFailure;
    delete (requestOptions as { __c64uSkipSuccessBodyInspection?: boolean }).__c64uSkipSuccessBodyInspection;
    delete (requestOptions as { __c64uSuppressAuthChallenge?: boolean }).__c64uSuppressAuthChallenge;
    delete (requestOptions as { timeoutMs?: number }).timeoutMs;

    const requestSignal = requestOptions.signal ?? undefined;
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
        return awaitPromiseWithAbortSignal(Promise.resolve(cachedValue), requestSignal);
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
        return awaitPromiseWithAbortSignal(inFlight as Promise<T>, requestSignal);
      }
    }

    const serializeOnDevice = isNativePlatform() && !baseUrl.includes(WEB_PROXY_PATH) && !isLocalProxy(baseUrl);
    const runNativeSerialized = <R>(handler: () => Promise<R>) =>
      serializeOnDevice
        ? serializeNativeDeviceRequest(handler, loadDeviceSafetyConfig().restMaxConcurrency)
        : handler();
    const runRequest = () =>
      runWithImplicitAction(`rest.${method.toLowerCase()} ${path}`, async (action) =>
        withRestInteraction(
          {
            action,
            method,
            path,
            normalizedUrl: normalizeUrlPath(url),
            intent,
            baseUrl,
            allowDuringDiscovery,
            allowDuringError,
            bypassCache,
            bypassCooldown,
            bypassBackoff,
            bypassCircuit,
          },
          () =>
            runNativeSerialized(async () => {
              const requestId = buildRequestId();
              const idleContext = getIdleContext();
              const scheduledRequest = intent === "background";
              const requestTimeoutMs = timeoutMs ?? resolveDefaultRestRequestTimeoutMs(intent);
              const maxAttempts = 1;
              const requestTrace = await inspectRequestPayload(requestOptions.body);
              let lastError: unknown = null;
              const isSuperseded = () => this.requestGeneration !== requestGeneration;
              const throwIfSuperseded = () => {
                if (!isSuperseded()) return;
                addLog("debug", "C64 API request superseded by routing change", {
                  method,
                  path,
                  url,
                  requestId,
                  requestDeviceHost,
                  currentDeviceHost: this.deviceHost,
                });
                throw createAbortError();
              };

              for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
                let status: number | "error" = "error";
                let responseRecorded = false;
                recordRestRequest(action, {
                  method,
                  url,
                  normalizedUrl: normalizeUrlPath(url),
                  headers: collectTraceHeaders(headers),
                  body: requestTrace.body,
                  payloadPreview: requestTrace.payloadPreview,
                });

                const timedSignal = createTimedRequestSignal(requestSignal, requestTimeoutMs);
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
                  // Native direct-device requests go through CapacitorHttp.request so we can set a
                  // real native connect/read timeout; the patched window.fetch sets none, which lets a
                  // reused-but-dead pooled connection hang indefinitely after the device reboots (see
                  // capacitorHttpDeviceFetch). Web/proxy transports keep the standard fetch path.
                  const useNativeDeviceTransport =
                    isNativePlatform() && !baseUrl.includes(WEB_PROXY_PATH) && !isLocalProxy(baseUrl);
                  const response = await awaitPromiseWithAbortSignal(
                    useNativeDeviceTransport
                      ? capacitorHttpDeviceFetch(url, { method, headers, body: requestOptions.body }, requestTimeoutMs)
                      : fetchWithSignalCompatibility(
                          url,
                          {
                            ...requestOptions,
                            headers,
                            credentials: requestOptions.credentials ?? "omit",
                          },
                          timedSignal.signal,
                        ),
                    timedSignal.signal,
                  );
                  throwIfSuperseded();

                  status = response.status;
                  const durationMs = Math.max(
                    0,
                    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
                  );
                  const responseTrace = await inspectResponsePayload(response);
                  throwIfSuperseded();
                  if (!response.ok) {
                    const err = annotateRestFailure(
                      new Error(buildHttpErrorMessage(response.status, response.statusText)),
                      "http-status",
                      { httpStatus: response.status },
                    );
                    const failure = classifyError(err, "integration");
                    const expectedFailure =
                      (expectedMissing && method === "GET" && response.status === 404) || expectedFailureOption;
                    recordRestResponse(action, {
                      method,
                      path,
                      url,
                      status: response.status,
                      headers: responseTrace.headers,
                      body: responseTrace.body,
                      payloadPreview: responseTrace.payloadPreview,
                      durationMs,
                      error: err,
                      expectedFailure,
                    });
                    if (!expectedFailure) {
                      recordTraceError(action, err, failure);
                    }
                    responseRecorded = true;
                    this.maybeRaiseAuthChallenge(response.status, suppressAuthChallenge);
                    throw err;
                  }

                  if (skipSuccessBodyInspection) {
                    noteRestReachable(url, requestDeviceHost);
                    this.clearAuthChallengeOnSuccess();
                    recordRestResponse(action, {
                      method,
                      path,
                      url,
                      status: response.status,
                      headers: collectTraceHeaders(response.headers),
                      body: null,
                      payloadPreview: null,
                      durationMs,
                      error: null,
                    });
                    responseRecorded = true;
                    if (!DEDUPEABLE_READ_METHODS.has(method)) {
                      this.resetRequestReadState();
                    }
                    return { errors: [] } as T;
                  }

                  const parsedBody = await this.parseResponseJson<T>(response, path);
                  throwIfSuperseded();
                  noteRestReachable(url, requestDeviceHost, path === "/v1/info" ? (parsedBody as DeviceInfo) : null);
                  this.clearAuthChallengeOnSuccess();
                  recordRestResponse(action, {
                    method,
                    path,
                    url,
                    status: response.status,
                    headers: responseTrace.headers,
                    body: responseTrace.body ?? parsedBody,
                    payloadPreview: responseTrace.payloadPreview,
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
                  const callerAborted = requestSignal?.aborted === true;
                  const superseded = isSuperseded();
                  const cancelledAbort = isAbortLikeError(error) && !timedSignal.didTimeout();
                  const isAbort = isAbortLikeError(error) || timedSignal.didTimeout() || /timed out/i.test(rawMessage);
                  const isNetworkFailure = isNetworkFailureMessage(rawMessage);
                  const failure = classifyError(error);
                  const normalizedError =
                    !callerAborted && !superseded && (isAbort || isNetworkFailure)
                      ? resolveHostErrorMessage(rawMessage)
                      : rawMessage;
                  const durationMs = Math.max(
                    0,
                    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
                  );
                  const scheduledTimeoutFailure = scheduledRequest && !callerAborted && !superseded && isAbort;
                  if (!responseRecorded) {
                    const expectedFailure =
                      callerAborted ||
                      superseded ||
                      cancelledAbort ||
                      scheduledTimeoutFailure ||
                      expectedFailureOption ||
                      failure.isExpected ||
                      isExpectedBackgroundNetworkFailure(
                        error as Error,
                        isAbort,
                        isNetworkFailure,
                        timedSignal.didTimeout() || /timed out/i.test(rawMessage),
                      );
                    recordRestResponse(action, {
                      method,
                      path,
                      url,
                      status: status === "error" ? null : status,
                      headers: {},
                      body: null,
                      payloadPreview: null,
                      durationMs,
                      error: error as Error,
                      expectedFailure,
                    });
                    if (!expectedFailure) {
                      recordTraceError(action, error as Error, failure);
                    }
                  }
                  if (superseded) {
                    addLog("debug", "C64 API request failure ignored after routing change", {
                      method,
                      path,
                      url,
                      requestId,
                      requestDeviceHost,
                      currentDeviceHost: this.deviceHost,
                      rawError: rawMessage,
                    });
                    throw createAbortError();
                  }
                  if (
                    !fuzzBlocked &&
                    intent !== "system" &&
                    !callerAborted &&
                    !cancelledAbort &&
                    !scheduledTimeoutFailure &&
                    !expectedFailureOption &&
                    !failure.isExpected &&
                    !isExpectedBackgroundNetworkFailure(
                      error as Error,
                      isAbort,
                      isNetworkFailure,
                      timedSignal.didTimeout() || /timed out/i.test(rawMessage),
                    )
                  ) {
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

                  if (callerAborted) {
                    throw annotateRestFailure(createAbortError(), "abort", { callerCancelled: true });
                  }

                  if (cancelledAbort) {
                    throw annotateRestFailure(createAbortError(), "abort", { callerCancelled: true });
                  }

                  if (isAbort || isNetworkFailure) {
                    throw annotateRestFailure(
                      new Error(resolveHostErrorMessage(rawMessage)),
                      timedSignal.didTimeout() || /timed out/i.test(rawMessage) ? "timeout" : "network",
                    );
                  }
                  throw error;
                } finally {
                  timedSignal.cleanup();
                  this.logRestCall(method, path, status, startedAt);
                }
              }

              throw lastError as Error;
            }),
        ),
      );

    const executeRequest = runRequest;

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
    return awaitPromiseWithAbortSignal(sharedPromise, requestSignal);
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit & {
      __c64uIntent?: InteractionIntent;
      __c64uTraceSuppressed?: boolean;
      // Opt-in (readMemory only): bodyless native GET whose binary response should be
      // fetched via CapacitorHttp.request so it gets a real native read timeout. Body
      // carrying callers (uploads / writeMemoryBlock) deliberately do NOT set this and
      // keep the battle-tested patched-fetch marshalling untouched.
      __c64uNativeArrayBufferResponse?: boolean;
    },
    timeoutMs?: number,
  ): Promise<Response> {
    const intent = options.__c64uIntent ?? "user";
    options.__c64uTraceSuppressed = true;
    delete (options as { __c64uIntent?: InteractionIntent }).__c64uIntent;
    const nativeArrayBufferResponse = Boolean(
      (options as { __c64uNativeArrayBufferResponse?: boolean }).__c64uNativeArrayBufferResponse,
    );
    delete (options as { __c64uNativeArrayBufferResponse?: boolean }).__c64uNativeArrayBufferResponse;
    const body = options.body;

    const method = (options.method || "GET").toString().toUpperCase();

    return runWithImplicitAction(`rest.${method.toLowerCase()} ${normalizeUrlPath(url)}`, async (action) =>
      withRestInteraction(
        {
          action,
          method,
          path: normalizeUrlPath(url),
          normalizedUrl: normalizeUrlPath(url),
          intent,
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
          const normalizedBody = normalizeNativeBinaryRequestBody(body, options.headers);
          const requestTrace = await inspectRequestPayload(normalizedBody.body);
          if (normalizedBody.transport === "file") {
            addLog("debug", "Normalized native binary request body", {
              method,
              path: normalizeUrlPath(url),
              requestId,
              contentType: getHeaderValue(options.headers, "content-type"),
            });
          }
          recordRestRequest(action, {
            method,
            url,
            normalizedUrl: normalizeUrlPath(url),
            headers: collectTraceHeaders(headers),
            body: requestTrace.body,
            payloadPreview: requestTrace.payloadPreview,
          });

          if (isSmokeModeEnabled()) {
            console.info("C64U_HTTP", JSON.stringify({ method, url }));
          }

          // Keep upload/control calls stateless to avoid cookie bridge lookups.
          const timedSignal = createTimedRequestSignal(options.signal ?? undefined, timeoutMs);
          // Only a bodyless native direct-device GET (readMemory) is routed through
          // CapacitorHttp.request, for the native read timeout (see capacitorHttpDeviceFetch
          // / BUG-066). The `normalizedBody.body == null` guard guarantees no body-carrying
          // upload ever takes this path, so their patched-fetch marshalling is untouched.
          const useNativeArrayBufferTransport =
            nativeArrayBufferResponse &&
            normalizedBody.body == null &&
            isNativePlatform() &&
            !url.includes(WEB_PROXY_PATH) &&
            !isLocalProxy(url);
          try {
            const response = await awaitPromiseWithAbortSignal(
              useNativeArrayBufferTransport
                ? capacitorHttpDeviceFetch(
                    url,
                    { method, headers: options.headers as Record<string, string> | undefined },
                    timeoutMs ?? CONTROL_REQUEST_TIMEOUT_MS,
                    "arraybuffer",
                  )
                : fetchWithSignalCompatibility(
                    url,
                    {
                      ...options,
                      body: normalizedBody.body,
                      credentials: options.credentials ?? "omit",
                    },
                    timedSignal.signal,
                  ),
              timedSignal.signal,
            );
            if (response.ok) {
              noteRestReachable(url, this.deviceHost);
            }
            const durationMs = Math.max(
              0,
              Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
            );
            const responseTrace = await inspectResponsePayload(response);
            recordRestResponse(action, {
              method,
              path: normalizeUrlPath(url),
              url,
              status: response.status,
              headers: responseTrace.headers,
              body: responseTrace.body,
              payloadPreview: responseTrace.payloadPreview,
              durationMs,
              error: null,
            });
            return response;
          } catch (error) {
            const rawMessage = (error as Error).message || "Request failed";
            const isAbort =
              (error as { name?: string }).name === "AbortError" ||
              timedSignal.didTimeout() ||
              /timed out/i.test(rawMessage);
            const isNetworkFailure = isNetworkFailureMessage(rawMessage);
            const normalizedError = isAbort || isNetworkFailure ? resolveHostErrorMessage(rawMessage) : rawMessage;
            const durationMs = Math.max(
              0,
              Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
            );
            const failure = classifyError(error);
            const callerAborted = options.signal?.aborted === true;
            const expectedFailure =
              callerAborted ||
              failure.isExpected ||
              isExpectedBackgroundNetworkFailure(
                error as Error,
                isAbort,
                isNetworkFailure,
                timedSignal.didTimeout() || /timed out/i.test(rawMessage),
              );
            recordRestResponse(action, {
              method,
              path: normalizeUrlPath(url),
              url,
              status: null,
              headers: {},
              body: null,
              payloadPreview: null,
              durationMs,
              error: error as Error,
              expectedFailure,
            });
            if (!expectedFailure) {
              recordTraceError(action, error as Error, failure);
            }
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
            if (!failure.isExpected) {
              // Always log as error so the entry is captured when the diagnostics
              // overlay is open. The transient flag marks recoverable upload failures.
              addErrorLog(
                "C64 API upload failed",
                transientUploadFailure ? { ...uploadFailureDetails, transient: true } : uploadFailureDetails,
              );
            }
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
              throw annotateRestFailure(
                new Error(resolveHostErrorMessage(rawMessage)),
                timedSignal.didTimeout() || /timed out/i.test(rawMessage) ? "timeout" : "network",
              );
            }
            throw error;
          } finally {
            timedSignal.cleanup();
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
    const info = await this.request<DeviceInfo>("/v1/info", options);
    if (info && typeof info === "object") {
      this.rememberConfigEnrichmentNamespace(info);
    }
    return info;
  }

  // Config endpoints
  async getCategories(options: C64ReadRequestOptions = {}): Promise<CategoriesResponse> {
    return this.request("/v1/configs", options);
  }

  async getCategory(category: string, options: C64ReadRequestOptions = {}): Promise<ConfigResponse> {
    const encoded = encodeURIComponent(category);
    const response = await this.request<ConfigResponse>(`/v1/configs/${encoded}`, options);
    this.rememberConfigCategoryItems(category, response);
    return response;
  }

  async getConfigItem(category: string, item: string, options: C64ReadRequestOptions = {}): Promise<ConfigResponse> {
    const catEncoded = encodeURIComponent(category);
    const itemEncoded = encodeURIComponent(item);
    const response = await this.request<ConfigResponse>(`/v1/configs/${catEncoded}/${itemEncoded}`, options);
    this.rememberConfigCategoryItems(category, response);
    return response;
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

    const skipItemEnrichment = options.__c64uSkipItemEnrichment === true;
    const mergedItems: Record<string, unknown> = {};
    const itemsNeedingEnrichment = new Set<string>();
    const cachedItems = this.getCachedConfigCategoryItems(category) ?? {};
    uniqueItems.forEach((item) => {
      if (cachedItems[item] !== undefined) {
        mergedItems[item] = cloneBudgetValue(cachedItems[item]);
      }
    });
    try {
      const categoryPayload = await this.getCategory(category, {
        ...options,
        __c64uExpectedFailure: true,
      });
      const payload = categoryPayload as Record<string, any>;
      const categoryBlock = payload?.[category] ?? payload;
      const itemsBlock = categoryBlock?.items ?? categoryBlock;
      if (itemsBlock && typeof itemsBlock === "object") {
        uniqueItems.forEach((item) => {
          if (Object.prototype.hasOwnProperty.call(itemsBlock, item)) {
            const itemConfig = (itemsBlock as Record<string, unknown>)[item];
            const cachedConfig = cachedItems[item];
            if (hasStructuredConfigMetadata(itemConfig)) {
              mergedItems[item] = itemConfig;
            } else if (hasStructuredConfigMetadata(cachedConfig)) {
              mergedItems[item] = {
                ...(cachedConfig as Record<string, unknown>),
                selected: extractConfigValue(itemConfig),
              };
            } else {
              mergedItems[item] = itemConfig;
            }
            if (!hasStructuredConfigMetadata(itemConfig)) {
              if (!hasStructuredConfigMetadata(cachedConfig)) {
                itemsNeedingEnrichment.add(item);
              }
            }
          }
        });
      }
    } catch (error) {
      const categoryErrorMessage = error instanceof Error ? error.message : String(error ?? "");
      if (parseHttpStatusFromErrorMessage(categoryErrorMessage) === 404) {
        addLog("debug", "Category config fetch returned 404; treating category as unavailable", {
          category,
          error: categoryErrorMessage,
        });
        return {
          [category]: {
            items: {},
          },
          errors: [],
        } as ConfigResponse;
      }

      if (isDeviceNotReadyRequestGate(categoryErrorMessage)) {
        addLog("warn", "Category config fetch skipped item fallback because device is not ready", {
          category,
          error: categoryErrorMessage,
          itemCount: uniqueItems.length,
        });
        throw error;
      }

      addLog("debug", "Category config fetch failed; falling back to item fetches", {
        category,
        error: categoryErrorMessage,
      });
    }

    const missingItems = uniqueItems.filter(
      (item) => !Object.prototype.hasOwnProperty.call(mergedItems, item) || itemsNeedingEnrichment.has(item),
    );
    if (!skipItemEnrichment && missingItems.length > 0) {
      const responses = await Promise.allSettled(
        missingItems.map((item) =>
          this.getConfigItem(category, item, {
            ...options,
            __c64uExpectedMissing: true,
          }),
        ),
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

  async setConfigValue(
    category: string,
    item: string,
    value: string | number,
    options: C64ReadRequestOptions = {},
  ): Promise<ConfigResponse> {
    const catEncoded = encodeURIComponent(category);
    const itemEncoded = encodeURIComponent(item);
    const categoryPayload = {
      [category]: {
        items: await this.ensureConfigCategoryItems(category, [item]),
      },
    };
    const resolvedValue = resolveConfigWriteValue(category, item, value, categoryPayload);
    const valEncoded = encodeURIComponent(String(resolvedValue));
    validateConfigWrite({
      category,
      item,
      value: resolvedValue,
      categoryPayload,
    });
    const response = await scheduleConfigWrite(() =>
      this.request<ConfigResponse>(`/v1/configs/${catEncoded}/${itemEncoded}?value=${valEncoded}`, {
        method: "PUT",
        ...CONFIG_WRITE_REQUEST_OPTIONS,
        ...options,
      }),
    );
    this.assertConfigWriteAccepted(response as { errors?: string[] }, { category, item, value: resolvedValue });
    this.setCachedConfigValue(category, item, resolvedValue);
    return response;
  }

  async saveConfig(options: C64ReadRequestOptions = {}): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request("/v1/configs:save_to_flash", { method: "PUT", ...options }));
  }

  async loadConfig(options: C64ReadRequestOptions = {}): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request("/v1/configs:load_from_flash", { method: "PUT", ...options }));
  }

  async resetConfig(options: C64ReadRequestOptions = {}): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request("/v1/configs:reset_to_default", { method: "PUT", ...options }));
  }

  async updateConfigBatch(payload: Record<string, Record<string, string | number>>): Promise<{ errors: string[] }> {
    const categories = Object.entries(payload);
    const resolvedEntriesByCategory: Record<string, Array<[string, string | number]>> = {};
    await Promise.all(
      categories.map(async ([category, updates]) => {
        const categoryPayload = {
          [category]: {
            items: await this.ensureConfigCategoryItems(category, Object.keys(updates)),
          },
        };
        const resolvedEntries = orderFirmwareSafeConfigUpdates(category, updates).map(
          ([item, value]): [string, string | number] => [
            item,
            resolveConfigWriteValue(category, item, value, categoryPayload),
          ],
        );
        resolvedEntriesByCategory[category] = resolvedEntries;
        validateConfigBatchWrite({
          category,
          updates: Object.fromEntries(resolvedEntries),
          categoryPayload,
        });
      }),
    );
    const mergedPayload: Record<string, Record<string, string | number>> = {};
    const sequentialPayloads: Array<Record<string, Record<string, string | number>>> = [];
    Object.entries(resolvedEntriesByCategory).forEach(([category, entries]) => {
      if (requiresSequentialItemWrites(category, entries)) {
        entries.forEach(([item, value]) => {
          sequentialPayloads.push({ [category]: { [item]: value } });
        });
        return;
      }
      mergedPayload[category] = Object.fromEntries(entries);
    });
    const requestPayloads = [...(Object.keys(mergedPayload).length ? [mergedPayload] : []), ...sequentialPayloads];
    const errors: string[] = [];
    for (const requestPayload of requestPayloads) {
      // Device-safety: the firmware's `POST /v1/configs` handler buffers the
      // request body into a temp file before parsing it (TempfileWriter on the
      // single-threaded embedded HTTP task). Under rapid interactive writes —
      // e.g. dragging an LED brightness/colour slider — that filesystem churn
      // stalls and then drops the device's whole network stack (verified on
      // hardware: a single such POST takes c64u offline). The body-less
      // `PUT /v1/configs/{cat}/{item}?value=` path has no temp file and survives
      // sustained rapid writes. So whenever a payload is a single item (the slider
      // case and most interactive writes), send it via PUT; only genuine
      // multi-item batches keep the POST form.
      const single = singleConfigEntry(requestPayload);
      const run = (): Promise<{ errors: string[] }> =>
        single
          ? this.request(
              `/v1/configs/${encodeURIComponent(single.category)}/${encodeURIComponent(single.item)}?value=${encodeURIComponent(String(single.value))}`,
              {
                method: "PUT",
                ...CONFIG_WRITE_REQUEST_OPTIONS,
              },
            )
          : this.request("/v1/configs", {
              method: "POST",
              ...CONFIG_WRITE_REQUEST_OPTIONS,
              body: JSON.stringify(requestPayload),
            });
      const response = await scheduleConfigWrite(run);
      this.assertConfigWriteAccepted(response, { payload: requestPayload });
      Object.entries(requestPayload).forEach(([category, updates]) => {
        Object.entries(updates).forEach(([item, value]) => {
          this.setCachedConfigValue(category, item, value);
        });
      });
      errors.push(...(response.errors ?? []));
    }
    return { errors };
  }

  // Machine control endpoints
  async machineReset(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:reset", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
      __c64uSkipSuccessBodyInspection: true,
    });
  }

  async machineReboot(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:reboot", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
      __c64uSkipSuccessBodyInspection: true,
    });
  }

  async machinePause(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:pause", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
      __c64uSkipSuccessBodyInspection: true,
    });
  }

  async machineResume(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:resume", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
      __c64uSkipSuccessBodyInspection: true,
    });
  }

  async machinePowerOff(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:poweroff", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
      __c64uSkipSuccessBodyInspection: true,
    });
  }

  async machineMenuButton(): Promise<{ errors: string[] }> {
    return this.request("/v1/machine:menu_button", {
      method: "PUT",
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
      __c64uSkipSuccessBodyInspection: true,
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
      __c64uSkipSuccessBodyInspection: true,
    });
  }

  async readMemory(address: string, length = 1, options: C64ReadRequestOptions = {}): Promise<Uint8Array> {
    const path = `/v1/machine:readmem?address=${address}&length=${length}`;
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...this.buildAuthHeaders(),
    };
    const response = await this.fetchWithTimeout(
      url,
      {
        headers,
        signal: options.signal,
        __c64uIntent: options.__c64uIntent,
        // Bodyless GET: route through CapacitorHttp.request on native so the binary read
        // gets a real native read timeout and a dead pooled connection is evicted after a
        // device reboot instead of hanging (BUG-066).
        __c64uNativeArrayBufferResponse: true,
      },
      options.timeoutMs ?? CONTROL_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      this.maybeRaiseAuthChallenge(
        response.status,
        Boolean(options.__c64uSuppressAuthChallenge) || options.__c64uIntent === "system",
      );
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

  async writeMemory(
    address: string,
    data: Uint8Array,
    options: C64ReadRequestOptions = {},
  ): Promise<{ errors: string[] }> {
    const hex = Array.from(data)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return this.request(`/v1/machine:writemem?address=${address}&data=${hex}`, {
      method: "PUT",
      ...options,
    });
  }

  async writeMemoryBlock(
    address: string,
    data: Uint8Array,
    options: C64ReadRequestOptions = {},
  ): Promise<{ errors: string[] }> {
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
          signal: options.signal,
          __c64uIntent: options.__c64uIntent,
        },
        options.timeoutMs ?? RAM_BLOCK_WRITE_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(buildHttpErrorMessage(response.status, response.statusText));
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
    return this.request(path, { method: "PUT", timeoutMs: MOUNT_REQUEST_TIMEOUT_MS });
  }

  async mountDriveUpload(
    drive: "a" | "b",
    image: Blob,
    type?: string,
    mode?: "readwrite" | "readonly" | "unlinked",
    metadata: UploadValidationMetadata = {},
    options: C64ReadRequestOptions = {},
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
      const upload = await this.buildBinaryUploadRequest(image, {
        filename: metadata.filename ?? extractUploadFilename(image, `disk.${type ?? "img"}`),
        operation: "DRIVE_MOUNT_UPLOAD",
        endpoint: path,
        expectedType: resolveDiskUploadType(type),
      });
      addLog("debug", "Drive mount upload payload ready", {
        drive,
        type: type ?? null,
        mode: mode ?? null,
        baseUrl,
        deviceHost: this.deviceHost,
        fingerprint: buildBinaryFingerprint(new Uint8Array(upload.body)),
      });
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
          signal: options.signal,
          __c64uIntent: options.__c64uIntent,
        },
        options.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(buildHttpErrorMessage(response.status, response.statusText));
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
    return this.request(`/v1/drives/${drive}:remove`, { method: "PUT", timeoutMs: MOUNT_REQUEST_TIMEOUT_MS });
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

  async playSidUpload(
    sidFile: Blob,
    songNr?: number,
    sslFile?: Blob,
    metadata: UploadValidationMetadata = {},
    options: C64ReadRequestOptions = {},
  ): Promise<{ errors: string[] }> {
    const url = new URL(`${this.getBaseUrl()}/v1/runners:sidplay`);
    if (songNr !== undefined) {
      url.searchParams.set("songnr", String(songNr));
    }
    const headers = this.buildAuthHeaders();

    const sidUploadBody =
      typeof sidFile.arrayBuffer === "function"
        ? await sidFile.arrayBuffer()
        : await new Response(sidFile).arrayBuffer();
    this.validateUploadBytes(sidUploadBody, {
      filename: metadata.filename ?? extractUploadFilename(sidFile, "track.sid"),
      operation: "SID_PLAY_UPLOAD",
      endpoint: `${url.pathname}${url.search}`,
      expectedType: "sid",
    });

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
            signal: options.signal,
            __c64uIntent: options.__c64uIntent,
          },
          options.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
        );
        status = response.status;

        if (!response.ok) {
          const error = new Error(buildHttpErrorMessage(response.status, response.statusText));
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

  async playModUpload(
    modFile: Blob,
    metadata: UploadValidationMetadata = {},
    options: C64ReadRequestOptions = {},
  ): Promise<{ errors: string[] }> {
    const path = "/v1/runners:modplay";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(modFile, {
        filename: metadata.filename ?? extractUploadFilename(modFile, "track.mod"),
        operation: "MOD_PLAY_UPLOAD",
        endpoint: path,
        expectedType: "mod",
      });
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
          signal: options.signal,
          __c64uIntent: options.__c64uIntent,
        },
        options.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(buildHttpErrorMessage(response.status, response.statusText));
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

  async runPrgUpload(
    prgFile: Blob,
    metadata: UploadValidationMetadata = {},
    options: C64ReadRequestOptions = {},
  ): Promise<{ errors: string[] }> {
    const path = "/v1/runners:run_prg";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(prgFile, {
        filename: metadata.filename ?? extractUploadFilename(prgFile, "program.prg"),
        operation: "PRG_RUN_UPLOAD",
        endpoint: path,
        expectedType: "prg",
      });
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
          signal: options.signal,
          __c64uIntent: options.__c64uIntent,
        },
        options.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(buildHttpErrorMessage(response.status, response.statusText));
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

  async loadPrgUpload(
    prgFile: Blob,
    metadata: UploadValidationMetadata = {},
    options: C64ReadRequestOptions = {},
  ): Promise<{ errors: string[] }> {
    const path = "/v1/runners:load_prg";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const upload = await this.buildBinaryUploadRequest(prgFile, {
        filename: metadata.filename ?? extractUploadFilename(prgFile, "program.prg"),
        operation: "PRG_LOAD_UPLOAD",
        endpoint: path,
        expectedType: "prg",
      });
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
          signal: options.signal,
          __c64uIntent: options.__c64uIntent,
        },
        options.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(buildHttpErrorMessage(response.status, response.statusText));
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

  async runCartridgeUpload(
    crtFile: Blob,
    metadata: UploadValidationMetadata = {},
    options: C64ReadRequestOptions = {},
  ): Promise<{ errors: string[] }> {
    const path = "/v1/runners:run_crt";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let status: number | "error" = "error";
    const method = "POST";
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      const filename = requireUploadFilename(crtFile, metadata, "CRT_RUN_UPLOAD");
      const upload = await this.buildBinaryUploadRequest(crtFile, {
        filename,
        operation: "CRT_RUN_UPLOAD",
        endpoint: path,
        expectedType: "crt",
      });
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: upload.headers,
          body: upload.body,
          signal: options.signal,
          __c64uIntent: options.__c64uIntent,
        },
        options.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(buildHttpErrorMessage(response.status, response.statusText));
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

const isTestProbeEnabled = () => {
  if (readViteEnv()?.VITE_ENABLE_TEST_PROBES === "1") return true;
  if (typeof window !== "undefined") {
    const win = window as Window & { __c64uTestProbeEnabled?: boolean };
    return win.__c64uTestProbeEnabled === true;
  }
  return false;
};

const resolveInjectedTestBaseUrl = () => {
  if (typeof window === "undefined" || !isTestProbeEnabled()) return null;
  const win = window as Window & {
    __c64uExpectedBaseUrl?: string;
    __c64uMockServerBaseUrl?: string;
  };
  const rawUrl = win.__c64uExpectedBaseUrl ?? win.__c64uMockServerBaseUrl ?? null;
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).toString();
  } catch (error) {
    addLog("warn", "Failed to parse injected test base URL", {
      baseUrl: rawUrl,
      error: (error as Error).message,
    });
    return rawUrl;
  }
};

export function getC64API(): C64API {
  if (!apiInstance) {
    const storedDeviceHost = resolveDeviceHostFromStorage();
    const injectedTestBaseUrl = resolveInjectedTestBaseUrl();
    const resolvedDeviceHost = injectedTestBaseUrl ? getDeviceHostFromBaseUrl(injectedTestBaseUrl) : storedDeviceHost;
    const resolvedBaseUrl = resolvePlatformApiBaseUrl(
      resolvedDeviceHost,
      injectedTestBaseUrl ?? buildBaseUrlFromDeviceHost(storedDeviceHost),
    );
    const cachedPassword = getCachedPassword();
    apiInstance = new C64API(resolvedBaseUrl, cachedPassword ?? undefined, resolvedDeviceHost);
    if (!lastDeviceHost) {
      lastDeviceHost = apiInstance.getDeviceHost();
    }
    if (hasStoredPasswordFlag() && cachedPassword === null) {
      void loadStoredPassword()
        .then((password) => {
          apiInstance?.setPassword(password ?? undefined);
        })
        .catch((error) => {
          // The native keystore can reject if locked/unavailable; don't let it
          // surface as an unhandled rejection — the password stays unset and a
          // later auth challenge handles it.
          addLog("warn", "Failed to hydrate stored device password", {
            error: error instanceof Error ? error.message : String(error ?? "unknown error"),
          });
        });
    }
  }
  if (!apiProxy) {
    apiProxy = createApiProxy(apiInstance);
  }
  return apiProxy;
}

export function updateC64APIConfig(
  baseUrl: string,
  password?: string,
  deviceHost?: string,
  options?: { reason?: string },
) {
  const api = getC64API();
  const resolvedDeviceHost = resolvePreferredDeviceHost(baseUrl, deviceHost, {
    preserveLocalhostBaseUrl: getSmokeConfig()?.target === "mock",
  });
  const resolvedBaseUrl = resolvePlatformApiBaseUrl(resolvedDeviceHost, buildBaseUrlFromDeviceHost(resolvedDeviceHost));

  api.setBaseUrl(resolvedBaseUrl);
  api.setPassword(password);
  api.setDeviceHost(resolvedDeviceHost);
  localStorage.removeItem("c64u_base_url");
  persistDeviceHostToStorage(resolvedDeviceHost);
  localStorage.removeItem("c64u_password");
  updateSelectedSavedDeviceConnection({
    deviceHost: resolvedDeviceHost,
    passwordPresent: Boolean(password),
    httpPort: getDeviceHostHttpPort(resolvedDeviceHost, resolvedBaseUrl),
  });
  if (password) {
    storePassword(password).catch((error) => {
      addErrorLog("Failed to persist password to secure storage", { error: (error as Error).message });
    });
  } else {
    clearStoredPassword().catch((error) => {
      addErrorLog("Failed to clear password from secure storage", { error: (error as Error).message });
    });
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
        reason: options?.reason,
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
export function applyC64APIRuntimeConfig(
  baseUrl: string,
  password?: string,
  deviceHost?: string,
  options?: { reason?: string },
) {
  const api = getC64API();
  const resolvedDeviceHost = resolvePreferredDeviceHost(baseUrl, deviceHost, {
    preserveLocalhostBaseUrl: getSmokeConfig()?.target === "mock",
  });
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
        reason: options?.reason,
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
  DEFAULT_HTTP_PORT,
};

export {
  buildBaseUrlFromDeviceHost,
  getDeviceHostFromBaseUrl,
  hasPersistedDeviceHostConfig,
  normalizeDeviceHost,
  resolveDeviceHostFromStorage,
};
