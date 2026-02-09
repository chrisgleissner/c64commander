/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TraceContextSnapshot, TraceDeviceContext, TracePlaybackContext } from '@/lib/tracing/types';
import { getPlatform } from '@/lib/native/platform';

const defaultSnapshot: TraceContextSnapshot = {
  ui: { route: '/', query: '' },
  platform: getPlatform(),
  featureFlags: {},
  playback: null,
  device: null,
};

let snapshot: TraceContextSnapshot = { ...defaultSnapshot };
const listeners = new Set<(next: TraceContextSnapshot) => void>();

const emit = () => {
  listeners.forEach((listener) => listener(snapshot));
};

export const getTraceContextSnapshot = () => snapshot;

export const setTraceUiContext = (route: string, query: string) => {
  snapshot = { ...snapshot, ui: { route, query } };
  emit();
};

export const setTracePlatformContext = (platform: string) => {
  snapshot = { ...snapshot, platform };
  emit();
};

export const setTraceFeatureFlags = (flags: Record<string, boolean>) => {
  snapshot = { ...snapshot, featureFlags: { ...flags } };
  emit();
};

export const setTracePlaybackContext = (playback: TracePlaybackContext | null) => {
  snapshot = { ...snapshot, playback };
  emit();
};

export const setTraceDeviceContext = (device: TraceDeviceContext | null) => {
  snapshot = { ...snapshot, device };
  emit();
};

export const subscribeTraceContext = (listener: (next: TraceContextSnapshot) => void) => {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
};
