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
  addLog: vi.fn(),
}));

vi.mock('@/lib/c64api', () => ({
  getC64API: () => ({ playSidUpload: mocks.playSidUpload }),
}));

vi.mock('@/lib/native/backgroundExecution', () => ({
  BackgroundExecution: { start: mocks.start, stop: mocks.stop },
}));

vi.mock('@/lib/logging', () => ({
  addLog: mocks.addLog,
}));

import { SidPlayerProvider, useSidPlayer } from '@/hooks/useSidPlayer';
import { resetBackgroundExecutionState } from '@/lib/native/backgroundExecutionManager';

describe('useSidPlayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetBackgroundExecutionState();
    mocks.addLog.mockReset();
  });

  it('logs when background execution start fails', async () => {
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
    expect(mocks.addLog).toHaveBeenCalledWith(
      'warn',
      'Background execution start failed',
      expect.objectContaining({
        source: 'sid-player',
        reason: 'start',
        context: { trackId: 'track-1' },
        error: 'start-failed',
      }),
    );

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('logs when background execution stop fails', async () => {
    mocks.start.mockResolvedValueOnce(undefined);
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

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.addLog).toHaveBeenCalledWith(
      'warn',
      'Background execution stop failed',
      expect.objectContaining({
        source: 'sid-player',
        reason: 'cleanup',
        error: 'stop-failed',
      }),
    );
  });
});
