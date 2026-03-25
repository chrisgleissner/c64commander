/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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

const runWithDeadline = async <T>(promiseFactory: () => Promise<T>, timeoutMs: number, signal?: AbortSignal) => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(
        () => reject(new DOMException("Archive request timed out", "AbortError")),
        timeoutMs,
      );
    });
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          abortHandler = () => reject(signal.reason ?? new DOMException("Archive request aborted", "AbortError"));
          signal.addEventListener("abort", abortHandler, { once: true });
        })
      : null;
    return await Promise.race([promiseFactory(), timeoutPromise, ...(abortPromise ? [abortPromise] : [])]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json()) as T | { errorCode?: number };
  if ((payload as { errorCode?: number }).errorCode) {
    throw new Error(`Archive server returned error ${(payload as { errorCode: number }).errorCode}`);
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
      "Client-Id": this.getClientId(),
      "User-Agent": this.getUserAgent(),
    };
  }

  protected buildUrl(path: string) {
    return `${this.resolvedConfig.baseUrl}${path}`;
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
        backend: this.resolvedConfig.backend,
        clientType: this.constructor.name,
        resolvedConfig: this.resolvedConfig,
        requestUrl: url,
        headers: sanitizeArchiveHeadersForLogging(headers),
        operation: kind,
      });
      const response = await runWithDeadline(
        () => this.fetchImpl(request.url, request),
        REQUEST_TIMEOUT_MS[kind],
        options?.signal,
      );
      if (!response.ok) {
        throw new Error(`Archive request failed with ${response.status} ${response.statusText}`);
      }
      const parsed = await parseJsonResponse<T>(response);
      const result = this.transformResponse ? this.transformResponse(parsed) : parsed;
      addLog("debug", "Archive request completed", {
        backend: this.resolvedConfig.backend,
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
          backend: this.resolvedConfig.backend,
          host: this.getHost(),
          clientType: this.constructor.name,
          operation: kind,
          requestUrl: url,
          headers: sanitizeArchiveHeadersForLogging(headers),
          timingMs: Math.round(performance.now() - startedAt),
        }),
      );
      throw new Error(`${this.resolvedConfig.backend} archive request failed for ${this.getHost()}: ${err.message}`);
    } finally {
      // no-op
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
        backend: this.resolvedConfig.backend,
        clientType: this.constructor.name,
        resolvedConfig: this.resolvedConfig,
        requestUrl: url,
        headers: sanitizeArchiveHeadersForLogging(headers),
      });
      const response = await runWithDeadline(
        () => this.fetchImpl(request.url, request),
        REQUEST_TIMEOUT_MS.binary,
        options?.signal,
      );
      if (!response.ok) {
        throw new Error(`Archive binary download failed with ${response.status} ${response.statusText}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      addLog("debug", "Archive binary download completed", {
        backend: this.resolvedConfig.backend,
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
          backend: this.resolvedConfig.backend,
          host: this.getHost(),
          clientType: this.constructor.name,
          requestUrl: url,
          headers: sanitizeArchiveHeadersForLogging(headers),
          timingMs: Math.round(performance.now() - startedAt),
        }),
      );
      throw new Error(`${this.resolvedConfig.backend} archive download failed for ${this.getHost()}: ${err.message}`);
    } finally {
      // no-op
    }
  }

  getResolvedConfig(): ArchiveClientResolvedConfig {
    return this.resolvedConfig;
  }
}

export class CommoserveClient extends BaseArchiveClient {
  constructor(config: Omit<ArchiveClientConfigInput, "backend"> & { backend?: "commodore" }, fetchImpl?: ArchiveFetch) {
    super({ backend: "commodore", ...config }, fetchImpl);
  }
}

export class Assembly64Client extends BaseArchiveClient {
  constructor(
    config: Omit<ArchiveClientConfigInput, "backend"> & { backend?: "assembly64" },
    fetchImpl?: ArchiveFetch,
  ) {
    super({ backend: "assembly64", ...config }, fetchImpl);
  }
}

export const createArchiveClient = (config: ArchiveClientConfigInput, fetchImpl?: ArchiveFetch): ArchiveClient => {
  if (config.backend === "assembly64") {
    return new Assembly64Client(config, fetchImpl);
  }
  return new CommoserveClient(config, fetchImpl);
};
