/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TraceActionContext } from '@/lib/tracing/types';
import { getTraceContextSnapshot } from '@/lib/tracing/traceContext';

export type NativeTraceContext = {
  correlationId: string | null;
  trackInstanceId: number | null;
  playlistItemId: string | null;
};

export const resolveNativeTraceContext = (action?: TraceActionContext | null): NativeTraceContext => {
  const playback = getTraceContextSnapshot().playback;
  return {
    correlationId: action?.correlationId ?? null,
    trackInstanceId: playback?.trackInstanceId ?? null,
    playlistItemId: playback?.playlistItemId ?? null,
  };
};
