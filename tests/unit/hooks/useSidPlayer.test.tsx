/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
  playSidUpload: vi.fn(async () => undefined),
  start: vi.fn(async () => {
    throw new Error('start-failed');
  }),
  stop: vi.fn(async () => {
    throw new Error('stop-failed');
  }),
}));

vi.mock('@/lib/c64api', () => ({
  getC64API: () => ({ playSidUpload: mocks.playSidUpload }),
}));

vi.mock('@/lib/native/backgroundExecution', () => ({
  BackgroundExecution: { start: mocks.start, stop: mocks.stop },
}));

import { SidPlayerProvider, useSidPlayer } from '@/hooks/useSidPlayer';

describe('useSidPlayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs when background execution start/stop fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SidPlayerProvider>{children}</SidPlayerProvider>
    );

    const { result, unmount } = renderHook(() => useSidPlayer(), { wrapper });

    await act(async () => {
      await result.current.playTrack({
        id: 'track-1',
        title: 'Track 1',
        source: 'local',
        data: new Uint8Array([1, 2, 3]),
      });
    });

    expect(mocks.playSidUpload).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Background execution start failed',
      expect.objectContaining({ trackId: 'track-1' }),
    );

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledWith(
      'Background execution stop failed',
      expect.objectContaining({ error: expect.anything() }),
    );
  });
});
