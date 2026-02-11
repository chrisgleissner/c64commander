/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest';
import { clearHvscRoot, getDefaultHvscRoot, loadHvscRoot, saveHvscRoot } from '@/lib/hvsc/hvscRootLocator';

describe('hvscRootLocator', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns default root when storage is empty', () => {
    expect(loadHvscRoot()).toEqual(getDefaultHvscRoot());
  });

  it('persists and loads the hvsc root location', () => {
    const root = { path: '/HVSC', label: 'HVSC Library' };
    saveHvscRoot(root);

    expect(loadHvscRoot()).toEqual(root);
    clearHvscRoot();
    expect(loadHvscRoot()).toEqual(getDefaultHvscRoot());
  });

  it('returns default if stored JSON is valid but incomplete', () => {
    localStorage.setItem('c64u_hvsc_root:v1', JSON.stringify({ path: '/foo' })); // missing label
    expect(loadHvscRoot()).toEqual(getDefaultHvscRoot());
  });

  it('returns default if stored content is malformed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('c64u_hvsc_root:v1', '{ invalid json ');
    expect(loadHvscRoot()).toEqual(getDefaultHvscRoot());
    expect(warnSpy).toHaveBeenCalledWith('Failed to load HVSC root from storage', expect.any(Object));
    warnSpy.mockRestore();
  });

  it('handles missing localStorage (load)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadHvscRoot()).toEqual(getDefaultHvscRoot());
  });

  it('handles missing localStorage (save)', () => {
    vi.stubGlobal('localStorage', undefined);
    // Should not throw
    saveHvscRoot({ path: '/a', label: 'b' });
  });

  it('handles missing localStorage (clear)', () => {
    vi.stubGlobal('localStorage', undefined);
    // Should not throw
    clearHvscRoot();
  });
});

