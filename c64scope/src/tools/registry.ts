/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LabStateStore } from "../labState.js";
import type { ScopeLogger } from "../logger.js";
import type { ScopeSessionStore } from "../sessionStore.js";
import type { ToolExecutionContext, ToolDescriptor, ToolModule, ToolRunResult } from "./types.js";
import { artifactModule } from "./modules/artifact.js";
import { assertModule } from "./modules/assert.js";
import { captureModule } from "./modules/capture.js";
import { catalogModule } from "./modules/catalog.js";
import { labModule } from "./modules/lab.js";
import { sessionModule } from "./modules/session.js";

interface RegisteredTool {
  readonly module: ToolModule;
  readonly descriptor: ToolDescriptor;
}

const modules: readonly ToolModule[] = [
  sessionModule,
  labModule,
  captureModule,
  assertModule,
  artifactModule,
  catalogModule,
];

const toolMap = new Map<string, RegisteredTool>();

for (const module of modules) {
  for (const descriptor of module.describeTools()) {
    if (toolMap.has(descriptor.name)) {
      throw new Error(`Duplicate tool name detected while registering modules: ${descriptor.name}`);
    }
    toolMap.set(descriptor.name, { module, descriptor });
  }
}

export function createToolRegistry(deps: {
  sessionStore: ScopeSessionStore;
  labStateStore: LabStateStore;
  logger: ScopeLogger;
}) {
  return {
    list(): readonly ToolDescriptor[] {
      return Array.from(toolMap.values(), (entry) => entry.descriptor);
    },

    async invoke(name: string, args: unknown): Promise<ToolRunResult> {
      const entry = toolMap.get(name);
      if (!entry) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const ctx: ToolExecutionContext = {
        sessionStore: deps.sessionStore,
        labStateStore: deps.labStateStore,
        logger: deps.logger,
      };

      return entry.module.invoke(name, args, ctx);
    },
  };
}
