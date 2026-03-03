/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  clampListPreviewLimit,
  DEFAULT_LIST_PREVIEW_LIMIT,
  getListPreviewLimit,
  MAX_LIST_PREVIEW_LIMIT,
  MIN_LIST_PREVIEW_LIMIT,
  setListPreviewLimit,
} from '@/lib/uiPreferences';

describe('uiPreferences', () => {
  it('clamps list preview limits to bounds', () => {
    expect(clampListPreviewLimit(-5)).toBe(MIN_LIST_PREVIEW_LIMIT);
    expect(clampListPreviewLimit(999)).toBe(MAX_LIST_PREVIEW_LIMIT);
    expect(clampListPreviewLimit(22.9)).toBe(23);
  });

  it('returns default limit for non-finite values (NaN, Infinity)', () => {
    // Covers the !Number.isFinite(value) guard branch in clampLimit
    expect(clampListPreviewLimit(NaN)).toBe(DEFAULT_LIST_PREVIEW_LIMIT);
    expect(clampListPreviewLimit(Infinity)).toBe(DEFAULT_LIST_PREVIEW_LIMIT);
  });

  it('returns defaults when localStorage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });

    expect(getListPreviewLimit()).toBe(DEFAULT_LIST_PREVIEW_LIMIT);

    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original);
    }
  });

  it('reads and writes list preview limits with events', () => {
    localStorage.clear();
    const handler = vi.fn();
    window.addEventListener('c64u-ui-preferences-changed', handler);

    setListPreviewLimit(75);

    expect(getListPreviewLimit()).toBe(75);
    expect(handler).toHaveBeenCalled();

    window.removeEventListener('c64u-ui-preferences-changed', handler);
  });
});
