/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from '@/lib/logging';

const MOTION_MODE_STORAGE_KEY = 'c64_motion_mode';
const LOW_END_DEVICE_MAX_CORES = 4;
const LOW_END_DEVICE_MAX_MEMORY_GB = 4;

export type RuntimeMotionMode = 'standard' | 'reduced';
export type RuntimeMotionReason =
  | 'user-override'
  | 'system-preference'
  | 'low-end-device'
  | 'default';

export type MotionRuntimeEnvironment = {
  localStorage?: Pick<Storage, 'getItem'>;
  navigator?: Pick<Navigator, 'hardwareConcurrency' | 'userAgent'> & {
    deviceMemory?: number;
  };
  matchMedia?: (query: string) => { matches: boolean };
  document?: Pick<Document, 'documentElement'>;
};

export type RuntimeMotionResolution = {
  mode: RuntimeMotionMode;
  reason: RuntimeMotionReason;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
};

const toFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const parseOverride = (value: string | null): RuntimeMotionMode | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'reduced' ||
    normalized === 'low' ||
    normalized === 'minimal'
  )
    return 'reduced';
  if (
    normalized === 'standard' ||
    normalized === 'full' ||
    normalized === 'high'
  )
    return 'standard';
  return null;
};

const defaultEnvironment = (): MotionRuntimeEnvironment => {
  if (typeof window === 'undefined') return {};
  return {
    localStorage: window.localStorage,
    navigator: window.navigator as MotionRuntimeEnvironment['navigator'],
    matchMedia: window.matchMedia.bind(window),
    document: window.document,
  };
};

const readMotionOverride = (
  environment: MotionRuntimeEnvironment,
): RuntimeMotionMode | null => {
  const storage = environment.localStorage;
  if (!storage) return null;
  try {
    return parseOverride(storage.getItem(MOTION_MODE_STORAGE_KEY));
  } catch (error) {
    addLog('warn', 'Failed to read runtime motion mode override', {
      error: (error as Error).message,
    });
    return null;
  }
};

const prefersReducedMotion = (
  environment: MotionRuntimeEnvironment,
): boolean => {
  if (!environment.matchMedia) return false;
  try {
    return environment.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    addLog('warn', 'Failed to evaluate prefers-reduced-motion media query', {
      error: (error as Error).message,
    });
    return false;
  }
};

const isLowEndDevice = (environment: MotionRuntimeEnvironment): boolean => {
  const hardwareConcurrency = toFiniteNumber(
    environment.navigator?.hardwareConcurrency,
  );
  const deviceMemoryGb = toFiniteNumber(environment.navigator?.deviceMemory);
  const userAgent = environment.navigator?.userAgent?.toLowerCase() ?? '';
  const cpuBound =
    hardwareConcurrency !== null &&
    hardwareConcurrency <= LOW_END_DEVICE_MAX_CORES;
  const memoryBound =
    deviceMemoryGb !== null && deviceMemoryGb <= LOW_END_DEVICE_MAX_MEMORY_GB;
  const legacyAndroid = /sm-n900|android [4-8]\./.test(userAgent);
  return cpuBound || memoryBound || legacyAndroid;
};

export const resolveRuntimeMotionMode = (
  environment: MotionRuntimeEnvironment = defaultEnvironment(),
): RuntimeMotionResolution => {
  const hardwareConcurrency = toFiniteNumber(
    environment.navigator?.hardwareConcurrency,
  );
  const deviceMemoryGb = toFiniteNumber(environment.navigator?.deviceMemory);
  const override = readMotionOverride(environment);
  if (override) {
    return {
      mode: override,
      reason: 'user-override',
      hardwareConcurrency,
      deviceMemoryGb,
    };
  }
  if (prefersReducedMotion(environment)) {
    return {
      mode: 'reduced',
      reason: 'system-preference',
      hardwareConcurrency,
      deviceMemoryGb,
    };
  }
  if (isLowEndDevice(environment)) {
    return {
      mode: 'reduced',
      reason: 'low-end-device',
      hardwareConcurrency,
      deviceMemoryGb,
    };
  }
  return {
    mode: 'standard',
    reason: 'default',
    hardwareConcurrency,
    deviceMemoryGb,
  };
};

export const applyRuntimeMotionMode = (
  resolution: RuntimeMotionResolution,
  environment: MotionRuntimeEnvironment = defaultEnvironment(),
) => {
  const root = environment.document?.documentElement;
  if (!root) return;
  root.dataset.c64MotionMode = resolution.mode;
  root.classList.toggle('c64-motion-reduced', resolution.mode === 'reduced');
};

export const initializeRuntimeMotionMode = (
  environment: MotionRuntimeEnvironment = defaultEnvironment(),
) => {
  const resolution = resolveRuntimeMotionMode(environment);
  applyRuntimeMotionMode(resolution, environment);
  addLog('info', 'Runtime motion mode selected', resolution);
  return resolution;
};
