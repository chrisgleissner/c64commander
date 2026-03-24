/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { AxiosRequestConfig } from "axios";
import { delay } from "./timing.js";
import type { RestClient, RestResponse } from "./restClient.js";
import type { LogEventInput } from "./logging.js";
import type { BreakpointRequestTraceContext, BreakpointTraceEntry } from "./breakpoint.js";
import type { TraceCollector } from "./traceCollector.js";
import { makeBodyPreview, nowMs, nowNs } from "./traceSchema.js";
import { sanitizeTraceHeaders, serializeTraceValue } from "./traceSerialization.js";

export type SharedRestRequestConfig = AxiosRequestConfig & {
  trace?: BreakpointRequestTraceContext;
};

export type SharedRestRequest = (config: SharedRestRequestConfig) => Promise<RestResponse>;

type CreateRestRequestOptions = {
  mode: "SAFE" | "STRESS";
  breakpointTrace?: {
    runId: string;
    log: (event: LogEventInput) => void;
    getDefaults: () => BreakpointRequestTraceContext | null;
    onTrace: (entry: BreakpointTraceEntry) => void;
    maxRetries?: number;
    baseDelayMs?: number;
  };
  traceCollector?: TraceCollector;
  defaultClientId?: string;
};

export function createRestRequest(client: RestClient, options: CreateRestRequestOptions): SharedRestRequest {
  const requestSequence = { current: 0 };
  return async (config: SharedRestRequestConfig) => {
    const traceDefaults = options.breakpointTrace?.getDefaults() ?? null;
    const shouldTrace = Boolean(options.breakpointTrace);
    const sequence = shouldTrace ? (requestSequence.current += 1) : 0;
    const maxRetries = shouldTrace ? (options.breakpointTrace?.maxRetries ?? 0) : options.mode === "STRESS" ? 2 : 0;
    const baseDelayMs = shouldTrace ? (options.breakpointTrace?.baseDelayMs ?? 200) : 200;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const requestConfig = stripTraceConfig(config);
      const clientId = config.trace?.clientId ?? options.defaultClientId ?? "rest-client";
      const launchedAtMs = nowMs();
      const hrTimeNs = nowNs();
      const method = (requestConfig.method ?? "GET").toUpperCase();
      const fullUrl = buildTraceUrl(client, requestConfig.url ?? "");
      try {
        const response = await client.request(requestConfig);
        options.traceCollector?.emit({
          protocol: "REST",
          direction: "request",
          correlationId: response.correlationId,
          clientId,
          timestamp: new Date().toISOString(),
          launchedAtMs,
          hrTimeNs,
          method,
          url: fullUrl,
          headers: sanitizeTraceHeaders(response.requestHeaders),
          body: serializeTraceValue(requestConfig.data),
        });
        const preview = makeBodyPreview(response.data);
        options.traceCollector?.emit({
          protocol: "REST",
          direction: "response",
          correlationId: response.correlationId,
          clientId,
          timestamp: new Date().toISOString(),
          launchedAtMs,
          hrTimeNs,
          status: response.status,
          headers: sanitizeTraceHeaders(response.headers),
          body: serializeTraceValue(response.data),
          latencyMs: response.latencyMs,
          bodyPreviewHex: preview.hex,
          bodyPreviewAscii: preview.ascii,
        });
        const retryable = response.status >= 500 && attempt <= maxRetries;
        const retryDelayMs = retryable ? computeRetryDelay(shouldTrace, baseDelayMs, attempt) : undefined;
        if (shouldTrace) {
          emitTrace({
            options,
            config,
            defaults: traceDefaults,
            response,
            requestSequence: sequence,
            attempt,
            willRetry: retryable,
            retryDelayMs,
          });
        }
        if (retryable) {
          if (!shouldTrace && options.mode === "STRESS") {
            console.warn("REST retryable response", {
              status: response.status,
              attempt: attempt - 1,
              waitMs: retryDelayMs,
            });
          }
          await delay(retryDelayMs ?? 0);
          continue;
        }
        return response;
      } catch (error) {
        options.traceCollector?.emit({
          protocol: "REST",
          direction: "request",
          correlationId: `error-${launchedAtMs}-${attempt}`,
          clientId,
          timestamp: new Date().toISOString(),
          launchedAtMs,
          hrTimeNs,
          method,
          url: fullUrl,
          headers: sanitizeTraceHeaders(requestConfig.headers as Record<string, unknown> | undefined),
          body: serializeTraceValue(requestConfig.data),
        });
        const willRetry = attempt <= maxRetries;
        const retryDelayMs = willRetry ? computeRetryDelay(shouldTrace, baseDelayMs, attempt) : undefined;
        if (shouldTrace) {
          emitTrace({
            options,
            config,
            defaults: traceDefaults,
            requestSequence: sequence,
            attempt,
            error,
            willRetry,
            retryDelayMs,
          });
        }
        if (!willRetry) {
          throw error;
        }
        if (!shouldTrace && options.mode === "STRESS") {
          console.warn("REST request failed, retrying", {
            error: String(error),
            attempt: attempt - 1,
            waitMs: retryDelayMs,
          });
        }
        await delay(retryDelayMs ?? 0);
      }
    }

    throw new Error("REST retry loop exhausted");
  };
}

function stripTraceConfig(config: SharedRestRequestConfig): AxiosRequestConfig {
  const { trace: _trace, ...requestConfig } = config;
  return requestConfig;
}

function deterministicRetryDelay(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

function computeRetryDelay(shouldTrace: boolean, baseDelayMs: number, attempt: number): number {
  if (shouldTrace) {
    return deterministicRetryDelay(baseDelayMs, attempt);
  }
  return baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
}

function emitTrace(input: {
  options: CreateRestRequestOptions;
  config: SharedRestRequestConfig;
  defaults: BreakpointRequestTraceContext | null;
  requestSequence: number;
  attempt: number;
  response?: RestResponse;
  error?: unknown;
  willRetry: boolean;
  retryDelayMs?: number;
}): void {
  const traceOptions = input.options.breakpointTrace;
  if (!traceOptions) {
    return;
  }

  const timestamp = new Date().toISOString();
  const mergedTrace = {
    stageId: input.config.trace?.stageId ?? input.defaults?.stageId ?? "setup",
    clientId: input.config.trace?.clientId ?? input.defaults?.clientId ?? "rest-client",
    concurrencyLevel: input.config.trace?.concurrencyLevel ?? input.defaults?.concurrencyLevel ?? 1,
    rateDelayMs: input.config.trace?.rateDelayMs ?? input.defaults?.rateDelayMs ?? 0,
    target: {
      category: input.config.trace?.target?.category ?? input.defaults?.target?.category ?? null,
      item: input.config.trace?.target?.item ?? input.defaults?.target?.item ?? null,
    },
  };

  const entry: BreakpointTraceEntry = {
    timestamp,
    runId: traceOptions.runId,
    stageId: mergedTrace.stageId,
    requestSequence: input.requestSequence,
    attempt: input.attempt,
    clientId: mergedTrace.clientId,
    method: (input.config.method ?? "GET").toUpperCase(),
    url: input.config.url ?? "",
    headers: input.response?.requestHeaders
      ? sanitizeTraceHeaders(input.response.requestHeaders)
      : sanitizeTraceHeaders(input.config.headers as Record<string, unknown> | undefined),
    params: serializeTraceValue(input.config.params),
    payload: serializeTraceValue(input.config.data),
    responseStatus: input.response?.status,
    responseHeaders: input.response?.headers ? sanitizeTraceHeaders(input.response.headers) : undefined,
    responseBody: serializeTraceValue(input.response?.data),
    latencyMs: input.response?.latencyMs,
    concurrencyLevel: mergedTrace.concurrencyLevel,
    rateDelayMs: mergedTrace.rateDelayMs,
    target: mergedTrace.target,
    error: input.error ? String(input.error) : undefined,
    willRetry: input.willRetry,
    retryDelayMs: input.retryDelayMs,
  };

  traceOptions.onTrace(entry);
  traceOptions.log({
    kind: "rest-trace",
    op: `${entry.method} ${entry.url}`,
    ...entry,
  });
}

function buildTraceUrl(client: RestClient, requestPath: string): string {
  try {
    const clientBaseUrl = (client as unknown as { client?: { defaults?: { baseURL?: string } } }).client?.defaults
      ?.baseURL;
    return new URL(requestPath, clientBaseUrl ?? "http://invalid.local").toString();
  } catch {
    return requestPath;
  }
}

export { serializeTraceValue };
