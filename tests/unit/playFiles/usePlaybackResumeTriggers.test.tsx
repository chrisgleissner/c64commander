/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlaybackResumeTriggers } from '@/pages/playFiles/hooks/usePlaybackResumeTriggers';

describe('usePlaybackResumeTriggers', () => {
  const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalHidden) {
      Object.defineProperty(document, 'hidden', originalHidden);
    }
  });

  it('fires on visibilitychange only when document is visible', () => {
    const onResume = vi.fn();
    renderHook(() => usePlaybackResumeTriggers(onResume));

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onResume).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('fires on focus and pageshow', () => {
    const onResume = vi.fn();
    renderHook(() => usePlaybackResumeTriggers(onResume));

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));

    expect(onResume).toHaveBeenCalledTimes(2);
  });
});
