import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CallToolResult,
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "./logger.js";
import { createPromptRegistry } from "./promptsRegistry.js";
import { readResource, listResources } from "./resources.js";
import { ScopeSessionStore } from "./sessionStore.js";
import { unknownErrorResult } from "./tools/errors.js";
import { createToolRegistry } from "./toolsRegistry.js";
import type { ToolDescriptor } from "./tools/types.js";
import type { PromptListEntry, PromptSegment } from "./promptsRegistry.js";

export function toCallToolResult(result: {
  content: readonly { type: "text"; text: string }[];
  structuredContent?: { type: "json"; data: unknown };
  isError?: boolean;
}): CallToolResult {
  return {
    content: [...result.content],
    ...(result.structuredContent
      ? { structuredContent: result.structuredContent.data as Record<string, unknown> }
      : {}),
    ...(result.isError ? { isError: true } : {}),
  };
}

export interface ScopeRuntimeOptions {
  artifactRoot?: string;
}

export function createScopeServerRuntime(options: ScopeRuntimeOptions = {}) {
  const artifactRoot = options.artifactRoot ?? path.join(process.cwd(), "artifacts");
  const logger = createLogger("c64scope");
  const sessionStore = new ScopeSessionStore(artifactRoot);
  const toolRegistry = createToolRegistry({ sessionStore, logger });
  const promptRegistry = createPromptRegistry();

  const server = new Server(
    {
      name: "c64scope",
      version: "0.1.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolRegistry.list().map(({ name, description, inputSchema }: ToolDescriptor) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    logger.debug("tool request", { name, arguments: args as Record<string, unknown> });

    try {
      return toCallToolResult(await toolRegistry.invoke(name, args));
    } catch (error) {
      logger.error("tool failed", {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      return toCallToolResult(unknownErrorResult(error));
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = readResource(request.params.uri);
    if (!resource) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }

    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.readText(),
        },
      ],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: promptRegistry.list().map((entry: PromptListEntry) => ({
      name: entry.descriptor.name,
      title: entry.descriptor.title,
      description: entry.descriptor.description,
      arguments: entry.arguments,
      _meta: {
        requiredResources: entry.descriptor.requiredResources,
        tools: entry.descriptor.tools,
      },
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const resolved = promptRegistry.resolve(request.params.name, request.params.arguments ?? {});

    return {
      description: resolved.description,
      messages: resolved.messages.map((message: PromptSegment) => ({
        role: message.role,
        content: {
          type: "text",
          text: message.content,
        },
      })),
      _meta: {
        arguments: resolved.arguments,
        resources: resolved.resources,
        tools: resolved.tools,
      },
    };
  });

  return {
    artifactRoot,
    logger,
    server,
    sessionStore,
    toolRegistry,
    listResources,
    promptRegistry,
    readResource,
  };
}

export async function runScopeServer(options: ScopeRuntimeOptions = {}) {
  const runtime = createScopeServerRuntime(options);
  const transport = new StdioServerTransport();
  await runtime.server.connect(transport);
  return runtime;
}
