/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLifecycleState } from '@/lib/appLifecycle';

describe('appLifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns foreground when document is visible and focused', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    expect(getLifecycleState()).toBe('foreground');
  });

  it('returns background when document.visibilityState is hidden (short-circuit || branch)', () => {
    // Covers the visibilityState === 'hidden' true branch (the left side of ||)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    expect(getLifecycleState()).toBe('background');
  });

  it('returns background when document.hidden is true (right side of || branch)', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    expect(getLifecycleState()).toBe('background');
  });

  it('returns locked when document is visible but not focused', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    expect(getLifecycleState()).toBe('locked');
  });
});
