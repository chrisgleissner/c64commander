/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getActiveAction, runWithImplicitAction } from "@/lib/tracing/actionTrace";
import { decrementRestInFlight, incrementRestInFlight } from "@/lib/diagnostics/diagnosticsActivity";
import { recordRestRequest, recordRestResponse, recordTraceError } from "@/lib/tracing/traceSession";
import type { TraceActionContext } from "@/lib/tracing/types";
import { collectTraceHeaders } from "@/lib/tracing/payloadPreview";
import { inspectRequestPayload, inspectResponsePayload } from "@/lib/c64api/requestRuntime";

const parseUrl = (url: string) => {
  const fallbackBase = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(url, fallbackBase);
};

const normalizeUrlPath = (url: string) => {
  try {
    const parsed = parseUrl(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    console.warn("Failed to normalize fetch trace URL", { url, error });
    return url;
  }
};

const shouldTraceUrl = (url: string) => {
  try {
    const parsed = parseUrl(url);
    return parsed.pathname.includes("/v1/");
  } catch (error) {
    console.warn("Failed to parse fetch trace URL for filtering", {
      url,
      error,
    });
    return url.includes("/v1/");
  }
};

export const registerFetchTrace = () => {
  if (typeof window === "undefined") return;
  const existing = (window as Window & { __c64uFetchTraceInstalled?: boolean }).__c64uFetchTraceInstalled;
  if (existing) return;
  (window as Window & { __c64uFetchTraceInstalled?: boolean }).__c64uFetchTraceInstalled = true;

  const originalFetch = window.fetch.bind(window);

  const executeTracedFetch = async (
    action: TraceActionContext,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    url: string,
    method: string,
  ): Promise<Response> => {
    incrementRestInFlight();
    const requestTrace = await inspectRequestPayload(init?.body ?? (input instanceof Request ? input.body : null));
    recordRestRequest(action, {
      method,
      url,
      normalizedUrl: normalizeUrlPath(url),
      headers: collectTraceHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
      body: requestTrace.body,
      payloadPreview: requestTrace.payloadPreview,
    });
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const response = await originalFetch(input, init);
      const durationMs = Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      );
      const responseTrace = await inspectResponsePayload(response);
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        recordRestResponse(action, {
          status: response.status,
          headers: responseTrace.headers,
          body: responseTrace.body,
          payloadPreview: responseTrace.payloadPreview,
          durationMs,
          error: err,
          errorMessage: err.message,
        });
        recordTraceError(action, err);
        return response;
      }
      recordRestResponse(action, {
        status: response.status,
        headers: responseTrace.headers,
        body: responseTrace.body,
        payloadPreview: responseTrace.payloadPreview,
        durationMs,
        error: null,
      });
      return response;
    } catch (error) {
      const durationMs = Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      );
      let responseStatus: number | null = null;
      let responseBody: unknown = null;
      let errorMessage: string | null = null;
      let traceError: Error | null = null;

      if (error instanceof Response) {
        responseStatus = error.status;
        errorMessage = `HTTP ${error.status}`;
        traceError = new Error(errorMessage);
        try {
          const responseTrace = await inspectResponsePayload(error);
          responseBody = responseTrace.body;
          recordRestResponse(action, {
            status: responseStatus,
            headers: responseTrace.headers,
            body: responseTrace.body,
            payloadPreview: responseTrace.payloadPreview,
            durationMs,
            error: traceError,
            errorMessage,
          });
        } catch (errorBody) {
          console.warn("Failed to parse traced error response body", {
            error: errorBody,
          });
          responseBody = null;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
        traceError = error;
      } else {
        errorMessage = "Request failed";
        traceError = new Error(errorMessage);
      }

      if (!(error instanceof Response)) {
        recordRestResponse(action, {
          status: responseStatus,
          headers: {},
          body: responseBody,
          payloadPreview: null,
          durationMs,
          error: traceError,
          errorMessage,
        });
      }
      recordTraceError(action, traceError ?? new Error("Request failed"));
      throw error;
    } finally {
      decrementRestInFlight();
    }
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit & { __c64uTraceSuppressed?: boolean }) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : String(input);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toString().toUpperCase();
    const suppress = Boolean(init && "__c64uTraceSuppressed" in init && init.__c64uTraceSuppressed);

    if (!suppress && shouldTraceUrl(url)) {
      // If there's an active user action, record REST within that context
      const activeAction = getActiveAction();
      if (activeAction) {
        return executeTracedFetch(activeAction, input, init, url, method);
      }
      // Otherwise create an implicit system action for the REST call
      return runWithImplicitAction(`rest.${method.toLowerCase()}`, async (action) => {
        return executeTracedFetch(action, input, init, url, method);
      });
    }

    return originalFetch(input, init);
  };
};
