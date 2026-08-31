/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ZodError, type ZodTypeAny } from "zod";
import type { ArtifactStore } from "../artifacts.js";
import type { DroidctlLogger } from "../logger.js";
import type { RecordingStore } from "../recordings.js";
import type { TransportRegistry } from "../transport/registry.js";
import { ToolValidationError } from "./errors.js";

export type JsonSchema = {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly anyOf?: readonly JsonSchema[];
  readonly items?: JsonSchema | readonly JsonSchema[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly default?: unknown;
};

export interface ToolExecutionContext {
  /** Set by the module when it dispatches, so the capability gate knows the tool. */
  readonly toolName?: string;
  readonly transports: TransportRegistry;
  readonly artifacts: ArtifactStore;
  readonly recordings: RecordingStore;
  readonly logger: DroidctlLogger;
}

export interface ToolResponseContentText {
  readonly type: "text";
  readonly text: string;
}

export interface ToolRunResult {
  readonly content: readonly ToolResponseContentText[];
  readonly structuredContent?: {
    readonly type: "json";
    readonly data: unknown;
  };
  readonly metadata?: Record<string, unknown>;
  readonly isError?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  /** The runtime validator for the same input. The contract test keeps the pair honest. */
  readonly argsSchema: ZodTypeAny;
  readonly execute: (args: unknown, ctx: ToolExecutionContext) => Promise<ToolRunResult>;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly argsSchema: ZodTypeAny;
  readonly metadata: {
    readonly domain: string;
    readonly summary: string;
  };
}

export interface ToolModuleConfig {
  readonly domain: string;
  readonly summary: string;
  readonly tools: readonly ToolDefinition[];
}

export interface ToolModule {
  readonly domain: string;
  readonly summary: string;
  describeTools(): readonly ToolDescriptor[];
  invoke(name: string, args: unknown, ctx: ToolExecutionContext): Promise<ToolRunResult>;
}

export function defineToolModule(config: ToolModuleConfig): ToolModule {
  const toolMap = new Map(config.tools.map((tool) => [tool.name, tool]));

  return {
    domain: config.domain,
    summary: config.summary,
    describeTools() {
      return config.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        argsSchema: tool.argsSchema,
        metadata: {
          domain: config.domain,
          summary: config.summary,
        },
      }));
    },
    async invoke(name, args, ctx) {
      const tool = toolMap.get(name);
      if (!tool) {
        throw new ToolValidationError(`Unknown tool: ${name}`);
      }
      return tool.execute(args, { ...ctx, toolName: name });
    },
  };
}

export function parseZodArgs<T>(schema: { parse: (args: unknown) => T }, args: unknown): T {
  try {
    return schema.parse(args ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ToolValidationError("Tool input did not match the expected schema.", {
        details: { issues: error.issues },
      });
    }
    throw error;
  }
}
