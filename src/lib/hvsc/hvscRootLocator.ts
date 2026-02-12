/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type HvscRootLocation = {
  path: string;
  label: string;
};

const STORAGE_KEY = 'c64u_hvsc_root:v1';

export const getDefaultHvscRoot = (): HvscRootLocation => ({
  path: '/',
  label: 'HVSC',
});

export const loadHvscRoot = (): HvscRootLocation => {
  if (typeof localStorage === 'undefined') return getDefaultHvscRoot();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return getDefaultHvscRoot();
  try {
    const parsed = JSON.parse(raw) as HvscRootLocation;
    if (!parsed?.path || !parsed?.label) return getDefaultHvscRoot();
    return parsed;
  } catch (error) {
    console.warn('Failed to load HVSC root from storage', { error });
    return getDefaultHvscRoot();
  }
};

export const saveHvscRoot = (root: HvscRootLocation) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
};

export const clearHvscRoot = () => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
};
