/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type TraceOrigin = 'user' | 'automatic' | 'system';

export type TraceLifecycleState = 'foreground' | 'background' | 'unknown';

export type TraceSourceKind = 'local' | 'ultimate' | 'hvsc' | 'saf';

export type TraceEventType =
  | 'action-start'
  | 'action-end'
  | 'action-scope-start'
  | 'action-scope-end'
  | 'backend-decision'
  | 'device-guard'
  | 'rest-request'
  | 'rest-response'
  | 'ftp-operation'
  | 'error';

export type TraceEventContextFields = {
  lifecycleState: TraceLifecycleState;
  sourceKind: TraceSourceKind | null;
  trackInstanceId: number | null;
  playlistItemId: string | null;
};

export type TraceEvent<T = Record<string, unknown>> = {
  id: string;
  timestamp: string;
  relativeMs: number;
  type: TraceEventType;
  origin: TraceOrigin;
  correlationId: string;
  data: T & TraceEventContextFields;
};

export type BackendTarget = 'internal-mock' | 'external-mock' | 'real-device';

export type BackendDecisionReason = 'reachable' | 'fallback' | 'demo-mode' | 'test-mode';

export type TraceActionContext = {
  correlationId: string;
  origin: TraceOrigin;
  name: string;
  componentName?: string | null;
};

export type TraceUiContext = {
  route: string;
  query: string;
};

export type TracePlaybackContext = {
  queueLength: number;
  currentIndex: number;
  currentItemId: string | null;
  isPlaying: boolean;
  elapsedMs: number;
  durationMs?: number | null;
  sourceKind?: TraceSourceKind | null;
  trackInstanceId?: number | null;
  playlistItemId?: string | null;
};

export type TraceDeviceContext = {
  deviceId: string | null;
  connectionState: string | null;
};

export type TraceContextSnapshot = {
  ui: TraceUiContext;
  platform: string;
  featureFlags: Record<string, boolean>;
  playback: TracePlaybackContext | null;
  device: TraceDeviceContext | null;
};
