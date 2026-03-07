/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ToolRunResult } from "./types.js";
import { jsonResult } from "./responses.js";

export type ToolErrorKind = "validation" | "execution" | "unknown";

export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly details?: Record<string, unknown>;

  constructor(message: string, kind: ToolErrorKind, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.kind = kind;
    this.details = details;
  }
}

export class ToolValidationError extends ToolError {
  constructor(message: string, options?: { details?: Record<string, unknown> }) {
    super(message, "validation", options?.details);
  }
}

export class ToolExecutionError extends ToolError {
  constructor(message: string, options?: { details?: Record<string, unknown> }) {
    super(message, "execution", options?.details);
  }
}

export function toolErrorResult(error: ToolError): ToolRunResult {
  const result = jsonResult(
    {
      ok: false,
      error: {
        kind: error.kind,
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
        message,
        details: {},
      },
    },
    { error: true },
  );
  return { ...result, isError: true };
}
