import { ZodError } from "zod";
import type { LabStateStore } from "../labState.js";
import type { ScopeLogger } from "../logger.js";
import type { ScopeSessionStore } from "../sessionStore.js";
import { ToolValidationError } from "./errors.js";

export type JsonSchema = {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly enum?: readonly (string | number | boolean)[];
  readonly items?: JsonSchema | readonly JsonSchema[];
  readonly additionalProperties?: boolean | JsonSchema;
};

export interface ToolExecutionContext {
  readonly sessionStore: ScopeSessionStore;
  readonly labStateStore: LabStateStore;
  readonly logger: ScopeLogger;
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
  readonly inputSchema?: JsonSchema;
  readonly execute: (args: unknown, ctx: ToolExecutionContext) => Promise<ToolRunResult>;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: JsonSchema;
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
      return tool.execute(args, ctx);
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
