/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ErrorCode } from "../types.js";
import { jsonResult } from "./responses.js";
import type { ToolRunResult } from "./types.js";

export type ToolErrorKind = "validation" | "execution" | "unknown";

export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(message: string, kind: ToolErrorKind, code: ErrorCode, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.kind = kind;
    this.code = code;
    this.details = details;
  }
}

export class ToolValidationError extends ToolError {
  constructor(message: string, options?: { details?: Record<string, unknown>; code?: ErrorCode }) {
    super(message, "validation", options?.code ?? "invalid_input", options?.details);
  }
}

export class ToolExecutionError extends ToolError {
  constructor(message: string, options?: { details?: Record<string, unknown>; code?: ErrorCode }) {
    super(message, "execution", options?.code ?? "device_error", options?.details);
  }
}

/**
 * Raised when a target id resolves to nothing or to more than one device. Never
 * caught into a fallback: §6.3 rules 4 and 5 make both an error, not a choice.
 */
export class TargetResolutionError extends ToolExecutionError {
  constructor(message: string, code: "target_not_found" | "ambiguous_target", details: Record<string, unknown>) {
    super(message, { code, details });
  }
}

export class UnsupportedOnTransportError extends ToolExecutionError {
  constructor(transport: string, capability: string, message: string) {
    super(message, { code: "unsupported_on_transport", details: { transport, capability } });
  }
}

export class TransportUnavailableError extends ToolExecutionError {
  constructor(transport: string, message: string, details: Record<string, unknown> = {}) {
    super(message, { code: "transport_unavailable", details: { transport, ...details } });
  }
}

export function toolErrorResult(error: ToolError): ToolRunResult {
  const result = jsonResult(
    {
      ok: false,
      error: {
        kind: error.kind,
        code: error.code,
        message: error.message,
        details: error.details ?? {},
      },
    },
    { error: true },
  );
  return { ...result, isError: true };
}

export function unknownErrorResult(error: unknown): ToolRunResult {
  if (error instanceof ToolError) {
    return toolErrorResult(error);
  }

  const message = error instanceof Error ? error.message : String(error);
  const result = jsonResult(
    {
      ok: false,
      error: {
        kind: "unknown",
        code: "internal_error",
        message,
        details: {},
      },
    },
    { error: true },
  );
  return { ...result, isError: true };
}
