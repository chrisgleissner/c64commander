import { Capacitor, CapacitorHttp } from '@capacitor/core';

export type HvscReleaseStatus = {
  baselineVersion: number;
  updateVersion: number;
  baseUrl: string;
};

const DEFAULT_BASE_URL = 'https://hvsc.brona.dk/HVSC/';
const HVSC_BASE_URL_KEY = 'c64u_hvsc_base_url';

const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const normalizeBaseUrl = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const resolveHvscBaseUrl = (override?: string) => {
  if (override) return normalizeBaseUrl(override);
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(HVSC_BASE_URL_KEY);
    if (stored) return normalizeBaseUrl(stored);
  }
  return DEFAULT_BASE_URL;
};

export const getHvscBaseUrl = () => resolveHvscBaseUrl();

export const getHvscBaseUrlOverride = () => {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(HVSC_BASE_URL_KEY);
  return stored ? normalizeBaseUrl(stored) : null;
};

export const setHvscBaseUrlOverride = (value?: string | null) => {
  if (typeof localStorage === 'undefined') return;
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    localStorage.removeItem(HVSC_BASE_URL_KEY);
    return;
  }
  localStorage.setItem(HVSC_BASE_URL_KEY, normalizeBaseUrl(trimmed));
};

const fetchHvscIndex = async (baseUrl: string) => {
  if (isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: baseUrl,
      method: 'GET',
      headers: { 'Cache-Control': 'no-store' },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HVSC release fetch failed: ${response.status}`);
    }
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
  }

  const response = await fetch(baseUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HVSC release fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
};

export const fetchLatestHvscVersions = async (baseUrl?: string): Promise<HvscReleaseStatus> => {
  const resolvedBaseUrl = resolveHvscBaseUrl(baseUrl);
  const html = await fetchHvscIndex(resolvedBaseUrl);
  const baselineRegex = /HVSC_(\d+)-all-of-them\.7z/gi;
  const updateRegex = /HVSC_Update_(\d+)\.7z/gi;
  const baselineVersions = Array.from(html.matchAll(baselineRegex))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  const updateVersions = Array.from(html.matchAll(updateRegex))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  const baselineVersion = baselineVersions.length ? Math.max(...baselineVersions) : 0;
  const updateVersion = updateVersions.length ? Math.max(...updateVersions) : baselineVersion;
  return { baselineVersion, updateVersion, baseUrl: resolvedBaseUrl };
};

export const buildHvscBaselineUrl = (version: number, baseUrl?: string) =>
  `${resolveHvscBaseUrl(baseUrl)}HVSC_${version}-all-of-them.7z`;

export const buildHvscUpdateUrl = (version: number, baseUrl?: string) =>
  `${resolveHvscBaseUrl(baseUrl)}HVSC_Update_${version}.7z`;
