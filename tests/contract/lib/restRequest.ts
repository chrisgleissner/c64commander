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
      try {
        const response = await client.request(requestConfig);
        const retryable = response.status >= 500 && attempt <= maxRetries;
        if (shouldTrace) {
          emitTrace({
            options,
            config,
            defaults: traceDefaults,
            response,
            requestSequence: sequence,
            attempt,
            willRetry: retryable,
            retryDelayMs: retryable ? deterministicRetryDelay(baseDelayMs, attempt) : undefined,
          });
        }
        if (retryable) {
          await delay(deterministicRetryDelay(baseDelayMs, attempt));
          continue;
        }
        if (!shouldTrace && options.mode === "STRESS" && response.status >= 500 && attempt <= maxRetries) {
          const waitMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
          console.warn("REST retryable response", {
            status: response.status,
            attempt: attempt - 1,
            waitMs,
          });
          await delay(waitMs);
          continue;
        }
        return response;
      } catch (error) {
        const willRetry = attempt <= maxRetries;
        const retryDelayMs = willRetry
          ? shouldTrace
            ? deterministicRetryDelay(baseDelayMs, attempt)
            : baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
          : undefined;
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
    headers: input.response?.requestHeaders ?? serializeTraceValue(input.config.headers),
    params: serializeTraceValue(input.config.params),
    payload: serializeTraceValue(input.config.data),
    responseStatus: input.response?.status,
    responseHeaders: input.response?.headers,
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

function serializeTraceValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return { type: "Buffer", base64: value.toString("base64") };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor.name,
      base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    };
  }
  if (value instanceof ArrayBuffer) {
    return { type: "ArrayBuffer", base64: Buffer.from(value).toString("base64") };
  }
  if (typeof value === "object") {
    if (typeof (value as { getHeaders?: () => unknown }).getHeaders === "function") {
      return {
        type: "FormData",
        headers: serializeTraceValue((value as { getHeaders: () => unknown }).getHeaders()),
      };
    }
    return value;
  }
  return value;
}
