import { getActiveAction, runWithImplicitAction } from '@/lib/tracing/actionTrace';
import { decrementRestInFlight, incrementRestInFlight } from '@/lib/diagnostics/diagnosticsActivity';
import { recordRestRequest, recordRestResponse, recordTraceError } from '@/lib/tracing/traceSession';
import type { TraceActionContext } from '@/lib/tracing/types';

const normalizeUrlPath = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
};

const extractHeaders = (headers?: HeadersInit) => {
  if (!headers) return {} as Record<string, string>;
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }
  return { ...(headers as Record<string, string>) };
};

const extractBody = (body: BodyInit | null | undefined) => {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (body instanceof FormData) {
    // Provide structured summary of FormData for diagnostics
    const fields: Array<{
      name: string;
      type: 'file' | 'text';
      fileName?: string;
      sizeBytes?: number;
      mimeType?: string;
    }> = [];
    body.forEach((value, name) => {
      if (typeof File !== 'undefined' && value instanceof File) {
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
  return '[body]';
};

const shouldTraceUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/v1/');
  } catch {
    return url.includes('/v1/');
  }
};

export const registerFetchTrace = () => {
  if (typeof window === 'undefined') return;
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
    const headers = extractHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    recordRestRequest(action, {
      method,
      url,
      normalizedUrl: normalizeUrlPath(url),
      headers,
      body: extractBody(init?.body ?? (input instanceof Request ? input.body : null)),
    });
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const response = await originalFetch(input, init);
      const durationMs = Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
      let responseBody: unknown = null;
      try {
        const clone = response.clone();
        responseBody = await clone.json().catch(() => null);
      } catch {
        responseBody = null;
      }
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        recordRestResponse(action, {
          status: response.status,
          body: responseBody,
          durationMs,
          error: err,
          errorMessage: err.message,
        });
        recordTraceError(action, err);
        return response;
      }
      recordRestResponse(action, { status: response.status, body: responseBody, durationMs, error: null });
      return response;
    } catch (error) {
      const durationMs = Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
      let responseStatus: number | null = null;
      let responseBody: unknown = null;
      let errorMessage: string | null = null;
      let traceError: Error | null = null;

      if (error instanceof Response) {
        responseStatus = error.status;
        errorMessage = `HTTP ${error.status}`;
        traceError = new Error(errorMessage);
        try {
          const clone = error.clone();
          responseBody = await clone.json().catch(() => null);
        } catch {
          responseBody = null;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
        traceError = error;
      } else {
        errorMessage = 'Request failed';
        traceError = new Error(errorMessage);
      }

      recordRestResponse(action, {
        status: responseStatus,
        body: responseBody,
        durationMs,
        error: traceError,
        errorMessage,
      });
      recordTraceError(action, traceError ?? new Error('Request failed'));
      throw error;
    } finally {
      decrementRestInFlight();
    }
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit & { __c64uTraceSuppressed?: boolean }) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : String(input);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toString().toUpperCase();
    const suppress = Boolean(init && '__c64uTraceSuppressed' in init && init.__c64uTraceSuppressed);

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
