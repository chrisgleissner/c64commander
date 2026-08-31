/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CallToolResult,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ArtifactStore } from "./artifacts.js";
import { createLogger } from "./logger.js";
import { RecordingStore } from "./recordings.js";
import { listResources, readResource } from "./resources.js";
import { unknownErrorResult } from "./tools/errors.js";
import { createToolRegistry } from "./tools/registry.js";
import type { ToolDescriptor } from "./tools/types.js";
import { AdbTransport } from "./transport/adb.js";
import { TransportRegistry } from "./transport/registry.js";
import { SshTransport } from "./transport/ssh.js";
import type { Transport } from "./transport/types.js";

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

export interface DroidctlRuntimeOptions {
  artifactRoot?: string;
  runId?: string;
  transports?: readonly Transport[];
}

export function createDroidctlServerRuntime(options: DroidctlRuntimeOptions = {}) {
  const logger = createLogger("droidctl");
  const artifacts = new ArtifactStore({
    ...(options.artifactRoot === undefined ? {} : { root: options.artifactRoot }),
    ...(options.runId === undefined ? {} : { runId: options.runId }),
  });
  const recordings = new RecordingStore();
  const transports = new TransportRegistry(
    options.transports ?? [
      new AdbTransport({ onCommand: (record) => artifacts.recordCommand(record) }),
      new SshTransport(),
    ],
  );
  const toolRegistry = createToolRegistry({ transports, artifacts, recordings, logger });

  const server = new Server(
    {
      name: "droidctl",
      version: "0.1.0",
    },
    {
      capabilities: {
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

  return {
    artifacts,
    logger,
    recordings,
    server,
    toolRegistry,
    transports,
    listResources,
    readResource,
  };
}

export async function runDroidctlServer(options: DroidctlRuntimeOptions = {}) {
  const runtime = createDroidctlServerRuntime(options);
  const transport = new StdioServerTransport();
  await runtime.server.connect(transport);
  return runtime;
}
