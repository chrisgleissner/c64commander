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

const IDLE_RECOVERY_THRESHOLD_MS = 10_000;

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
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
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
    const fields: Array<{
      name: string;
      type: "file" | "text";
      fileName?: string;
      sizeBytes?: number;
      mimeType?: string;
    }> = [];
    body.forEach((value, name) => {
      if (value instanceof File) {
        fields.push({
          name,
          type: "file",
          fileName: value.name,
          sizeBytes: value.size,
          mimeType: value.type || undefined,
        });
      } else if (typeof Blob !== "undefined" && value instanceof Blob) {
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
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
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
  if (ArrayBuffer.isView(body)) {
    return { type: "array-buffer-view", sizeBytes: body.byteLength };
  }
  return body as unknown;
};

export const readResponseBody = async (response: Response) => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.clone().json();
  } catch (error) {
    addLog("warn", "Failed to parse API response JSON", {
      error: (error as Error).message,
    });
    return null;
  }
};
