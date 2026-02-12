/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from 'react';
import type { TracePlaybackContext } from '@/lib/tracing/types';

let snapshot: TracePlaybackContext | null = null;
const listeners = new Set<(next: TracePlaybackContext | null) => void>();

const emit = () => {
  listeners.forEach((listener) => listener(snapshot));
};

export const getPlaybackTraceSnapshot = () => snapshot;

export const setPlaybackTraceSnapshot = (next: TracePlaybackContext | null) => {
  snapshot = next;
  emit();
};

export const subscribePlaybackTraceSnapshot = (listener: (next: TracePlaybackContext | null) => void) => {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
};

export const usePlaybackTraceSnapshot = () =>
  useSyncExternalStore(subscribePlaybackTraceSnapshot, getPlaybackTraceSnapshot, getPlaybackTraceSnapshot);
