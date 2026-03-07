import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ErrorCode =
  | "invalid_input"
  | "session_not_found"
  | "session_already_closed"
  | "capture_unavailable"
  | "capture_degraded"
  | "artifact_error"
  | "assertion_error"
  | "environment_error"
  | "internal_error";

export type RunOutcome = "pass" | "fail" | "inconclusive";

export type FailureClass = "product_failure" | "infrastructure_failure" | "inconclusive";

export interface ScopeError {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

export interface ScopeOkResult<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: true;
  runId: string;
  timestamp: string;
  data: T;
}

export interface ScopeErrorResult {
  ok: false;
  runId: string;
  timestamp: string;
  error: ScopeError;
}

export type ScopeResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ScopeOkResult<T>
  | ScopeErrorResult;

export type ScopeToolResponse = CallToolResult;

export function nowIso(): string {
  return new Date().toISOString();
}

export function createRunId(): string {
  const stamp = nowIso()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `pt-${stamp}`;
}

export function okResult<T extends Record<string, unknown>>(runId: string, data: T): ScopeOkResult<T> {
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
): ScopeErrorResult {
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

export function toToolResponse(result: ScopeResult): ScopeToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}
