// C64 Ultimate REST API Client

import { CapacitorHttp } from '@capacitor/core';
import { addErrorLog, addLog } from '@/lib/logging';
import { isSmokeModeEnabled, isSmokeReadOnlyEnabled } from '@/lib/smoke/smokeMode';
import { isFuzzModeEnabled, isFuzzSafeBaseUrl } from '@/lib/fuzz/fuzzMode';
import { scheduleConfigWrite } from '@/lib/config/configWriteThrottle';

const DEFAULT_BASE_URL = 'http://c64u';
const DEFAULT_DEVICE_HOST = 'c64u';
const DEFAULT_PROXY_URL = 'http://127.0.0.1:8787';
const CONTROL_REQUEST_TIMEOUT_MS = 3000;
const UPLOAD_REQUEST_TIMEOUT_MS = 5000;
const PLAYBACK_REQUEST_TIMEOUT_MS = 5000;

const isDnsFailure = (message: string) => /unknown host|enotfound|ename_not_found|dns/i.test(message);
const isNetworkFailureMessage = (message: string) =>
  /failed to fetch|networkerror|network request failed|unknown host|enotfound|ename_not_found|dns/i.test(message);
const resolveHostErrorMessage = (message: string) =>
  (isDnsFailure(message) ? 'Host unreachable (DNS)' : 'Host unreachable');

const sanitizeHostInput = (input?: string) => {
  const raw = input?.trim() ?? '';
  if (!raw) return '';
  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return url.host || url.hostname || '';
    } catch {
      return '';
    }
  }
  return raw.split('/')[0] ?? '';
};

export const normalizeDeviceHost = (input?: string) => {
  const sanitized = sanitizeHostInput(input);
  return sanitized || DEFAULT_DEVICE_HOST;
};

export const getDeviceHostFromBaseUrl = (baseUrl?: string) => {
  if (!baseUrl) return DEFAULT_DEVICE_HOST;
  try {
    const url = new URL(baseUrl);
    return url.host || DEFAULT_DEVICE_HOST;
  } catch {
    return normalizeDeviceHost(baseUrl);
  }
};

export const buildBaseUrlFromDeviceHost = (deviceHost?: string) =>
  `http://${normalizeDeviceHost(deviceHost)}`;

export const resolveDeviceHostFromStorage = () => {
  if (typeof localStorage === 'undefined') return DEFAULT_DEVICE_HOST;
  const storedDeviceHost = localStorage.getItem('c64u_device_host');
  const normalizedStoredHost = normalizeDeviceHost(storedDeviceHost);
  if (storedDeviceHost) {
    localStorage.removeItem('c64u_base_url');
    return normalizedStoredHost;
  }
  const legacyBaseUrl = localStorage.getItem('c64u_base_url');
  if (legacyBaseUrl) {
    const migratedHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(legacyBaseUrl));
    localStorage.setItem('c64u_device_host', migratedHost);
    localStorage.removeItem('c64u_base_url');
    return migratedHost;
  }
  localStorage.removeItem('c64u_base_url');
  return normalizedStoredHost;
};

const isLocalProxy = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
};

const isNativePlatform = () => {
  try {
    return Boolean((window as any)?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
};

const isReadOnlyMethod = (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method);

const shouldBlockSmokeMutation = (method: string) => isSmokeModeEnabled() && isSmokeReadOnlyEnabled() && !isReadOnlyMethod(method);

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
  [itemName: string]: {
    selected?: string | number;
    options?: string[];
    details?: {
      min?: number;
      max?: number;
      format?: string;
      presets?: string[];
    };
  } | string | number;
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

export interface DriveInfo {
  enabled: boolean;
  bus_id: number;
  type: string;
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

  constructor(
    baseUrl: string = DEFAULT_BASE_URL,
    password?: string,
    deviceHost: string = DEFAULT_DEVICE_HOST
  ) {
    this.deviceHost = normalizeDeviceHost(deviceHost || getDeviceHostFromBaseUrl(baseUrl));
    this.password = password;
  }

  setBaseUrl(url: string) {
    this.deviceHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(url));
  }

  setPassword(password?: string) {
    this.password = password;
  }

  setDeviceHost(deviceHost?: string) {
    this.deviceHost = normalizeDeviceHost(deviceHost);
  }

  getBaseUrl() {
    return buildBaseUrlFromDeviceHost(this.deviceHost);
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
      headers['X-Password'] = this.password;
    }
    const baseUrl = this.getBaseUrl();
    if (isLocalProxy(baseUrl)) {
      headers['X-C64U-Host'] = this.deviceHost;
    }
    return headers;
  }

  private async parseResponseJson<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const text = await response.text();
    if (!text || !contentType.includes('application/json')) {
      return { errors: [] } as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      addErrorLog('C64 API parse failed', { error: (error as Error).message });
      return { errors: [] } as T;
    }
  }

  private logRestCall(method: string, path: string, status: number | 'error', startedAt: number) {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = Math.max(0, Math.round(endedAt - startedAt));
    addLog('debug', 'C64 API request', {
      method,
      path,
      status,
      latencyMs,
      baseUrl: this.getBaseUrl(),
      deviceHost: this.deviceHost,
    });
  }

  private async request<T>(
    path: string,
    options: (RequestInit & { timeoutMs?: number }) = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.buildAuthHeaders(),
      ...((options.headers as Record<string, string>) || {}),
    };

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const method = (options.method || 'GET').toString().toUpperCase();
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const timeoutMs = options.timeoutMs;
    const requestOptions = { ...options };
    delete (requestOptions as { timeoutMs?: number }).timeoutMs;

    try {
      if (shouldBlockSmokeMutation(method)) {
        addErrorLog('Smoke mode blocked mutating request', {
          path,
          url,
          method,
          baseUrl,
          deviceHost: this.deviceHost,
        });
        console.error('C64U_SMOKE_MUTATION_BLOCKED', JSON.stringify({ method, path, url }));
        throw new Error('Smoke mode blocked mutating request');
      }
      if (isFuzzModeEnabled() && !isFuzzSafeBaseUrl(baseUrl)) {
        addErrorLog('Fuzz mode blocked real device request', {
          path,
          url,
          baseUrl,
          deviceHost: this.deviceHost,
        });
        const blocked = new Error('Fuzz mode blocked request') as Error & { __fuzzBlocked?: boolean };
        blocked.__fuzzBlocked = true;
        throw blocked;
      }
      if (isNativePlatform()) {
        if (isSmokeModeEnabled()) {
          console.info('C64U_HTTP_NATIVE', JSON.stringify({ method, path, url }));
        }
        const body = requestOptions.body ? requestOptions.body : undefined;
        const requestPromise = CapacitorHttp.request({
          url,
          method,
          headers,
          data: typeof body === 'string' ? JSON.parse(body) : body,
        });
        const nativeResponse = timeoutMs
          ? await Promise.race([
            requestPromise,
            new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
            }),
          ])
          : await requestPromise;

        status = nativeResponse.status;
        if (nativeResponse.status < 200 || nativeResponse.status >= 300) {
          throw new Error(`HTTP ${nativeResponse.status}`);
        }

        if (typeof nativeResponse.data === 'string') {
          try {
            return JSON.parse(nativeResponse.data) as T;
          } catch (error) {
            addErrorLog('C64 API parse failed', { error: (error as Error).message });
            return { errors: [] } as T;
          }
        }

        return nativeResponse.data as T;
      }

      const controller = timeoutMs ? new AbortController() : null;
      const timeoutId = timeoutMs ? window.setTimeout(() => controller?.abort(), timeoutMs) : null;
      const response = await fetch(url, {
        ...requestOptions,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (timeoutId) window.clearTimeout(timeoutId);

      status = response.status;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return this.parseResponseJson<T>(response);
    } catch (error) {
      const fuzzBlocked = (error as { __fuzzBlocked?: boolean }).__fuzzBlocked;
      const rawMessage = (error as Error).message || 'Request failed';
      const isAbort = (error as { name?: string }).name === 'AbortError' || /timed out/i.test(rawMessage);
      const isNetworkFailure = isNetworkFailureMessage(rawMessage);
      const normalizedError = isAbort || isNetworkFailure ? resolveHostErrorMessage(rawMessage) : rawMessage;
      if (!fuzzBlocked) {
        addErrorLog('C64 API request failed', {
          path,
          url,
          error: normalizedError,
          rawError: rawMessage,
          errorDetail: isDnsFailure(rawMessage) ? 'DNS lookup failed' : undefined,
        });
      }
      if (isAbort || isNetworkFailure) {
        throw new Error(resolveHostErrorMessage(rawMessage));
      }
      throw error;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs?: number): Promise<Response> {
    const body = options.body;
    const shouldUseWebFetch =
      isNativePlatform() && typeof FormData !== 'undefined' && body instanceof FormData;

    if (isNativePlatform() && !shouldUseWebFetch) {
      const headers = (options.headers as Record<string, string>) || {};
      const method = (options.method || 'GET').toString().toUpperCase();
      let data: unknown = undefined;

      if (isSmokeModeEnabled()) {
        console.info('C64U_HTTP_NATIVE', JSON.stringify({ method, url }));
      }

      if (body && typeof (body as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
        const buffer = await (body as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
        data = new Uint8Array(buffer);
      } else if (body instanceof ArrayBuffer) {
        data = new Uint8Array(body);
      } else if (ArrayBuffer.isView(body)) {
        data = new Uint8Array(body.buffer);
      } else if (typeof body === 'string') {
        data = body;
      } else if (body) {
        data = body;
      }

      try {
        const requestPromise = CapacitorHttp.request({
          url,
          method,
          headers,
          data,
        });
        const nativeResponse = timeoutMs
          ? await Promise.race([
            requestPromise,
            new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
            }),
          ])
          : await requestPromise;

        const responseHeaders = new Headers();
        if (nativeResponse.headers) {
          Object.entries(nativeResponse.headers).forEach(([key, value]) => {
            if (typeof value === 'string') responseHeaders.set(key, value);
          });
        }

        const bodyText = typeof nativeResponse.data === 'string'
          ? nativeResponse.data
          : JSON.stringify(nativeResponse.data ?? { errors: [] });
        return new Response(bodyText, { status: nativeResponse.status, headers: responseHeaders });
      } catch (error) {
        const rawMessage = (error as Error).message || 'Request failed';
        const isAbort = (error as { name?: string }).name === 'AbortError' || /timed out/i.test(rawMessage);
        const isNetworkFailure = isNetworkFailureMessage(rawMessage);
        if (isAbort || isNetworkFailure) {
          throw new Error(resolveHostErrorMessage(rawMessage));
        }
        throw error;
      }
    }

    const controller = timeoutMs ? new AbortController() : null;
    const timeoutId = timeoutMs ? window.setTimeout(() => controller?.abort(), timeoutMs) : null;
    try {
      return await fetch(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      const rawMessage = (error as Error).message || 'Request failed';
      const isAbort = (error as { name?: string }).name === 'AbortError' || /timed out/i.test(rawMessage);
      const isNetworkFailure = isNetworkFailureMessage(rawMessage);
      if (isAbort || isNetworkFailure) {
        throw new Error(resolveHostErrorMessage(rawMessage));
      }
      throw error;
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  // About endpoints
  async getVersion(): Promise<VersionInfo> {
    return this.request('/v1/version');
  }

  async getInfo(): Promise<DeviceInfo> {
    return this.request('/v1/info');
  }

  // Config endpoints
  async getCategories(): Promise<CategoriesResponse> {
    return this.request('/v1/configs');
  }

  async getCategory(category: string): Promise<ConfigResponse> {
    const encoded = encodeURIComponent(category);
    return this.request(`/v1/configs/${encoded}`);
  }

  async getConfigItem(category: string, item: string): Promise<ConfigResponse> {
    const catEncoded = encodeURIComponent(category);
    const itemEncoded = encodeURIComponent(item);
    return this.request(`/v1/configs/${catEncoded}/${itemEncoded}`);
  }

  async setConfigValue(category: string, item: string, value: string | number): Promise<ConfigResponse> {
    const catEncoded = encodeURIComponent(category);
    const itemEncoded = encodeURIComponent(item);
    const valEncoded = encodeURIComponent(String(value));
    return scheduleConfigWrite(() =>
      this.request(`/v1/configs/${catEncoded}/${itemEncoded}?value=${valEncoded}`, {
        method: 'PUT',
      }),
    );
  }

  async saveConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request('/v1/configs:save_to_flash', { method: 'PUT' }));
  }

  async loadConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request('/v1/configs:load_from_flash', { method: 'PUT' }));
  }

  async resetConfig(): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() => this.request('/v1/configs:reset_to_default', { method: 'PUT' }));
  }

  async updateConfigBatch(payload: Record<string, Record<string, string | number>>): Promise<{ errors: string[] }> {
    return scheduleConfigWrite(() =>
      this.request('/v1/configs', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    );
  }

  // Machine control endpoints
  async machineReset(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:reset', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machineReboot(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:reboot', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machinePause(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:pause', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machineResume(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:resume', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machinePowerOff(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:poweroff', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async machineMenuButton(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:menu_button', { method: 'PUT', timeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  }

  async readMemory(address: string, length = 1): Promise<Uint8Array> {
    const payload = await this.request<{ data?: string | number[] }>(
      `/v1/machine:readmem?address=${address}&length=${length}`
    );
    const data = payload.data;
    if (!data) return new Uint8Array();
    if (typeof data === 'string') {
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
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return this.request(`/v1/machine:writemem?address=${address}&data=${hex}`, { method: 'PUT' });
  }

  async writeMemoryBlock(address: string, data: Uint8Array): Promise<{ errors: string[] }> {
    const path = `/v1/machine:writemem?address=${address}`;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
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
            'Content-Type': 'application/octet-stream',
          },
          body: payload,
        },
        CONTROL_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('Memory DMA write failed', { status: response.status, statusText: response.statusText });
      throw error;
    }

    return this.parseResponseJson(response);
  }

  // Drive endpoints
  async getDrives(): Promise<DrivesResponse> {
    return this.request('/v1/drives');
  }

  async mountDrive(
    drive: 'a' | 'b',
    image: string,
    type?: string,
    mode?: 'readwrite' | 'readonly' | 'unlinked'
  ): Promise<{ errors: string[] }> {
    let path = `/v1/drives/${drive}:mount?image=${encodeURIComponent(image)}`;
    if (type) path += `&type=${encodeURIComponent(type)}`;
    if (mode) path += `&mode=${encodeURIComponent(mode)}`;
    return this.request(path, { method: 'PUT' });
  }

  async mountDriveUpload(
    drive: 'a' | 'b',
    image: Blob,
    type?: string,
    mode?: 'readwrite' | 'readonly' | 'unlinked'
  ): Promise<{ errors: string[] }> {
    let path = `/v1/drives/${drive}:mount`;
    if (type || mode) {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (mode) params.set('mode', mode);
      path = `${path}?${params.toString()}`;
    }

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: image,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('Drive mount upload failed', { status: response.status, statusText: response.statusText });
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async unmountDrive(drive: 'a' | 'b'): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:remove`, { method: 'PUT' });
  }

  async resetDrive(drive: 'a' | 'b'): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:reset`, { method: 'PUT' });
  }

  async driveOn(drive: 'a' | 'b'): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:on`, { method: 'PUT' });
  }

  async driveOff(drive: 'a' | 'b'): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:off`, { method: 'PUT' });
  }

  async setDriveMode(drive: 'a' | 'b', mode: '1541' | '1571' | '1581'): Promise<{ errors: string[] }> {
    return this.request(`/v1/drives/${drive}:set_mode?mode=${mode}`, { method: 'PUT' });
  }

  // Runner endpoints
  async playSid(file: string, songNr?: number): Promise<{ errors: string[] }> {
    let path = `/v1/runners:sidplay?file=${encodeURIComponent(file)}`;
    if (songNr !== undefined) path += `&songnr=${songNr}`;
    const baseUrl = this.getBaseUrl();
    const headers = this.buildAuthHeaders();
    addLog('debug', 'SID playback request', {
      baseUrl,
      deviceHost: this.deviceHost,
      url: `${baseUrl}${path}`,
      headerKeys: Object.keys(headers),
      proxyHostHeader: headers['X-C64U-Host'] ?? null,
      hasPasswordHeader: Boolean(headers['X-Password']),
    });
    return this.request(path, { method: 'PUT', timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS });
  }

  async playSidUpload(
    sidFile: Blob,
    songNr?: number,
    sslFile?: Blob,
  ): Promise<{ errors: string[] }> {
    const url = new URL(`${this.getBaseUrl()}/v1/runners:sidplay`);
    if (songNr !== undefined) {
      url.searchParams.set('songnr', String(songNr));
    }
    const headers = this.buildAuthHeaders();

    const form = new FormData();
    form.append('file', sidFile, (sidFile as any).name ?? 'track.sid');
    if (sslFile) {
      form.append('file', sslFile, (sslFile as any).name ?? 'songlengths.ssl');
    }

    const path = `${url.pathname}${url.search}`;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        url.toString(),
        {
          method,
          headers,
          body: form,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('SID upload failed', { status: response.status, statusText: response.statusText });
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async playMod(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:modplay?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async playModUpload(modFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:modplay';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: modFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('MOD upload failed', { status: response.status, statusText: response.statusText });
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async runPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_prg?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async runPrgUpload(prgFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:run_prg';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: prgFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('PRG upload failed', { status: response.status, statusText: response.statusText });
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async loadPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:load_prg?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async loadPrgUpload(prgFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:load_prg';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: prgFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('PRG upload failed', { status: response.status, statusText: response.statusText });
      throw error;
    }

    return this.parseResponseJson(response);
  }

  async runCartridge(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_crt?file=${encodeURIComponent(file)}`, {
      method: 'PUT',
      timeoutMs: PLAYBACK_REQUEST_TIMEOUT_MS,
    });
  }

  async runCartridgeUpload(crtFile: Blob): Promise<{ errors: string[] }> {
    const path = '/v1/runners:run_crt';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let status: number | 'error' = 'error';
    const method = 'POST';
    let response: Response;
    try {
      const baseUrl = this.getBaseUrl();
      response = await this.fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...this.buildAuthHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: crtFile,
        },
        UPLOAD_REQUEST_TIMEOUT_MS,
      );
      status = response.status;
    } finally {
      this.logRestCall(method, path, status, startedAt);
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      addErrorLog('CRT upload failed', { status: response.status, statusText: response.statusText });
      throw error;
    }

    return this.parseResponseJson(response);
  }
}

// Singleton instance
let apiInstance: C64API | null = null;

export function getC64API(): C64API {
  if (!apiInstance) {
    const resolvedDeviceHost = resolveDeviceHostFromStorage();
    const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
    const savedPassword = localStorage.getItem('c64u_password') || undefined;
    apiInstance = new C64API(resolvedBaseUrl, savedPassword, resolvedDeviceHost);
  }
  return apiInstance;
}

export function updateC64APIConfig(baseUrl: string, password?: string, deviceHost?: string) {
  const api = getC64API();
  const resolvedDeviceHost = normalizeDeviceHost(deviceHost ?? getDeviceHostFromBaseUrl(baseUrl));
  const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);

  api.setBaseUrl(resolvedBaseUrl);
  api.setPassword(password);
  api.setDeviceHost(resolvedDeviceHost);
  localStorage.removeItem('c64u_base_url');
  localStorage.setItem('c64u_device_host', resolvedDeviceHost);

  if (password) {
    localStorage.setItem('c64u_password', password);
  } else {
    localStorage.removeItem('c64u_password');
  }

  addLog('info', 'API routing updated (persisted)', {
    baseUrl: resolvedBaseUrl,
    deviceHost: resolvedDeviceHost,
  });
  if (isSmokeModeEnabled()) {
    console.info('C64U_ROUTING_UPDATED', JSON.stringify({ baseUrl: resolvedBaseUrl, deviceHost: resolvedDeviceHost, mode: 'persisted' }));
  }

  window.dispatchEvent(
    new CustomEvent('c64u-connection-change', {
      detail: {
        baseUrl: resolvedBaseUrl,
        password: password || '',
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
  const resolvedDeviceHost = normalizeDeviceHost(deviceHost ?? getDeviceHostFromBaseUrl(baseUrl));
  const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
  api.setBaseUrl(resolvedBaseUrl);
  api.setPassword(password);
  api.setDeviceHost(resolvedDeviceHost);
  addLog('info', 'API routing updated (runtime)', {
    baseUrl: resolvedBaseUrl,
    deviceHost: resolvedDeviceHost,
  });
  if (isSmokeModeEnabled()) {
    console.info('C64U_ROUTING_UPDATED', JSON.stringify({ baseUrl: resolvedBaseUrl, deviceHost: resolvedDeviceHost, mode: 'runtime' }));
  }

  window.dispatchEvent(
    new CustomEvent('c64u-connection-change', {
      detail: {
        baseUrl: resolvedBaseUrl,
        password: password || '',
        deviceHost: resolvedDeviceHost,
      },
    }),
  );
}

export function applyC64APIConfigFromStorage() {
  const savedPassword = localStorage.getItem('c64u_password') || undefined;
  const resolvedDeviceHost = resolveDeviceHostFromStorage();
  const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
  applyC64APIRuntimeConfig(resolvedBaseUrl, savedPassword, resolvedDeviceHost);
}

export const C64_DEFAULTS = {
  DEFAULT_BASE_URL,
  DEFAULT_DEVICE_HOST,
  DEFAULT_PROXY_URL,
};
