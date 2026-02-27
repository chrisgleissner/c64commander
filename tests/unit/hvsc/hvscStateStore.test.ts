/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHvscState } from '@/lib/hvsc/hvscStateStore';
import { addLog } from '@/lib/logging';

vi.mock('@/lib/logging', () => ({
  addLog: vi.fn(),
}));

describe('hvscStateStore', () => {
  beforeEach(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      const store = new Map<string, string>();
      (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      } as Storage;
    } else {
      globalThis.localStorage.clear();
    }
  });

  it('logs and returns defaults when storage is corrupted', () => {
    localStorage.setItem('c64u_hvsc_state:v1', '{broken');

    const state = loadHvscState();

    expect(state.ingestionState).toBe('idle');
    expect(addLog).toHaveBeenCalledWith('warn', 'Failed to load HVSC state from storage', expect.objectContaining({
      storageKey: 'c64u_hvsc_state:v1',
      error: expect.any(String),
    }));
  });
});
