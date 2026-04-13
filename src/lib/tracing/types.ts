/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DiagnosticsDeviceContext } from "@/lib/diagnostics/deviceAttribution";

export type TraceOrigin = "user" | "automatic" | "system";

export type TraceLifecycleState = "foreground" | "background" | "locked" | "unknown";

export type TraceSourceKind = "local" | "ultimate" | "hvsc" | "commoserve";

export type TraceLocalAccessMode = "entries" | "saf";

export type TraceHeaderValue = string | string[];

export type TraceHeaders = Record<string, TraceHeaderValue>;

export type PayloadPreview = {
  byteCount: number;
  previewByteCount: number;
  hex: string;
  ascii: string;
  truncated: boolean;
};

export type TraceEventType =
  | "action-start"
  | "action-end"
  | "action-scope-start"
  | "action-scope-end"
  | "backend-decision"
  | "device-guard"
  | "rest-request"
  | "rest-response"
  | "ftp-operation"
  | "telnet-operation"
  | "error";

export type TraceEventContextFields = {
  lifecycleState: TraceLifecycleState;
  sourceKind: TraceSourceKind | null;
  localAccessMode: TraceLocalAccessMode | null;
  trackInstanceId: number | null;
  playlistItemId: string | null;
  device?: DiagnosticsDeviceContext | null;
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

export type BackendTarget = "internal-mock" | "external-mock" | "real-device";

export type BackendDecisionReason = "reachable" | "fallback" | "demo-mode" | "test-mode" | "probe" | "auto-reconnect";

export type ActionTriggerKind =
  | "user"
  | "timer"
  | "auto-reconnect"
  | "route-enter"
  | "lifecycle"
  | "network-change"
  | "unknown";

export type ActionTrigger = {
  kind: ActionTriggerKind;
  name: string;
  intervalMs: number | null;
  details: Record<string, unknown> | null;
};

export type TraceActionContext = {
  correlationId: string;
  origin: TraceOrigin;
  name: string;
  componentName?: string | null;
  trigger?: ActionTrigger | null;
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
  localAccessMode?: TraceLocalAccessMode | null;
  trackInstanceId?: number | null;
  playlistItemId?: string | null;
};

export type TraceDeviceContext = DiagnosticsDeviceContext;

export type TraceContextSnapshot = {
  ui: TraceUiContext;
  platform: string;
  featureFlags: Record<string, boolean>;
  playback: TracePlaybackContext | null;
  device: TraceDeviceContext | null;
};
