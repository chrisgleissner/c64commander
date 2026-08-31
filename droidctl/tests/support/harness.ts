/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ArtifactStore } from "../../src/artifacts.js";
import { createLogger } from "../../src/logger.js";
import { RecordingStore } from "../../src/recordings.js";
import { modules } from "../../src/tools/registry.js";
import type { ToolExecutionContext, ToolRunResult } from "../../src/tools/types.js";
import { FakeTransport } from "../../src/transport/fake.js";
import { TransportRegistry } from "../../src/transport/registry.js";
import type { Transport } from "../../src/transport/types.js";

export interface TestContext {
  readonly ctx: ToolExecutionContext;
  readonly transport: FakeTransport;
  readonly artifactRoot: string;
}

export async function createTestContext(
  options: { transport?: FakeTransport; extraTransports?: readonly Transport[] } = {},
): Promise<TestContext> {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "droidctl-test-"));
  const transport = options.transport ?? new FakeTransport();
  const artifacts = new ArtifactStore({ root: artifactRoot, runId: "dc-TEST", allowedRunRoots: [os.tmpdir()] });
  const ctx: ToolExecutionContext = {
    transports: new TransportRegistry([transport, ...(options.extraTransports ?? [])]),
    artifacts,
    recordings: new RecordingStore(),
    logger: createLogger("droidctl-test"),
  };
  return { ctx, transport, artifactRoot };
}

const moduleFor = (name: string) => {
  const domain = name.split(".")[0];
  const found = modules.find((module) => module.domain === domain);
  if (!found) {
    throw new Error(`No module registered for ${name}`);
  }
  return found;
};

/** The envelope every tool returns. Tests read `data` and `error` structurally. */
export interface ToolEnvelope {
  ok: boolean;
  runId: string;
  timestamp: string;
  data: Record<string, any>;
  error: Record<string, any>;
}

export async function invoke(name: string, args: unknown, ctx: ToolExecutionContext): Promise<ToolEnvelope> {
  const result = await moduleFor(name).invoke(name, args, ctx);
  return JSON.parse(result.content[0]?.text ?? "{}");
}

export async function invokeRaw(name: string, args: unknown, ctx: ToolExecutionContext): Promise<ToolRunResult> {
  return moduleFor(name).invoke(name, args, ctx);
}

const GETPROP_DUMP = [
  "[ro.build.characteristics]: [nosdcard]",
  "[ro.build.version.release]: [13]",
  "[ro.build.version.sdk]: [33]",
  "[ro.hardware]: [flame]",
  "[ro.product.model]: [Pixel 4]",
  "[ro.product.name]: [flame]",
].join("\n");

/** The three calls describe_target makes, answered as a healthy Pixel would. */
export function withDeviceDefaults(
  transport: FakeTransport,
  options: { sizeOverride?: string; densityOverride?: number } = {},
): FakeTransport {
  transport.respondTo("getprop", { stdout: GETPROP_DUMP });
  transport.respondTo("wm size", {
    stdout: `Physical size: 1080x2280${options.sizeOverride ? `\nOverride size: ${options.sizeOverride}` : ""}\n`,
  });
  transport.respondTo("wm density", {
    stdout: `Physical density: 440${options.densityOverride ? `\nOverride density: ${options.densityOverride}` : ""}\n`,
  });
  return transport;
}

export const HIERARCHY_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<hierarchy rotation="0">',
  '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" enabled="true" bounds="[0,0][1080,2280]">',
  '<node index="0" text="Play" resource-id="tab-play" content-desc="Play tab" class="android.widget.Button"',
  ' enabled="true" bounds="[0,2100][270,2280]" />',
  '<node index="1" text="Disabled action" resource-id="disabled-button" content-desc="" class="android.widget.Button"',
  ' enabled="false" bounds="[100,400][500,480]" />',
  '<node index="2" text="Scrolled away" resource-id="offscreen-row" content-desc="" class="android.widget.TextView"',
  ' enabled="true" bounds="[0,4000][1080,4080]" />',
  "</node>",
  "</hierarchy>",
].join("\n");
