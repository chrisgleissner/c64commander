/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';

const getTraceContextSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/tracing/traceContext', () => ({
  getTraceContextSnapshot: getTraceContextSnapshotMock,
}));

import { resolveNativeTraceContext } from '@/lib/native/nativeTraceContext';

describe('resolveNativeTraceContext', () => {
  it('returns nulls when action and playback context are unavailable', () => {
    getTraceContextSnapshotMock.mockReturnValue({ playback: null });

    expect(resolveNativeTraceContext()).toEqual({
      correlationId: null,
      trackInstanceId: null,
      playlistItemId: null,
    });
  });

  it('returns action and playback identifiers when present', () => {
    getTraceContextSnapshotMock.mockReturnValue({
      playback: {
        trackInstanceId: 42,
        playlistItemId: 'item-42',
      },
    });

    expect(resolveNativeTraceContext({ correlationId: 'corr-42' } as never)).toEqual({
      correlationId: 'corr-42',
      trackInstanceId: 42,
      playlistItemId: 'item-42',
    });
  });
});
