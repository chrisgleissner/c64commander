/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ErrorCode =
  | "invalid_input"
  | "target_not_found"
  | "ambiguous_target"
  | "transport_unavailable"
  | "unsupported_on_transport"
  | "device_error"
  | "artifact_error"
  | "assertion_error"
  | "timeout"
  | "internal_error";

export interface DroidctlError {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

export interface DroidctlOkResult<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: true;
  runId: string;
  timestamp: string;
  data: T;
}

export interface DroidctlErrorResult {
  ok: false;
  runId: string;
  timestamp: string;
  error: DroidctlError;
}

export type DroidctlResult<T extends Record<string, unknown> = Record<string, unknown>> =
  DroidctlOkResult<T> | DroidctlErrorResult;

export function nowIso(): string {
  return new Date().toISOString();
}

export function createRunId(): string {
  const stamp = nowIso()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `dc-${stamp}`;
}

export function okResult<T extends Record<string, unknown>>(runId: string, data: T): DroidctlOkResult<T> {
  return {
    ok: true,
    runId,
    timestamp: nowIso(),
    data,
  };
}

export function errorResult(
  runId: string,
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): DroidctlErrorResult {
  return {
    ok: false,
    runId,
    timestamp: nowIso(),
    error: {
      code,
      message,
      details,
    },
  };
}
