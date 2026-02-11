/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HvscIngestionState, HvscStatus } from './hvscTypes';

type HvscUpdateRecord = {
  version: number;
  status: 'success' | 'failed' | 'unknown';
  error?: string | null;
};

export type HvscState = HvscStatus & {
  updates: Record<number, HvscUpdateRecord>;
};

const STORAGE_KEY = 'c64u_hvsc_state:v1';

const validIngestionStates = new Set<HvscIngestionState>(['idle', 'installing', 'updating', 'ready', 'error']);

const toIngestionState = (value: unknown): HvscIngestionState =>
  typeof value === 'string' && validIngestionStates.has(value as HvscIngestionState)
    ? (value as HvscIngestionState)
    : 'idle';

const defaultState = (): HvscState => ({
  installedBaselineVersion: null,
  installedVersion: 0,
  ingestionState: 'idle',
  lastUpdateCheckUtcMs: null,
  ingestionError: null,
  updates: {},
});

export const loadHvscState = (): HvscState => {
  if (typeof localStorage === 'undefined') return defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as Partial<HvscState> | null;
    if (!parsed) return defaultState();
    return {
      installedBaselineVersion: parsed.installedBaselineVersion ?? null,
      installedVersion: parsed.installedVersion ?? 0,
      ingestionState: toIngestionState(parsed.ingestionState),
      lastUpdateCheckUtcMs: parsed.lastUpdateCheckUtcMs ?? null,
      ingestionError: parsed.ingestionError ?? null,
      updates: parsed.updates ?? {},
    };
  } catch (error) {
    console.warn('Failed to load HVSC state from storage', { error });
    return defaultState();
  }
};

export const saveHvscState = (state: HvscState) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const updateHvscState = (partial: Partial<HvscState>) => {
  const current = loadHvscState();
  const next: HvscState = {
    ...current,
    ...partial,
    updates: partial.updates ?? current.updates,
  };
  saveHvscState(next);
  return next;
};

export const markUpdateApplied = (version: number, status: 'success' | 'failed', error?: string | null) => {
  const current = loadHvscState();
  const next: HvscState = {
    ...current,
    updates: {
      ...current.updates,
      [version]: { version, status, error: error ?? null },
    },
  };
  saveHvscState(next);
  return next;
};

export const isUpdateApplied = (version: number) => {
  const record = loadHvscState().updates[version];
  return record?.status === 'success';
};
