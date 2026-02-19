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
  startBackgroundExecution: vi.fn(async () => undefined),
  stopBackgroundExecution: vi.fn(async () => undefined),
}));

vi.mock('@/lib/c64api', () => ({
  getC64API: () => ({ playSidUpload: mocks.playSidUpload }),
}));

vi.mock('@/lib/native/backgroundExecutionManager', () => ({
  startBackgroundExecution: mocks.startBackgroundExecution,
  stopBackgroundExecution: mocks.stopBackgroundExecution,
}));

import { SidPlayerProvider, useSidPlayer } from '@/hooks/useSidPlayer';

describe('useSidPlayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.startBackgroundExecution.mockReset();
    mocks.stopBackgroundExecution.mockReset();
  });

  it('does not start background execution in deprecated provider path', async () => {
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
    expect(mocks.startBackgroundExecution).not.toHaveBeenCalled();

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
  });
});
