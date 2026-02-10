/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleConfigWrite, resetConfigWriteThrottle } from '@/lib/config/configWriteThrottle';
import { saveConfigWriteIntervalMs } from '@/lib/config/appSettings';

describe('configWriteThrottle', () => {
  beforeEach(() => {
    localStorage.clear();
    resetConfigWriteThrottle();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveConfigWriteIntervalMs(500);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces consecutive config writes by the configured interval', async () => {
    const times: number[] = [];
    const task = async () => {
      times.push(Date.now());
      return true;
    };

    const first = scheduleConfigWrite(task);
    const second = scheduleConfigWrite(task);

    await first;
    expect(times).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(500);
    await second;

    expect(times).toEqual([1000, 1500]);
  });
});
