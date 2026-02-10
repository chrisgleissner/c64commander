/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const LIST_PREVIEW_LIMIT_KEY = 'c64u_list_preview_limit';

export const DEFAULT_LIST_PREVIEW_LIMIT = 50;
export const MIN_LIST_PREVIEW_LIMIT = 1;
export const MAX_LIST_PREVIEW_LIMIT = 200;

const clampLimit = (value: number) => {
  if (!Number.isFinite(value)) return DEFAULT_LIST_PREVIEW_LIMIT;
  return Math.min(MAX_LIST_PREVIEW_LIMIT, Math.max(MIN_LIST_PREVIEW_LIMIT, Math.round(value)));
};

export const getListPreviewLimit = () => {
  if (typeof localStorage === 'undefined') return DEFAULT_LIST_PREVIEW_LIMIT;
  const raw = localStorage.getItem(LIST_PREVIEW_LIMIT_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return clampLimit(parsed);
};

export const setListPreviewLimit = (value: number) => {
  if (typeof localStorage === 'undefined') return;
  const clamped = clampLimit(value);
  localStorage.setItem(LIST_PREVIEW_LIMIT_KEY, String(clamped));
  window.dispatchEvent(new CustomEvent('c64u-ui-preferences-changed', { detail: { listPreviewLimit: clamped } }));
};

export const clampListPreviewLimit = clampLimit;
