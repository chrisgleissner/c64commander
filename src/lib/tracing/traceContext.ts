/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  cloneDiagnosticsDeviceAttribution,
  cloneDiagnosticsDeviceContext,
  createEmptyDiagnosticsDeviceAttribution,
  type DiagnosticsDeviceAttribution,
} from "@/lib/diagnostics/deviceAttribution";
import type { TraceContextSnapshot, TraceDeviceContext, TracePlaybackContext } from "@/lib/tracing/types";
import { getPlatform } from "@/lib/native/platform";

const defaultSnapshot: TraceContextSnapshot = {
  ui: { route: "/", query: "" },
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

/** The component name the Play page traces its actions under. */
export const PLAY_PAGE_TRACE_COMPONENT = "PlayFilesPage";

/**
 * The playback an operation belongs to: the tune that is playing, or the Play page's current tune for the Play page's
 * own actions, such as the read that starts a tune before it plays. A Disks browse while nothing plays has none.
 */
export const playbackTraceContextFor = (
  playback: TracePlaybackContext | null | undefined,
  action: { componentName?: string | null } | null | undefined,
) => (playback && (playback.isPlaying || action?.componentName === PLAY_PAGE_TRACE_COMPONENT) ? playback : null);

export const setTracePlaybackContext = (playback: TracePlaybackContext | null) => {
  snapshot = { ...snapshot, playback };
  emit();
};

export const setTraceDeviceContext = (device: TraceDeviceContext | null) => {
  snapshot = { ...snapshot, device: cloneDiagnosticsDeviceContext(device) };
  emit();
};

export const setTraceDeviceAttributionContext = (device: DiagnosticsDeviceAttribution | null) => {
  const nextAttribution = cloneDiagnosticsDeviceAttribution(device);
  if (!nextAttribution) {
    snapshot = {
      ...snapshot,
      device: snapshot.device
        ? {
            ...createEmptyDiagnosticsDeviceAttribution(),
            connectionState: snapshot.device.connectionState,
          }
        : null,
    };
    emit();
    return;
  }
  snapshot = {
    ...snapshot,
    device: {
      ...nextAttribution,
      connectionState: snapshot.device?.connectionState ?? null,
    },
  };
  emit();
};

export const setTraceDeviceConnectionState = (connectionState: string | null) => {
  const cloned = snapshot.device ? cloneDiagnosticsDeviceContext(snapshot.device) : null;
  const base = cloned ?? { ...createEmptyDiagnosticsDeviceAttribution(), connectionState: null };
  snapshot = {
    ...snapshot,
    device: {
      ...base,
      connectionState,
    },
  };
  emit();
};

export const subscribeTraceContext = (listener: (next: TraceContextSnapshot) => void) => {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
};
