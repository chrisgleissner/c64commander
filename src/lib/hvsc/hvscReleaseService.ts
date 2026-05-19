/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { variant } from "@/generated/variant";

export type HvscReleaseStatus = {
  baselineVersion: number;
  updateVersion: number;
  baseUrl: string;
};

const DEFAULT_BASE_URL = variant.runtime.endpoints.hvsc_base_url ?? "https://hvsc.brona.dk/HVSC/";
const HVSC_BASE_URL_KEY = "c64u_hvsc_base_url";
const HVSC_UPDATE_CHECK_INTERVAL_HOURS_KEY = "c64u_hvsc_update_check_interval_hours";
const HVSC_LAST_UPDATE_CHECK_AT_KEY = "c64u_hvsc_last_update_check_at";
export const DEFAULT_HVSC_UPDATE_CHECK_INTERVAL_HOURS = 24;
export const MIN_HVSC_UPDATE_CHECK_INTERVAL_HOURS = 6;
const MAX_HVSC_UPDATE_CHECK_INTERVAL_HOURS = 24 * 30;

const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch (error) {
    console.warn("Failed to detect native platform for HVSC release service", {
      error,
    });
    return false;
  }
};

const normalizeBaseUrl = (baseUrl: string) => (baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
const clampUpdateCheckIntervalHours = (value: number) =>
  Math.min(MAX_HVSC_UPDATE_CHECK_INTERVAL_HOURS, Math.max(MIN_HVSC_UPDATE_CHECK_INTERVAL_HOURS, Math.round(value)));

const normalizeUpdateCheckIntervalHours = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_HVSC_UPDATE_CHECK_INTERVAL_HOURS;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_HVSC_UPDATE_CHECK_INTERVAL_HOURS;
  }
  return clampUpdateCheckIntervalHours(numeric);
};

const resolveHvscBaseUrl = (override?: string) => {
  if (override) return normalizeBaseUrl(override);
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(HVSC_BASE_URL_KEY);
    if (stored) return normalizeBaseUrl(stored);
  }
  return DEFAULT_BASE_URL;
};

export const getHvscBaseUrl = () => resolveHvscBaseUrl();

export const getHvscBaseUrlOverride = () => {
  if (typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(HVSC_BASE_URL_KEY);
  return stored ? normalizeBaseUrl(stored) : null;
};

export const setHvscBaseUrlOverride = (value?: string | null) => {
  if (typeof localStorage === "undefined") return;
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    localStorage.removeItem(HVSC_BASE_URL_KEY);
    return;
  }
  localStorage.setItem(HVSC_BASE_URL_KEY, normalizeBaseUrl(trimmed));
};

export const getHvscUpdateCheckIntervalHours = () => {
  if (typeof localStorage === "undefined") {
    return DEFAULT_HVSC_UPDATE_CHECK_INTERVAL_HOURS;
  }
  return normalizeUpdateCheckIntervalHours(localStorage.getItem(HVSC_UPDATE_CHECK_INTERVAL_HOURS_KEY));
};

export const setHvscUpdateCheckIntervalHours = (value?: string | number | null) => {
  const normalized = normalizeUpdateCheckIntervalHours(value);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(HVSC_UPDATE_CHECK_INTERVAL_HOURS_KEY, String(normalized));
  }
  return normalized;
};

export const getHvscLastUpdateCheckAt = () => {
  if (typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(HVSC_LAST_UPDATE_CHECK_AT_KEY);
  return stored || null;
};

export const markHvscUpdateCheckAt = (timestamp = new Date().toISOString()) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(HVSC_LAST_UPDATE_CHECK_AT_KEY, timestamp);
};

export const shouldCheckForHvscUpdates = (now = Date.now()) => {
  const lastCheckedAt = getHvscLastUpdateCheckAt();
  if (!lastCheckedAt) return true;
  const parsed = Date.parse(lastCheckedAt);
  if (Number.isNaN(parsed)) return true;
  const intervalMs = getHvscUpdateCheckIntervalHours() * 60 * 60 * 1000;
  return now - parsed >= intervalMs;
};

const fetchHvscIndex = async (baseUrl: string) => {
  if (isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: baseUrl,
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HVSC release fetch failed: ${response.status}`);
    }
    return typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
  }

  const response = await fetch(baseUrl, { cache: "no-store" });
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
