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
