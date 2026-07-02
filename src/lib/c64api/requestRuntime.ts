/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { getDeviceStateSnapshot } from "@/lib/deviceInteraction/deviceStateStore";
import { canonicalizeRestPath } from "@/lib/deviceInteraction/restRequestIdentity";
import {
  buildPayloadPreviewFromBytes,
  buildPayloadPreviewFromJson,
  buildPayloadPreviewFromText,
  collectTraceHeaders,
} from "@/lib/tracing/payloadPreview";
import type { PayloadPreview, TraceHeaders } from "@/lib/tracing/types";

const IDLE_RECOVERY_THRESHOLD_MS = 10_000;

// Request/response tracing runs on every /v1/ call. Bodies at or above this
// size (e.g. multi-MB disk image uploads/downloads, large config dumps) skip
// the full read/parse and are recorded as a size summary only, with no
// payload preview - avoids fully copying large payloads into memory just to
// trace them and keeps the whole body out of the in-memory trace store. See
// HARD9-058.
const TRACE_LARGE_PAYLOAD_THRESHOLD_BYTES = 64 * 1024;

const isFile = (value: unknown): value is File => typeof File !== "undefined" && value instanceof File;

const isBlob = (value: unknown): value is Blob => typeof Blob !== "undefined" && value instanceof Blob;

export const normalizeUrlPath = (url: string) => {
  try {
    const parsed = new URL(url);
    return canonicalizeRestPath(`${parsed.pathname}${parsed.search}`, parsed.origin);
  } catch (error) {
    addLog("warn", "Failed to normalize API URL path", {
      url,
      error: (error as Error).message,
    });
    return url;
  }
};

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const createAbortError = () => {
  const error = new Error("The operation was aborted");
  (error as { name: string }).name = "AbortError";
  return error;
};

export const isAbortLikeError = (error: unknown) => {
  const name = (error as { name?: string } | undefined)?.name ?? "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return name === "AbortError" || /aborted|aborterror|canceled|cancelled|cancelation|cancellation/i.test(message);
};

export const waitWithAbortSignal = async (ms: number, signal?: AbortSignal) => {
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
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
};

export const awaitPromiseWithAbortSignal = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      queueMicrotask(() => {
        queueMicrotask(() => {
          signal.removeEventListener("abort", onAbort);
          reject(createAbortError());
        });
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch((error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
};

export const buildReadRequestDedupeKey = (
  method: string,
  url: string,
  headers: Record<string, string>,
  body: RequestInit["body"],
) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (body !== undefined && body !== null) return null;
  const normalizedUrl = normalizeUrlPath(url);
  const headerKey = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}`)
    .join("|");
  return `${method} ${normalizedUrl} ${headerKey}`;
};

export const cloneBudgetValue = <T>(value: T): T => {
  if (typeof structuredClone !== "function") return value;
  try {
    return structuredClone(value);
  } catch (error) {
    addLog("warn", "Failed to clone request budget value", {
      error: (error as Error).message,
    });
    return value;
  }
};

export const estimateBudgetValueBytes = (value: unknown): number | null => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  try {
    return JSON.stringify(value).length;
  } catch (error) {
    addLog("warn", "Failed to estimate request budget value size", {
      error: (error as Error).message,
    });
    return null;
  }
};

export const getIdleContext = () => {
  const snapshot = getDeviceStateSnapshot();
  const now = Date.now();
  const idleMs = snapshot.lastSuccessAtMs !== null ? Math.max(0, now - snapshot.lastSuccessAtMs) : null;
  return {
    deviceState: snapshot.state,
    idleMs,
    wasIdle: idleMs !== null && idleMs >= IDLE_RECOVERY_THRESHOLD_MS,
  };
};

const summarizeFormData = (body: FormData) => {
  const fields: Array<{
    name: string;
    type: "file" | "text";
    fileName?: string;
    sizeBytes?: number;
    mimeType?: string;
  }> = [];
  body.forEach((value, name) => {
    if (isFile(value)) {
      fields.push({
        name,
        type: "file",
        fileName: value.name,
        sizeBytes: value.size,
        mimeType: value.type || undefined,
      });
    } else if (isBlob(value)) {
      fields.push({
        name,
        type: "file",
        sizeBytes: value.size,
        mimeType: value.type || undefined,
      });
    } else {
      fields.push({
        name,
        type: "text",
      });
    }
  });
  return { type: "form-data", fields };
};

const summarizeBinaryBody = (body: Blob | ArrayBuffer | ArrayBufferView) => {
  if (isFile(body)) {
    return {
      type: "file",
      fileName: body.name,
      sizeBytes: body.size,
      mimeType: body.type || null,
      source: "blob",
    };
  }
  if (isBlob(body)) {
    return {
      type: "blob",
      sizeBytes: body.size,
      mimeType: body.type || null,
      source: "blob",
    };
  }
  if (body instanceof ArrayBuffer) {
    return { type: "array-buffer", sizeBytes: body.byteLength };
  }
  return { type: "array-buffer-view", sizeBytes: body.byteLength };
};

export const inspectRequestPayload = async (
  body: unknown,
): Promise<{ body: unknown; payloadPreview: PayloadPreview | null }> => {
  if (!body) {
    return { body: null, payloadPreview: null };
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { body: "[stream]", payloadPreview: null };
  }
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return {
        body: parsed,
        payloadPreview: buildPayloadPreviewFromText(body),
      };
    } catch (error) {
      addLog("warn", "Failed to parse request body JSON", {
        error: (error as Error).message,
      });
      return {
        body,
        payloadPreview: buildPayloadPreviewFromText(body),
      };
    }
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const summary = summarizeFormData(body);
    return {
      body: summary,
      payloadPreview: buildPayloadPreviewFromJson(summary),
    };
  }
  if (isBlob(body)) {
    // body is already just a summary regardless of size; only the preview
    // needs the actual bytes, so skip reading (and copying) large blobs
    // like disk image uploads entirely rather than doubling them in memory.
    if (body.size > TRACE_LARGE_PAYLOAD_THRESHOLD_BYTES) {
      return { body: summarizeBinaryBody(body), payloadPreview: null };
    }
    const bytes = new Uint8Array(await body.arrayBuffer());
    return {
      body: summarizeBinaryBody(body),
      payloadPreview: buildPayloadPreviewFromBytes(bytes),
    };
  }
  if (body instanceof ArrayBuffer) {
    return {
      body: summarizeBinaryBody(body),
      payloadPreview: buildPayloadPreviewFromBytes(new Uint8Array(body)),
    };
  }
  if (ArrayBuffer.isView(body)) {
    return {
      body: summarizeBinaryBody(body),
      payloadPreview: buildPayloadPreviewFromBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)),
    };
  }
  return {
    body,
    payloadPreview: buildPayloadPreviewFromJson(body),
  };
};

export const inspectResponsePayload = async (
  response: Response,
): Promise<{ headers: TraceHeaders; body: unknown; payloadPreview: PayloadPreview | null }> => {
  const rawHeaders = response.headers ?? new Headers();
  const headers = collectTraceHeaders(rawHeaders);
  const contentType = rawHeaders.get("content-type")?.toLowerCase() ?? "";
  const contentLength = rawHeaders.get("content-length");
  if (contentLength === "0" || response.status === 204) {
    return { headers, body: null, payloadPreview: null };
  }
  // Only trust a declared Content-Length to skip the read/parse entirely -
  // chunked/unknown-size responses keep the existing full-read behavior
  // below, since we can't cheaply tell whether they're large upfront.
  const declaredSizeBytes = contentLength ? Number(contentLength) : null;
  const isLargeResponse =
    declaredSizeBytes !== null &&
    Number.isFinite(declaredSizeBytes) &&
    declaredSizeBytes > TRACE_LARGE_PAYLOAD_THRESHOLD_BYTES;

  if (contentType.includes("application/json")) {
    if (isLargeResponse) {
      return {
        headers,
        body: { type: "json", sizeBytes: declaredSizeBytes, truncated: true },
        payloadPreview: null,
      };
    }
    try {
      const text = await response.clone().text();
      if (!text) {
        return { headers, body: null, payloadPreview: null };
      }
      return {
        headers,
        body: JSON.parse(text),
        payloadPreview: buildPayloadPreviewFromText(text),
      };
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw createAbortError();
      }
      addLog("warn", "Failed to parse API response JSON", {
        error: (error as Error).message,
      });
      return { headers, body: null, payloadPreview: null };
    }
  }

  if (contentType.startsWith("text/") || contentType.includes("xml") || contentType.includes("html")) {
    if (isLargeResponse) {
      return {
        headers,
        body: { type: "text", sizeBytes: declaredSizeBytes, truncated: true },
        payloadPreview: null,
      };
    }
    try {
      const text = await response.clone().text();
      return {
        headers,
        body: text || null,
        payloadPreview: text ? buildPayloadPreviewFromText(text) : null,
      };
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw createAbortError();
      }
      addLog("warn", "Failed to read API text response body", {
        error: (error as Error).message,
      });
      return { headers, body: null, payloadPreview: null };
    }
  }

  if (isLargeResponse) {
    return {
      headers,
      body: { type: "binary", sizeBytes: declaredSizeBytes, mimeType: contentType || null, truncated: true },
      payloadPreview: null,
    };
  }

  try {
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    return {
      headers,
      body:
        bytes.byteLength > 0
          ? {
              type: "binary",
              sizeBytes: bytes.byteLength,
              mimeType: contentType || null,
            }
          : null,
      payloadPreview: buildPayloadPreviewFromBytes(bytes),
    };
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw createAbortError();
    }
    addLog("warn", "Failed to read API binary response body", {
      error: (error as Error).message,
    });
    return { headers, body: null, payloadPreview: null };
  }
};

export const extractRequestBody = (body: unknown) => {
  if (!body) return null;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (error) {
      addLog("warn", "Failed to parse request body JSON", {
        error: (error as Error).message,
      });
      return body;
    }
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return summarizeFormData(body);
  }
  if (isBlob(body)) {
    return summarizeBinaryBody(body);
  }
  if (body instanceof ArrayBuffer) {
    return summarizeBinaryBody(body);
  }
  if (ArrayBuffer.isView(body)) {
    return summarizeBinaryBody(body);
  }
  return body as unknown;
};

export const readResponseBody = async (response: Response) => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return null;
  return (await inspectResponsePayload(response)).body;
};
