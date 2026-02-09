/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { clearHvscRoot, getDefaultHvscRoot, loadHvscRoot, saveHvscRoot } from '@/lib/hvsc/hvscRootLocator';

describe('hvscRootLocator', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
