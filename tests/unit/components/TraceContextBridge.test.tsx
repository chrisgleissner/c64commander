/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { hvsc_enabled: true } }),
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: {
      deviceInfo: { unique_id: 'DEV-1' },
      state: 'connected',
    },
  }),
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'web',
}));

const registerTraceBridge = vi.fn();
vi.mock('@/lib/tracing/traceBridge', () => ({
  registerTraceBridge: () => registerTraceBridge(),
}));

import { TraceContextBridge } from '@/components/TraceContextBridge';
import { getTraceContextSnapshot, setTracePlaybackContext, setTraceUiContext } from '@/lib/tracing/traceContext';
import { setPlaybackTraceSnapshot } from '@/pages/playFiles/playbackTraceStore';

describe('TraceContextBridge', () => {
  beforeEach(() => {
    // Reset the trace context and playback snapshot between tests.
    setTraceUiContext('/', '');
    setTracePlaybackContext(null);
    setPlaybackTraceSnapshot(null);
    registerTraceBridge.mockClear();
  });

  it('pushes playback trace snapshot into trace context', async () => {
    setPlaybackTraceSnapshot({
      queueLength: 3,
      currentIndex: 1,
      currentItemId: 'item-2',
      isPlaying: true,
      elapsedMs: 1234,
      durationMs: 5000,
      sourceKind: 'ultimate',
      localAccessMode: null,
      trackInstanceId: 7,
      playlistItemId: 'item-2',
    });

    render(
      <MemoryRouter initialEntries={['/play?demo=1']}>
        <TraceContextBridge />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const snapshot = getTraceContextSnapshot();
      expect(snapshot.ui.route).toBe('/play');
      expect(snapshot.playback?.sourceKind).toBe('ultimate');
      expect(snapshot.playback?.trackInstanceId).toBe(7);
      expect(snapshot.playback?.playlistItemId).toBe('item-2');
    });
  });
});
