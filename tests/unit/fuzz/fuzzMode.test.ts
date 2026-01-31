import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFuzzModeDefaults,
  fuzzModeKeys,
  getFuzzMockBaseUrl,
  isFuzzModeEnabled,
  isFuzzSafeBaseUrl,
  markFuzzModeEnabled,
  resetFuzzStorage,
} from '@/lib/fuzz/fuzzMode';

const { FUZZ_MODE_KEY, FUZZ_MOCK_BASE_URL_KEY, FUZZ_STORAGE_SEEDED_KEY } = fuzzModeKeys;

describe('fuzzMode', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as { __c64uFuzzMode?: boolean }).__c64uFuzzMode;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects fuzz mode from env flag', () => {
    vi.stubEnv('VITE_FUZZ_MODE', '1');
    expect(isFuzzModeEnabled()).toBe(true);
  });

  it('detects fuzz mode from window override', () => {
    (window as { __c64uFuzzMode?: boolean }).__c64uFuzzMode = true;
    expect(isFuzzModeEnabled()).toBe(true);
  });

  it('detects fuzz mode from localStorage flag', () => {
    expect(isFuzzModeEnabled()).toBe(false);
    markFuzzModeEnabled();
    expect(isFuzzModeEnabled()).toBe(true);
  });

  it('resets storage and preserves mock base URL', () => {
    localStorage.setItem(FUZZ_MODE_KEY, '1');
    localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, 'http://localhost:3001');
    localStorage.setItem('other', 'value');

    resetFuzzStorage();

    expect(localStorage.getItem(FUZZ_MODE_KEY)).toBe('1');
    expect(getFuzzMockBaseUrl()).toBe('http://localhost:3001');
    expect(localStorage.getItem('other')).toBeNull();
  });

  it('skips reset when already seeded', () => {
    localStorage.setItem(FUZZ_MODE_KEY, '1');
    localStorage.setItem(FUZZ_STORAGE_SEEDED_KEY, '1');
    localStorage.setItem('other', 'value');

    resetFuzzStorage();

    expect(localStorage.getItem('other')).toBe('value');
  });

  it('applies default fuzz settings', () => {
    localStorage.setItem(FUZZ_MODE_KEY, '1');

    applyFuzzModeDefaults();

    expect(localStorage.getItem(FUZZ_STORAGE_SEEDED_KEY)).toBe('1');
    expect(localStorage.getItem('c64u_debug_logging_enabled')).toBe('1');
    expect(localStorage.getItem('c64u_automatic_demo_mode_enabled')).toBe('1');
    expect(localStorage.getItem('c64u_startup_discovery_window_ms')).toBe('500');
    expect(localStorage.getItem('c64u_background_rediscovery_interval_ms')).toBe('1500');
  });

  it('validates safe base URLs for fuzz mode', () => {
    localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, 'http://localhost:5555');

    expect(isFuzzSafeBaseUrl('http://localhost:5555')).toBe(true);
    expect(isFuzzSafeBaseUrl('http://example.com')).toBe(false);
    expect(isFuzzSafeBaseUrl('relative/path')).toBe(false);
  });

  it('accepts non-http mock URLs as safe', () => {
    localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, 'local');

    expect(isFuzzSafeBaseUrl('local')).toBe(true);
  });
});
