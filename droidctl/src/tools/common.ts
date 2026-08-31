/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import type { ResolvedTargetHandle } from "../transport/registry.js";
import { errorResult, okResult } from "../types.js";
import { ToolError, ToolExecutionError, UnsupportedOnTransportError } from "./errors.js";
import { jsonResult } from "./responses.js";
import type { JsonSchema, ToolExecutionContext, ToolRunResult } from "./types.js";
import { parseZodArgs } from "./types.js";

export const targetIdField: JsonSchema = {
  type: "string",
  description: "Target id from droid_target.list_targets. There is no default target and no single-device fallback.",
};

export const packageField: JsonSchema = {
  type: "string",
  description:
    "Android application id. Required: two application ids can be installed at once and both open a WebView DevTools socket.",
};

export const runRootField: JsonSchema = {
  type: "string",
  description: "Directory to write artifacts into instead of this run's default directory.",
};

export const targetIdSchema = z.string().min(1);
export const packageSchema = z.string().min(1);
export const runRootSchema = z.string().min(1).optional();

export function ok(ctx: ToolExecutionContext, data: Record<string, unknown>): ToolRunResult {
  return jsonResult(okResult(ctx.artifacts.runId, data));
}

/**
 * Tool bodies return data; a ToolError becomes the error envelope. Anything else
 * propagates so the server's unknownErrorResult reports it as unhandled rather
 * than dressing an unexpected fault as a normal failure.
 */
export function defineExecute<T>(
  schema: z.ZodType<T>,
  body: (args: T, ctx: ToolExecutionContext) => Promise<Record<string, unknown>>,
): (args: unknown, ctx: ToolExecutionContext) => Promise<ToolRunResult> {
  return async (args, ctx) => {
    try {
      const parsed = parseZodArgs(schema, args);
      return ok(ctx, await body(parsed, ctx));
    } catch (error) {
      if (error instanceof ToolError) {
        return {
          ...jsonResult(errorResult(ctx.artifacts.runId, error.code, error.message, error.details ?? {})),
          isError: true,
        };
      }
      throw error;
    }
  };
}

export async function resolveTarget(ctx: ToolExecutionContext, targetId: string): Promise<ResolvedTargetHandle> {
  const handle = await ctx.transports.resolve(targetId);
  if (ctx.toolName) {
    requireCapability(handle, ctx.toolName);
  }
  return handle;
}

/** An unsupported capability is a structured refusal, never a silent no-op. */
export function requireCapability(handle: ResolvedTargetHandle, toolName: string): void {
  const capabilities = handle.transport.capabilities();
  const support = capabilities.tools[toolName];
  if (support === "supported") {
    return;
  }
  // An unlisted tool is unverified on that transport, so it is refused rather
  // than allowed: fail-open here would let a backend silently no-op.
  if (support === undefined) {
    throw new UnsupportedOnTransportError(
      handle.transport.kind,
      toolName,
      `${toolName} is not listed in the ${handle.transport.kind} transport's capability map, so it is unverified there.`,
    );
  }
  const note = capabilities.notes[toolName];
  throw new UnsupportedOnTransportError(
    handle.transport.kind,
    toolName,
    `${toolName} is ${support} on the ${handle.transport.kind} transport.${note ? ` ${note}` : ""}`,
  );
}

export function expectSuccess(
  result: { exitCode: number; stderr: string; stdout: string },
  what: string,
  details: Record<string, unknown> = {},
): void {
  if (result.exitCode !== 0) {
    throw new ToolExecutionError(`${what} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`, {
      details: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout, ...details },
    });
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Single-quoted for `sh -c`, so a path or payload cannot break out of the command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
