const FUZZ_MODE_KEY = 'c64u_fuzz_mode_enabled';
const FUZZ_MOCK_BASE_URL_KEY = 'c64u_fuzz_mock_base_url';
const FUZZ_STORAGE_SEEDED_KEY = 'c64u_fuzz_storage_seeded';
const DEBUG_LOGGING_KEY = 'c64u_debug_logging_enabled';
const AUTO_DEMO_MODE_KEY = 'c64u_automatic_demo_mode_enabled';
const STARTUP_DISCOVERY_WINDOW_MS_KEY = 'c64u_startup_discovery_window_ms';
const BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY = 'c64u_background_rediscovery_interval_ms';

const readStorageValue = (key: string) => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
};

export const isFuzzModeEnabled = () => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FUZZ_MODE === '1') return true;
  } catch {
    // ignore
  }
  if (typeof window === 'undefined') return false;
  if ((window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode) return true;
  return readStorageValue(FUZZ_MODE_KEY) === '1';
};

export const getFuzzMockBaseUrl = () => readStorageValue(FUZZ_MOCK_BASE_URL_KEY);

export const markFuzzModeEnabled = () => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(FUZZ_MODE_KEY, '1');
};

export const resetFuzzStorage = () => {
  if (!isFuzzModeEnabled()) return;
  if (typeof localStorage !== 'undefined') {
    if (localStorage.getItem(FUZZ_STORAGE_SEEDED_KEY) === '1') return;
    const fuzzMockBaseUrl = localStorage.getItem(FUZZ_MOCK_BASE_URL_KEY);
    localStorage.clear();
    localStorage.setItem(FUZZ_MODE_KEY, '1');
    if (fuzzMockBaseUrl) {
      localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, fuzzMockBaseUrl);
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
};

export const applyFuzzModeDefaults = () => {
  if (!isFuzzModeEnabled()) return;
  if (typeof localStorage === 'undefined') return;

  resetFuzzStorage();
  localStorage.setItem(FUZZ_STORAGE_SEEDED_KEY, '1');
  localStorage.setItem(DEBUG_LOGGING_KEY, '1');
  localStorage.setItem(AUTO_DEMO_MODE_KEY, '1');
  localStorage.setItem(STARTUP_DISCOVERY_WINDOW_MS_KEY, '500');
  localStorage.setItem(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, '1500');
};

const isLocalHost = (host: string) =>
  host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';

export const isFuzzSafeBaseUrl = (baseUrl: string) => {
  const fuzzMock = getFuzzMockBaseUrl();
  if (fuzzMock && baseUrl === fuzzMock) return true;
  try {
    const url = new URL(baseUrl);
    return isLocalHost(url.hostname);
  } catch {
    return false;
  }
};

export const fuzzModeKeys = {
  FUZZ_MODE_KEY,
  FUZZ_MOCK_BASE_URL_KEY,
  FUZZ_STORAGE_SEEDED_KEY,
};
