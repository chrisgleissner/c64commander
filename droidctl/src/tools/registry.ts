/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ArtifactStore } from "../artifacts.js";
import type { DroidctlLogger } from "../logger.js";
import type { RecordingStore } from "../recordings.js";
import type { TransportRegistry } from "../transport/registry.js";
import { appModule } from "./modules/app.js";
import { assertModule } from "./modules/assert.js";
import { captureModule } from "./modules/capture.js";
import { deviceModule } from "./modules/device.js";
import { inputModule } from "./modules/input.js";
import { targetModule } from "./modules/target.js";
import type { ToolDescriptor, ToolExecutionContext, ToolModule, ToolRunResult } from "./types.js";

interface RegisteredTool {
  readonly module: ToolModule;
  readonly descriptor: ToolDescriptor;
}

export const modules: readonly ToolModule[] = [
  targetModule,
  appModule,
  inputModule,
  captureModule,
  assertModule,
  deviceModule,
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

export function listToolDescriptors(): readonly ToolDescriptor[] {
  return Array.from(toolMap.values(), (entry) => entry.descriptor);
}

export function createToolRegistry(deps: {
  transports: TransportRegistry;
  artifacts: ArtifactStore;
  recordings: RecordingStore;
  logger: DroidctlLogger;
}) {
  return {
    list(): readonly ToolDescriptor[] {
      return listToolDescriptors();
    },

    async invoke(name: string, args: unknown): Promise<ToolRunResult> {
      const entry = toolMap.get(name);
      if (!entry) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const ctx: ToolExecutionContext = {
        transports: deps.transports,
        artifacts: deps.artifacts,
        recordings: deps.recordings,
        logger: deps.logger,
      };

      return entry.module.invoke(name, args, ctx);
    },
  };
}
