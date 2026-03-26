/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { addErrorLog, addLog, buildErrorLogDetails } from "@/lib/logging";
import { buildPayloadPreviewFromBytes } from "@/lib/tracing/payloadPreview";
import { buildArchiveQueryParam } from "./queryBuilder";
import { resolveArchiveClientConfig, sanitizeArchiveHeadersForLogging } from "./config";
import type {
  ArchiveBinary,
  ArchiveClient,
  ArchiveClientConfigInput,
  ArchiveClientResolvedConfig,
  ArchiveEntriesResponse,
  ArchiveEntry,
  ArchivePreset,
  ArchiveRequestOptions,
  ArchiveSearchParams,
  ArchiveSearchResult,
} from "./types";

const REQUEST_TIMEOUT_MS = {
  presets: 10_000,
  search: 15_000,
  entries: 10_000,
  binary: 30_000,
} as const;

type RequestKind = keyof typeof REQUEST_TIMEOUT_MS;

type ArchiveFetch = typeof fetch;

const isNativeArchiveRuntime = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const normalizeHeaderMap = (headers?: HeadersInit): Record<string, string> => Object.fromEntries(new Headers(headers));

const isUnsupportedSignalError = (error: unknown) =>
  error instanceof Error && error.message.includes("Expected signal") && error.message.includes("AbortSignal");

const decodeNativeBinaryData = (value: unknown): ArrayBuffer => {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value).buffer;
  }
  if (typeof value === "string") {
    if (typeof atob === "function") {
      const decoded = atob(value);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0)).buffer;
    }
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(value, "base64")).buffer;
    }
  }
  throw new Error("Archive native HTTP returned an unsupported binary payload.");
};

const runWithDeadline = async <T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) => {
  const controller = new AbortController();
  const { signal } = controller;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let signalAbortHandler: (() => void) | null = null;
  const externalAbortHandler =
    externalSignal != null
      ? () => {
          if (!signal.aborted) {
            controller.abort(
              (externalSignal as AbortSignal & { reason?: unknown }).reason ??
                new DOMException("Archive request aborted", "AbortError"),
            );
          }
        }
      : null;
  try {
    if (externalSignal?.aborted && !signal.aborted) {
      controller.abort(
        (externalSignal as AbortSignal & { reason?: unknown }).reason ??
          new DOMException("Archive request aborted", "AbortError"),
      );
    } else if (externalSignal && externalAbortHandler) {
      externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
    }

    timeoutId = globalThis.setTimeout(() => {
      if (!signal.aborted) {
        controller.abort(new DOMException("Archive request timed out", "AbortError"));
      }
    }, timeoutMs);

    if (signal.aborted) {
      throw (
        (signal as AbortSignal & { reason?: unknown }).reason ??
        new DOMException("Archive request aborted", "AbortError")
      );
    }

    const abortPromise = new Promise<never>((_, reject) => {
      signalAbortHandler = () => {
        reject(
          (signal as AbortSignal & { reason?: unknown }).reason ??
            new DOMException("Archive request aborted", "AbortError"),
        );
      };
      signal.addEventListener("abort", signalAbortHandler, { once: true });
    });

    return await Promise.race([promiseFactory(signal), abortPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
    if (externalSignal && externalAbortHandler) {
      externalSignal.removeEventListener("abort", externalAbortHandler);
    }
    if (signalAbortHandler) {
      signal.removeEventListener("abort", signalAbortHandler);
    }
  }
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json()) as T | { errorCode?: unknown };
  const maybeError = payload as { errorCode?: unknown };
  if (typeof maybeError.errorCode === "number" && maybeError.errorCode > 0) {
    throw new Error(`Archive server returned error ${maybeError.errorCode}`);
  }
  return payload as T;
};

export abstract class BaseArchiveClient implements ArchiveClient {
  private readonly resolvedConfig: ArchiveClientResolvedConfig;
  private readonly fetchImpl: ArchiveFetch;

  protected constructor(config: ArchiveClientConfigInput, fetchImpl: ArchiveFetch = fetch) {
    this.resolvedConfig = resolveArchiveClientConfig(config);
    this.fetchImpl = fetchImpl;
  }

  protected getHost(): string {
    return this.resolvedConfig.host;
  }

  protected getClientId(): string {
    return this.resolvedConfig.clientId;
  }

  protected getUserAgent(): string {
    return this.resolvedConfig.userAgent;
  }

  protected transformRequest?(request: RequestInit & { url: string }): RequestInit & { url: string };

  protected transformResponse?<T>(response: T): T;

  protected getHeaders() {
    return {
      "Accept-Encoding": "identity",
      ...this.resolvedConfig.headers,
    };
  }

  protected buildUrl(path: string) {
    return `${this.resolvedConfig.baseUrl}${path}`;
  }

  private async requestWithTransport(
    request: RequestInit & { url: string },
    timeoutMs: number,
    responseType: "json" | "arraybuffer",
    signal?: AbortSignal,
  ): Promise<Response> {
    if (this.fetchImpl === fetch && isNativeArchiveRuntime()) {
      const response = await CapacitorHttp.request({
        url: request.url,
        method: request.method ?? "GET",
        headers: normalizeHeaderMap(request.headers),
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType,
      });
      const headers = new Headers(
        Object.entries((response.headers ?? {}) as Record<string, string>).map(([key, value]) => [key, String(value)]),
      );
      if (responseType === "arraybuffer") {
        return new Response(decodeNativeBinaryData(response.data), {
          status: response.status,
          statusText: String(response.status),
          headers,
        });
      }
      const payload = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? {});
      return new Response(payload, {
        status: response.status,
        statusText: String(response.status),
        headers,
      });
    }

    return runWithDeadline(
      async (combinedSignal) => {
        try {
          return await this.fetchImpl(request.url, { ...request, signal: combinedSignal });
        } catch (error) {
          if (!combinedSignal.aborted && isUnsupportedSignalError(error)) {
            return this.fetchImpl(request.url, request);
          }
          throw error;
        }
      },
      timeoutMs,
      signal,
    );
  }

  private async requestJson<T>(kind: RequestKind, path: string, options?: ArchiveRequestOptions): Promise<T> {
    const url = this.buildUrl(path);
    const headers = this.getHeaders();
    const startedAt = performance.now();

    try {
      let request: RequestInit & { url: string } = {
        method: "GET",
        headers,
        url,
      };
      if (this.transformRequest) {
        request = this.transformRequest(request);
      }
      addLog("debug", "Archive request started", {
        sourceId: this.resolvedConfig.id,
        sourceName: this.resolvedConfig.name,
        clientType: this.constructor.name,
        resolvedConfig: this.resolvedConfig,
        requestUrl: url,
        headers: sanitizeArchiveHeadersForLogging(headers),
        operation: kind,
      });
      const response = await this.requestWithTransport(request, REQUEST_TIMEOUT_MS[kind], "json", options?.signal);
      if (!response.ok) {
        throw new Error(`Archive request failed with ${response.status} ${response.statusText}`);
      }
      const parsed = await parseJsonResponse<T>(response);
      const result = this.transformResponse ? this.transformResponse(parsed) : parsed;
      addLog("debug", "Archive request completed", {
        sourceId: this.resolvedConfig.id,
        sourceName: this.resolvedConfig.name,
        clientType: this.constructor.name,
        operation: kind,
        requestUrl: url,
        timingMs: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      const err = error as Error;
      addErrorLog(
        "Archive request failed",
        buildErrorLogDetails(err, {
          sourceId: this.resolvedConfig.id,
          sourceName: this.resolvedConfig.name,
          host: this.getHost(),
          clientType: this.constructor.name,
          operation: kind,
          requestUrl: url,
          headers: sanitizeArchiveHeadersForLogging(headers),
          timingMs: Math.round(performance.now() - startedAt),
        }),
      );
      throw new Error(`${this.resolvedConfig.name} archive request failed for ${this.getHost()}: ${err.message}`);
    }
  }

  async getPresets(options?: ArchiveRequestOptions): Promise<ArchivePreset[]> {
    return this.requestJson<ArchivePreset[]>("presets", "/leet/search/aql/presets", options);
  }

  async search(params: ArchiveSearchParams, options?: ArchiveRequestOptions): Promise<ArchiveSearchResult[]> {
    return this.requestJson<ArchiveSearchResult[]>(
      "search",
      `/leet/search/aql?query=${buildArchiveQueryParam(params)}`,
      options,
    );
  }

  async getEntries(id: string, category: number, options?: ArchiveRequestOptions): Promise<ArchiveEntry[]> {
    const response = await this.requestJson<ArchiveEntriesResponse>(
      "entries",
      `/leet/search/entries/${id}/${category}`,
      options,
    );
    return response.contentEntry ?? [];
  }

  getBinaryUrl(id: string, category: number, index: number): string {
    return this.buildUrl(`/leet/search/bin/${id}/${category}/${index}`);
  }

  async downloadBinary(
    id: string,
    category: number,
    index: number,
    fileName: string,
    options?: ArchiveRequestOptions,
  ): Promise<ArchiveBinary> {
    const url = this.getBinaryUrl(id, category, index);
    const headers = this.getHeaders();
    const startedAt = performance.now();

    try {
      let request: RequestInit & { url: string } = {
        method: "GET",
        headers,
        url,
      };
      if (this.transformRequest) {
        request = this.transformRequest(request);
      }
      addLog("debug", "Archive binary download started", {
        sourceId: this.resolvedConfig.id,
        sourceName: this.resolvedConfig.name,
        clientType: this.constructor.name,
        resolvedConfig: this.resolvedConfig,
        requestUrl: url,
        headers: sanitizeArchiveHeadersForLogging(headers),
      });
      const response = await this.requestWithTransport(
        request,
        REQUEST_TIMEOUT_MS.binary,
        "arraybuffer",
        options?.signal,
      );
      if (!response.ok) {
        throw new Error(`Archive binary download failed with ${response.status} ${response.statusText}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      addLog("debug", "Archive binary download completed", {
        sourceId: this.resolvedConfig.id,
        sourceName: this.resolvedConfig.name,
        clientType: this.constructor.name,
        requestUrl: url,
        timingMs: Math.round(performance.now() - startedAt),
        payloadPreview: buildPayloadPreviewFromBytes(buffer),
      });
      return {
        fileName,
        bytes: buffer,
        contentType: response.headers.get("content-type"),
        url,
      };
    } catch (error) {
      const err = error as Error;
      addErrorLog(
        "Archive binary download failed",
        buildErrorLogDetails(err, {
          sourceId: this.resolvedConfig.id,
          sourceName: this.resolvedConfig.name,
          host: this.getHost(),
          clientType: this.constructor.name,
          requestUrl: url,
          headers: sanitizeArchiveHeadersForLogging(headers),
          timingMs: Math.round(performance.now() - startedAt),
        }),
      );
      throw new Error(`${this.resolvedConfig.name} archive download failed for ${this.getHost()}: ${err.message}`);
    }
  }

  getResolvedConfig(): ArchiveClientResolvedConfig {
    return this.resolvedConfig;
  }
}

export class CommoserveClient extends BaseArchiveClient {
  constructor(config: ArchiveClientConfigInput, fetchImpl?: ArchiveFetch) {
    super(config, fetchImpl);
  }
}

export const createArchiveClient = (config: ArchiveClientConfigInput, fetchImpl?: ArchiveFetch): ArchiveClient => {
  return new CommoserveClient(config, fetchImpl);
};
