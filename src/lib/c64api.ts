// C64 Ultimate REST API Client

import { CapacitorHttp } from '@capacitor/core';

const DEFAULT_BASE_URL = 'http://c64u';
const DEFAULT_DEVICE_HOST = 'c64u';
const DEFAULT_PROXY_URL = 'http://127.0.0.1:8787';

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
  private baseUrl: string;
  private password?: string;
  private deviceHost?: string;

  constructor(
    baseUrl: string = DEFAULT_BASE_URL,
    password?: string,
    deviceHost: string = DEFAULT_DEVICE_HOST
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.password = password;
    this.deviceHost = deviceHost;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  setPassword(password?: string) {
    this.password = password;
  }

  setDeviceHost(deviceHost?: string) {
    this.deviceHost = deviceHost || DEFAULT_DEVICE_HOST;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.password) {
      headers['X-Password'] = this.password;
    }

    if (this.deviceHost && isLocalProxy(this.baseUrl)) {
      headers['X-C64U-Host'] = this.deviceHost;
    }

    const url = `${this.baseUrl}${path}`;

    if (isNativePlatform()) {
      const method = (options.method || 'GET') as string;
      const body = options.body ? options.body : undefined;
      const nativeResponse = await CapacitorHttp.request({
        url,
        method,
        headers,
        data: typeof body === 'string' ? JSON.parse(body) : body,
      });

      if (nativeResponse.status < 200 || nativeResponse.status >= 300) {
        throw new Error(`HTTP ${nativeResponse.status}`);
      }

      if (typeof nativeResponse.data === 'string') {
        return JSON.parse(nativeResponse.data) as T;
      }

      return nativeResponse.data as T;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
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
    return this.request(`/v1/configs/${catEncoded}/${itemEncoded}?value=${valEncoded}`, {
      method: 'PUT',
    });
  }

  async saveConfig(): Promise<{ errors: string[] }> {
    return this.request('/v1/configs:save_to_flash', { method: 'PUT' });
  }

  async loadConfig(): Promise<{ errors: string[] }> {
    return this.request('/v1/configs:load_from_flash', { method: 'PUT' });
  }

  async resetConfig(): Promise<{ errors: string[] }> {
    return this.request('/v1/configs:reset_to_default', { method: 'PUT' });
  }

  // Machine control endpoints
  async machineReset(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:reset', { method: 'PUT' });
  }

  async machineReboot(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:reboot', { method: 'PUT' });
  }

  async machinePause(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:pause', { method: 'PUT' });
  }

  async machineResume(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:resume', { method: 'PUT' });
  }

  async machinePowerOff(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:poweroff', { method: 'PUT' });
  }

  async machineMenuButton(): Promise<{ errors: string[] }> {
    return this.request('/v1/machine:menu_button', { method: 'PUT' });
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
    return this.request(path, { method: 'PUT' });
  }

  async runPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_prg?file=${encodeURIComponent(file)}`, { method: 'PUT' });
  }

  async loadPrg(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:load_prg?file=${encodeURIComponent(file)}`, { method: 'PUT' });
  }

  async runCartridge(file: string): Promise<{ errors: string[] }> {
    return this.request(`/v1/runners:run_crt?file=${encodeURIComponent(file)}`, { method: 'PUT' });
  }
}

// Singleton instance
let apiInstance: C64API | null = null;

export function getC64API(): C64API {
  if (!apiInstance) {
    const savedUrl = localStorage.getItem('c64u_base_url') || getDefaultBaseUrl();
    const savedPassword = localStorage.getItem('c64u_password') || undefined;
    const savedDeviceHost = localStorage.getItem('c64u_device_host') || DEFAULT_DEVICE_HOST;
    apiInstance = new C64API(savedUrl, savedPassword, savedDeviceHost);
  }
  return apiInstance;
}

export function updateC64APIConfig(baseUrl: string, password?: string, deviceHost?: string) {
  const api = getC64API();
  api.setBaseUrl(baseUrl);
  api.setPassword(password);
  api.setDeviceHost(deviceHost);
  localStorage.setItem('c64u_base_url', baseUrl);
  if (password) {
    localStorage.setItem('c64u_password', password);
  } else {
    localStorage.removeItem('c64u_password');
  }

  if (deviceHost) {
    localStorage.setItem('c64u_device_host', deviceHost);
  } else {
    localStorage.removeItem('c64u_device_host');
  }
}

export const C64_DEFAULTS = {
  DEFAULT_BASE_URL,
  DEFAULT_DEVICE_HOST,
  DEFAULT_PROXY_URL,
};
